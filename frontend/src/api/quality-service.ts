import { listEntries } from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import {
  AUDI_0002_RULE,
  EVEN_0002_V22_FIELDS,
  EVEN_0002_V22_NOTES,
  SNAPSHOT_RETENTION_MONTHS,
  anomalyLocator,
  buildAnomaly,
  buildSnapshotV7,
  even0002VersionV22,
} from '@/data/quality-fixtures'
import { qualitySnapshot, resetQualityState, saveQualityState } from '@/data/quality-store'
import type {
  AnomalyKind,
  ApplyAttempt,
  AuditAnomaly,
  AuditRound,
  AuditRoundKind,
  CheckActionResult,
  ConcurrentApplyResult,
  EventCompatibility,
  EventOption,
  EventRevision,
  EventVersion,
  FieldReviewRow,
  FixItem,
  MessageBatch,
  ParameterField,
  QualityCheck,
  QualityState,
  ReviseResult,
  RuleOption,
  SamplingChange,
  ScanMessage,
  SnapshotContent,
} from '@/data/quality-types'
import { addMonths, formatTime, nowIso, snapshotFingerprint } from '@/data/quality-utils'

/** 快照保留期策略：自生成起保留 24 个月；保留期内不可改写，到期后只能归档、不再参与扫描。 */
export const RETENTION_POLICY = {
  months: SNAPSHOT_RETENTION_MONTHS,
  summary: '快照自生成起保留 24 个月；保留期内不可改写，到期后只能归档、不再参与扫描。',
}

/** 快照是否已过保留期。到期快照只读，不能再出新质量结论。 */
function retentionExpired(check: QualityCheck, at = nowIso()): boolean {
  const until = new Date(check.snapshot.retentionUntil).getTime()
  if (Number.isNaN(until)) return false
  return new Date(at).getTime() > until
}

/** 生命周期单向流转表：没有回退边，归档是终点。 */
const STAGE_TRANSITIONS: Record<QualityCheck['stage'], QualityCheck['stage'][]> = {
  草稿: ['已生效', '已归档'],
  已生效: ['已归档'],
  已归档: [],
}

const STAGE_ORDER: Record<QualityCheck['stage'], number> = {
  草稿: 1,
  已生效: 2,
  已归档: 3,
}

export class SnapshotIntegrityError extends Error {}

export function validateSnapshotIntegrity(check: QualityCheck): string | null {
  if (!check.frozen) return null
  if (snapshotFingerprint(check.snapshot) !== check.snapshot.fingerprint) {
    return `质量检查 ${check.checkId} 的快照指纹校验失败，冻结快照被改写，拒绝继续操作`
  }
  return null
}

function assertSnapshotIntact(check: QualityCheck): void {
  const message = validateSnapshotIntegrity(check)
  if (message) {
    throw new SnapshotIntegrityError(message)
  }
}

function nextId(state: QualityState, prefix: string, existing: string[]): string {
  const used = new Set(existing)
  let index = state.checks.length + 1
  let candidate = `${prefix}-${String(index).padStart(4, '0')}`
  while (used.has(candidate)) {
    index += 1
    candidate = `${prefix}-${String(index).padStart(4, '0')}`
  }
  return candidate
}

function currentEventVersion(state: QualityState, eventCode: string): EventVersion {
  const version = state.eventVersions
    .filter((item) => item.eventCode === eventCode)
    .sort((left, right) => right.versionNumber - left.versionNumber)[0]
  if (!version) {
    throw new Error(`事件 ${eventCode} 还没有登记上报参数版本`)
  }
  return version
}

function nextBatch(state: QualityState, check: QualityCheck): MessageBatch | undefined {
  const used = new Set(check.rounds.map((round) => round.messageBatchId))
  return state.messageBatches
    .filter((batch) => batch.eventCode === check.eventCode)
    .sort((left, right) => left.windowStart.localeCompare(right.windowStart))
    .find((batch) => !used.has(batch.batchId))
}

/** 采样比例偏差单独成一条异常，定位到事件的采样策略而不是消息字段。 */
function samplingAnomaly(check: QualityCheck, batch: MessageBatch, id: string): AuditAnomaly | null {
  const ratios = [...new Set(batch.messages.map((message) => message.samplingRate))]
  const drifted = ratios.filter((ratio) => ratio !== check.snapshot.samplingRatio)
  if (drifted.length === 0) return null
  return {
    id,
    locator: `${check.eventCode}.sampling_ratio`,
    field: 'sampling_ratio',
    fieldLabel: '采样比例',
    kind: '采样偏差',
    level: 'P2',
    snapshotValue: check.snapshot.samplingRatio,
    observedValue: drifted.join(' / '),
    detail: `快照固化为 ${check.snapshot.samplingRatio}（来源：${check.snapshot.samplingSourcePage}），扫描批次 ${batch.batchId} 实际采样 ${drifted.join(
      ' / ',
    )}`,
    fixSuggestion: `核对 ${check.eventCode} 采样策略页当前比例，若属计划调整需重新生成质量检查快照，不能沿用 ${check.snapshot.snapshotId}`,
  }
}

function scanBatch(check: QualityCheck, batch: MessageBatch, idPrefix: string): AuditAnomaly[] {
  const anomalies: AuditAnomaly[] = []
  check.snapshot.parameterDict.forEach((field, index) => {
    const hits = batch.messages
      .map((message) => ({ message, hit: evaluateField(field, message) }))
      .filter((item) => item.hit !== null)
    if (hits.length === 0) return
    const kinds = [...new Set(hits.map((item) => item.hit!.kind))]
    const kind = kinds[0] as AnomalyKind
    const observed = [...new Set(hits.map((item) => item.message.params[field.name] ?? '（未上报）'))]
    const targetMessages = hits.map((item) => item.message.messageId).slice(0, 3).join('、')
    anomalies.push(
      buildAnomaly({
        id: `${idPrefix}-A${String(index + 1).padStart(2, '0')}`,
        eventCode: check.eventCode,
        field,
        kind,
        observedValue: observed.join(' / '),
        detail: `${hits.length} 条消息命中：${hits[0].hit!.detail}${hits.length > 1 ? `（样本：${targetMessages}）` : ''}`,
      }),
    )
  })
  const sampling = samplingAnomaly(check, batch, `${idPrefix}-S01`)
  if (sampling) anomalies.push(sampling)
  return anomalies
}

/**
 * 事件改版轮次的额外异常：新增参数、已下线参数。
 * 这些都记在旧快照名下，但只追加到新轮次，旧轮次与旧结论不动。
 */
function revisionAnomalies(
  check: QualityCheck,
  batch: MessageBatch,
  nextVersion: EventVersion,
  idPrefix: string,
): AuditAnomaly[] {
  const snapshotNames = new Set(check.snapshot.parameterDict.map((field) => field.name))
  const nextNames = new Set(nextVersion.parameterDict.map((field) => field.name))
  const observedNames = new Set(
    batch.messages.flatMap((message) => Object.keys(message.params)),
  )
  const anomalies: AuditAnomaly[] = []
  let index = 1
  for (const name of observedNames) {
    if (snapshotNames.has(name)) continue
    const field = nextVersion.parameterDict.find((item) => item.name === name)
    if (!field) continue
    anomalies.push({
      id: `${idPrefix}-V${String(index).padStart(2, '0')}`,
      locator: anomalyLocator(check.eventCode, name),
      field: name,
      fieldLabel: field.label,
      kind: '兼容变更',
      level: 'P3',
      snapshotValue: `（快照 ${check.snapshot.snapshotId} 未登记）`,
      observedValue: field.snapshotValue,
      detail: `事件改版到 ${nextVersion.versionLabel} 后消息开始上报新参数 ${name}（${field.label}），旧快照未登记该字段`,
      fixSuggestion: `新参数 ${name} 只在新版本质量检查中复核；若需要纳入当前审计口径，必须新建快照，不能改写 ${check.snapshot.snapshotId}`,
    })
    index += 1
  }
  for (const field of check.snapshot.parameterDict) {
    if (nextNames.has(field.name)) continue
    anomalies.push({
      id: `${idPrefix}-V${String(index).padStart(2, '0')}`,
      locator: anomalyLocator(check.eventCode, field.name),
      field: field.name,
      fieldLabel: field.label,
      kind: '兼容变更',
      level: 'P3',
      snapshotValue: field.snapshotValue,
      observedValue: '（新版本已删除该参数）',
      detail: `事件改版到 ${nextVersion.versionLabel} 后下线参数 ${field.name}（${field.label}），旧快照仍按原口径复核历史消息`,
      fixSuggestion: `旧消息仍按 ${check.snapshot.snapshotId} 口径复核；新版本审计需重新生成质量检查记录`,
    })
    index += 1
  }
  return anomalies
}

function evaluateField(
  field: ParameterField,
  message: ScanMessage,
): { kind: AnomalyKind; detail: string } | null {
  const raw = message.params[field.name]
  if (raw === undefined || raw === '') {
    if (!field.required) return null
    return { kind: '缺失参数', detail: `缺少必填参数 ${field.name}（${field.label}）` }
  }
  if (field.type === 'number' && Number.isNaN(Number(raw))) {
    return { kind: '类型变更', detail: `参数 ${field.name} 应为数值，实际为 ${raw}` }
  }
  if (field.type === 'boolean' && raw !== 'true' && raw !== 'false') {
    return { kind: '类型变更', detail: `参数 ${field.name} 应为布尔值，实际为 ${raw}` }
  }
  if (field.valueMode === 'fixed' && raw !== field.snapshotValue) {
    return {
      kind: '口径漂移',
      detail: `参数 ${field.name} 快照口径为 ${field.snapshotValue}，消息上报 ${raw}`,
    }
  }
  if (field.valueMode === 'enum' && field.enumValues && !field.enumValues.includes(raw)) {
    return {
      kind: '口径漂移',
      detail: `参数 ${field.name} 取值 ${raw} 不在快照枚举 ${field.enumValues.join(' / ')} 内`,
    }
  }
  return null
}

function makeRound(options: {
  state: QualityState
  check: QualityCheck
  kind: AuditRoundKind
  batch: MessageBatch
  actor: string
  ranAt: string
  note: string
  nextVersion?: EventVersion
}): AuditRound {
  const { state, check, batch } = options
  const roundNo = check.rounds.length + 1
  const roundId = `${check.checkId}-R${String(roundNo).padStart(2, '0')}`
  const anomalies = scanBatch(check, batch, roundId)
  if (options.nextVersion) {
    anomalies.push(...revisionAnomalies(check, batch, options.nextVersion, roundId))
  }
  const eventVersion = options.nextVersion ?? currentEventVersion(state, check.eventCode)
  return {
    roundId,
    roundNo,
    kind: options.kind,
    ranAt: options.ranAt,
    actor: options.actor,
    snapshotId: check.snapshot.snapshotId,
    snapshotVersionLabel: check.snapshot.versionLabel,
    eventVersionLabel: eventVersion.versionLabel,
    messageBatchId: batch.batchId,
    note: options.note,
    anomalies,
  }
}

function ruleFields(rule: RuleOption): string[] {
  return rule.validationFieldsText
    .split(/[、,，;；\s]+/)
    .map((item) => item.trim())
    .filter((item) => item !== '')
}

/** 生成快照时的口径提示：不阻断生成，但必须随快照一起留痕。 */
function bindingWarnings(
  event: EventVersion,
  rule: RuleOption,
  validationFields: string[],
  auditFrequency: string,
): string[] {
  const warnings: string[] = []
  const names = new Set(event.parameterDict.map((field) => field.name))
  const unknown = validationFields.filter((name) => !names.has(name))
  if (unknown.length > 0) {
    warnings.push(
      `规则校验字段 ${unknown.join('、')} 不在 ${event.eventCode}@${event.versionLabel} 的参数字典里，审计时会记为口径缺口`,
    )
  }
  if (!event.samplingSourcePage.trim()) {
    warnings.push('采样比例缺少来源页，快照的采样口径无法追溯')
  }
  if (!event.samplingChangedBy.trim()) {
    warnings.push('采样比例缺少变更人，快照无法定责')
  }
  if (!auditFrequency.trim() || !rule.auditFrequencyText.trim()) {
    warnings.push('审计频率为空，快照无法绑定扫描节奏')
  }
  return warnings
}

function eventRowStatus(eventCode: string): string {
  const row = listEntries('eventdef').items.find((item) => String(item['事件编号']) === eventCode)
  return row ? String(row.status) : '未登记'
}

function ruleRowStatus(ruleCode: string): string {
  const row = listEntries('auditcheck').items.find((item) => String(item['规则编号']) === ruleCode)
  return row ? String(row.status) : '未登记'
}

export function listEventOptions(): EventOption[] {
  const state = qualitySnapshot()
  const options: EventOption[] = []
  const seen = new Set<string>()
  for (const version of state.eventVersions) {
    if (!version.isCurrent) continue
    options.push({
      eventCode: version.eventCode,
      eventName: version.eventName,
      versionLabel: version.versionLabel,
      status: eventRowStatus(version.eventCode),
    })
    seen.add(version.eventCode)
  }
  for (const row of listEntries('eventdef').items) {
    const code = String(row['事件编号'])
    if (seen.has(code)) continue
    options.push({
      eventCode: code,
      eventName: String(row['事件名称']),
      versionLabel: '未登记参数版本',
      status: String(row.status),
    })
  }
  return options
}

export function listRuleOptions(): RuleOption[] {
  const options: RuleOption[] = [
    {
      ruleCode: AUDI_0002_RULE.ruleCode,
      ruleName: AUDI_0002_RULE.ruleName,
      auditTarget: AUDI_0002_RULE.auditTarget,
      validationFieldsText: AUDI_0002_RULE.validationFieldsText,
      anomalyConditionsText: AUDI_0002_RULE.anomalyConditionsText,
      auditFrequencyText: AUDI_0002_RULE.frequencyText,
      status: ruleRowStatus(AUDI_0002_RULE.ruleCode),
    },
  ]
  for (const row of listEntries('auditcheck').items) {
    const code = String(row['规则编号'])
    if (code === AUDI_0002_RULE.ruleCode) continue
    if (!String(row['异常条件']).trim()) continue
    options.push({
      ruleCode: code,
      ruleName: String(row['审计对象']),
      auditTarget: String(row['审计对象']),
      validationFieldsText: String(row['校验字段']),
      anomalyConditionsText: String(row['异常条件']),
      auditFrequencyText: String(row['审计频率']),
      status: String(row.status),
    })
  }
  return options
}

export function listQualityChecks(): QualityCheck[] {
  return qualitySnapshot()
    .checks.slice()
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

export function getQualityCheck(checkId: string): QualityCheck | undefined {
  return qualitySnapshot().checks.find((item) => item.checkId === checkId)
}

/**
 * 选择事件 + 审计对象后生成质量检查记录（草稿）：
 * 参数结构、采样比例、异常条件一起写进快照，等待规则生效时冻结。
 */
export function createQualityCheck(options: {
  eventCode: string
  ruleCode: string
  actor: string
  capturedAt?: string
}): CheckActionResult {
  const state = qualitySnapshot()
  const event = state.eventVersions.find(
    (item) => item.eventCode === options.eventCode && item.isCurrent,
  )
  if (!event) {
    return { ok: false, message: `事件 ${options.eventCode} 还没有登记上报参数版本，不能生成快照` }
  }
  const rule = listRuleOptions().find((item) => item.ruleCode === options.ruleCode)
  if (!rule) {
    return { ok: false, message: `审计规则 ${options.ruleCode} 不存在` }
  }
  const checkId = nextId(
    state,
    'CHK',
    state.checks.map((item) => item.checkId),
  )
  const capturedAt = options.capturedAt ?? nowIso()
  const baseSnapshot = buildSnapshotFromEvent(event, rule, capturedAt)
  const snapshot: SnapshotContent = {
    ...baseSnapshot,
    bindingWarnings: bindingWarnings(
      event,
      rule,
      baseSnapshot.validationFields,
      baseSnapshot.auditFrequency,
    ),
    boundCheckId: checkId,
  }
  const check: QualityCheck = {
    checkId,
    eventCode: event.eventCode,
    eventName: event.eventName,
    ruleCode: rule.ruleCode,
    ruleName: rule.ruleName,
    stage: '草稿',
    stageLogs: [
      {
        stage: '草稿',
        at: capturedAt,
        actor: options.actor,
        note: `按 ${rule.ruleCode} 的异常条件与校验字段生成参数快照，等待规则生效`,
      },
    ],
    createdBy: options.actor,
    createdAt: capturedAt,
    frozen: false,
    snapshot,
    rounds: [],
  }
  saveQualityState({ ...state, checks: [...state.checks, check] })
  return {
    ok: true,
    message: `已生成质量检查 ${checkId}（快照 ${snapshot.snapshotId}），参数结构 / 采样比例 / 异常条件已保存`,
    checkId,
    roundNo: 0,
    anomalies: 0,
  }
}

function buildSnapshotFromEvent(
  event: EventVersion,
  rule: RuleOption,
  capturedAt: string,
): SnapshotContent {
  if (event.eventCode === 'EVEN-0002' && event.versionLabel === 'v7') {
    return buildSnapshotV7(capturedAt)
  }
  const samplingHistory: SamplingChange[] = [
    {
      ratio: event.samplingRatio,
      changedAt: event.samplingChangedAt,
      changedBy: event.samplingChangedBy,
      sourcePage: event.samplingSourcePage,
      note: event.changeReason,
    },
  ]
  const validationFields = ruleFields(rule)
  return {
    snapshotId: `${event.eventCode.toLowerCase()}-${event.versionLabel}`,
    eventCode: event.eventCode,
    eventName: event.eventName,
    parameterVersion: event.versionNumber,
    versionLabel: event.versionLabel,
    capturedAt,
    parameterDict: event.parameterDict,
    triggerConditionText: event.triggerConditionText,
    samplingRatio: event.samplingRatio,
    samplingSourcePage: event.samplingSourcePage,
    samplingChangedBy: event.samplingChangedBy,
    samplingChangedAt: event.samplingChangedAt,
    samplingHistory,
    versionChangedBy: event.changedBy,
    ruleCode: rule.ruleCode,
    validationFields,
    anomalyConditions: rule.anomalyConditionsText,
    auditFrequency: rule.auditFrequencyText,
    ruleBinding: {
      versionPointer: `${event.eventCode}@${event.versionLabel}`,
      validationFieldsVersion: `${event.eventCode}@${event.versionLabel}`,
      auditFrequencyVersion: `${event.eventCode}@${event.versionLabel}`,
    },
    bindingWarnings: bindingWarnings(event, rule, validationFields, rule.auditFrequencyText),
    retentionMonths: SNAPSHOT_RETENTION_MONTHS,
    retentionUntil: addMonths(capturedAt, SNAPSHOT_RETENTION_MONTHS),
    fingerprint: '',
    boundCheckId: '',
  }
}

function bindingConsistent(snapshot: SnapshotContent): boolean {
  const { ruleBinding } = snapshot
  return (
    ruleBinding.versionPointer === ruleBinding.validationFieldsVersion &&
    ruleBinding.validationFieldsVersion === ruleBinding.auditFrequencyVersion &&
    ruleBinding.versionPointer === `${snapshot.eventCode}@${snapshot.versionLabel}`
  )
}

function transitionGuard(check: QualityCheck, to: QualityCheck['stage']): string | null {
  const allowed = STAGE_TRANSITIONS[check.stage]
  if (!allowed.includes(to)) {
    return `质量检查 ${check.checkId} 当前阶段「${check.stage}」，不能流转到「${to}」；阶段只允许按生命周期单向推进`
  }
  if (STAGE_ORDER[to] <= STAGE_ORDER[check.stage]) {
    return `质量检查 ${check.checkId} 不能从「${check.stage}」回到「${to}」`
  }
  return null
}

function activeCheckFor(
  state: QualityState,
  eventCode: string,
  ruleCode: string,
  versionLabel: string,
): QualityCheck | undefined {
  return state.checks.find(
    (item) =>
      item.eventCode === eventCode &&
      item.ruleCode === ruleCode &&
      item.stage === '已生效' &&
      item.snapshot.versionLabel === versionLabel,
  )
}

/**
 * 规则生效：冻结快照、写入指纹，并执行基线扫描。
 * 传入 expectedRevision 时做乐观并发控制：只有仍持有同一 revision 的调用能提交，
 * 并且同一事件 + 规则只允许一个生效快照。
 */
export function applyQualityCheck(
  checkId: string,
  options: { actor: string; expectedRevision?: number },
): CheckActionResult & { attempt: ApplyAttempt } {
  const state = qualitySnapshot()
  const check = state.checks.find((item) => item.checkId === checkId)
  const baseAttempt: ApplyAttempt = {
    actor: options.actor,
    ok: false,
    message: '',
    checkId,
    draftedAnomalies: 0,
    persistedAnomalies: 0,
  }
  if (!check) {
    return { ok: false, message: `没有找到编号为 ${checkId} 的质量检查记录`, attempt: baseAttempt }
  }
  if (options.expectedRevision !== undefined && options.expectedRevision !== state.revision) {
    const message = `质量检查 ${checkId} 生效失败：数据版本已被其他审计员更新（期望 r${options.expectedRevision}，实际 r${state.revision}），本次不写入任何快照或异常`
    return { ok: false, message, attempt: { ...baseAttempt, message } }
  }
  const guard = transitionGuard(check, '已生效')
  if (guard) {
    return { ok: false, message: guard, attempt: { ...baseAttempt, message: guard } }
  }
  if (!bindingConsistent(check.snapshot)) {
    const message = `质量检查 ${checkId} 的规则绑定指向了不同版本，拒绝生效`
    return { ok: false, message, attempt: { ...baseAttempt, message } }
  }
  const current = currentEventVersion(state, check.eventCode)
  if (current.versionLabel !== check.snapshot.versionLabel) {
    const message = `事件 ${check.eventCode} 已改版到 ${current.versionLabel}，快照仍停留在 ${check.snapshot.versionLabel}，请重新生成质量检查记录`
    return { ok: false, message, attempt: { ...baseAttempt, message } }
  }
  if (retentionExpired(check)) {
    const message = `快照 ${check.snapshot.snapshotId} 已超过保留期（保留至 ${formatTime(
      check.snapshot.retentionUntil,
    )}），不能再据此出具质量结论`
    return { ok: false, message, attempt: { ...baseAttempt, message } }
  }
  const existing = activeCheckFor(state, check.eventCode, check.ruleCode, check.snapshot.versionLabel)
  if (existing && existing.checkId !== checkId) {
    const message = `事件 ${check.eventCode}、规则 ${check.ruleCode}、快照版本 ${check.snapshot.versionLabel} 已有生效快照 ${existing.checkId}，同一版本只接受一个完整快照，本次不写入异常`
    return { ok: false, message, attempt: { ...baseAttempt, message } }
  }
  const batch = nextBatch(state, check)
  if (!batch) {
    const message = `事件 ${check.eventCode} 没有可扫描的消息批次，无法生成质量结论`
    return { ok: false, message, attempt: { ...baseAttempt, message } }
  }

  const effectiveAt = nowIso()
  try {
    const frozenSnapshot: SnapshotContent = {
      ...check.snapshot,
      fingerprint: '',
    }
    frozenSnapshot.fingerprint = snapshotFingerprint(frozenSnapshot)
    const frozenCheck: QualityCheck = {
      ...check,
      stage: '已生效',
      frozen: true,
      effectiveAt,
      snapshot: frozenSnapshot,
      stageLogs: [
        ...check.stageLogs,
        {
          stage: '已生效',
          at: effectiveAt,
          actor: options.actor,
          note: `快照 ${frozenSnapshot.snapshotId} 冻结（指纹 ${frozenSnapshot.fingerprint}），作为事件 ${check.eventCode} 的质量结论基线`,
        },
      ],
    }
    // 在提交前把基线轮次算完；任何失败都不会写入半数异常。
    // 若冻结快照被并发改写（指纹不符），这里会抛错，整次生效回滚。
    const baselineRound = makeRound({
      state,
      check: frozenCheck,
      kind: '基线扫描',
      batch,
      actor: options.actor,
      ranAt: effectiveAt,
      note: `扫描批次 ${batch.batchId}（${batch.label}）`,
    })
    assertSnapshotIntact(frozenCheck)
    frozenCheck.rounds = [baselineRound]
    const nextChecks = state.checks.map((item) => (item.checkId === checkId ? frozenCheck : item))
    saveQualityState({ ...state, checks: nextChecks })
    const message = `质量检查 ${checkId} 已生效，快照 ${frozenSnapshot.snapshotId} 冻结；基线扫描发现 ${baselineRound.anomalies.length} 条异常`
    return {
      ok: true,
      message,
      checkId,
      roundNo: baselineRound.roundNo,
      anomalies: baselineRound.anomalies.length,
      attempt: {
        ...baseAttempt,
        ok: true,
        message,
        draftedAnomalies: baselineRound.anomalies.length,
        persistedAnomalies: baselineRound.anomalies.length,
      },
    }
  } catch (error) {
    const message = `质量检查 ${checkId} 生效失败：${
      error instanceof Error ? error.message : '未知错误'
    }，本次不写入任何快照或异常`
    return { ok: false, message, attempt: { ...baseAttempt, message } }
  }
}

/**
 * 模拟两名审计员同时点「生效规则」：两人都基于同一数据版本各自算完快照与基线异常，
 * 提交时只有一人成功；失败一侧的异常只存在于草稿计算，不落库。
 */
export function simulateConcurrentApply(options: {
  eventCode: string
  ruleCode: string
  actors: [string, string]
}): ConcurrentApplyResult {
  const state = qualitySnapshot()
  const event = state.eventVersions.find(
    (item) => item.eventCode === options.eventCode && item.isCurrent,
  )
  if (!event) {
    return { ok: false, message: `事件 ${options.eventCode} 没有当前版本`, attempts: [] }
  }
  const rule = listRuleOptions().find((item) => item.ruleCode === options.ruleCode)
  if (!rule) {
    return { ok: false, message: `审计规则 ${options.ruleCode} 不存在`, attempts: [] }
  }
  const existing = activeCheckFor(state, options.eventCode, options.ruleCode, event.versionLabel)
  if (existing) {
    return {
      ok: true,
      message: `事件 ${options.eventCode} 与规则 ${options.ruleCode} 已有生效快照 ${existing.checkId}，新的并发生效会被拒绝`,
      attempts: [],
      activeCheckId: existing.checkId,
    }
  }
  const createdIds: string[] = []
  for (const actor of options.actors) {
    const created = createQualityCheck({
      eventCode: options.eventCode,
      ruleCode: options.ruleCode,
      actor,
    })
    if (created.checkId) createdIds.push(created.checkId)
  }
  // 两人都拿到「草稿已生成」的同一数据版本，并各自算完全量异常，再抢同一个提交位置。
  const sharedRevision = qualitySnapshot().revision
  const attempts: ApplyAttempt[] = []
  let activeCheckId: string | undefined
  for (const checkId of createdIds) {
    const check = qualitySnapshot().checks.find((item) => item.checkId === checkId)
    const drafted = check ? previewBaseline(check) : 0
    const result = applyQualityCheck(checkId, {
      actor: options.actors[attempts.length],
      expectedRevision: sharedRevision,
    })
    attempts.push({
      ...result.attempt,
      draftedAnomalies: drafted,
      persistedAnomalies: result.ok ? result.attempt.persistedAnomalies : 0,
    })
    if (result.ok) activeCheckId = checkId
  }
  const winner = attempts.find((item) => item.ok)
  const loser = attempts.find((item) => !item.ok)
  return {
    ok: Boolean(winner),
    message: winner
      ? `并发生效只接受一个完整快照：${winner.checkId ?? ''} 提交成功并落库 ${winner.persistedAnomalies} 条异常；${loser?.actor ?? '失败方'} 已算完 ${loser?.draftedAnomalies ?? 0} 条草稿异常但提交失败，落库 0 条`
      : '两次并发生效都失败，没有写入快照',
    attempts,
    activeCheckId,
  }
}

/** 只计算不落库：用于并发生效时展示失败一侧「有草稿、无落库」。 */
function previewBaseline(check: QualityCheck): number {
  const state = qualitySnapshot()
  const batch = nextBatch(state, check)
  if (!batch) return 0
  const round = makeRound({
    state,
    check,
    kind: '基线扫描',
    batch,
    actor: check.createdBy,
    ranAt: check.createdAt,
    note: '并发生效预演',
  })
  return round.anomalies.length
}

/** 归档：单向终点，归档后不能恢复，也不能回到旧阶段或继续追加扫描。 */
export function archiveQualityCheck(checkId: string, actor: string, note = '审计结论归档'): CheckActionResult {
  const state = qualitySnapshot()
  const check = state.checks.find((item) => item.checkId === checkId)
  if (!check) {
    return { ok: false, message: `没有找到编号为 ${checkId} 的质量检查记录` }
  }
  try {
    assertSnapshotIntact(check)
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '快照校验失败' }
  }
  const guard = transitionGuard(check, '已归档')
  if (guard) {
    return { ok: false, message: guard }
  }
  const archivedAt = nowIso()
  const archived: QualityCheck = {
    ...check,
    stage: '已归档',
    archivedAt,
    stageLogs: [
      ...check.stageLogs,
      { stage: '已归档', at: archivedAt, actor, note },
    ],
  }
  saveQualityState({
    ...state,
    checks: state.checks.map((item) => (item.checkId === checkId ? archived : item)),
  })
  return { ok: true, message: `质量检查 ${checkId} 已归档，归档后不可恢复`, checkId }
}

/** 主动补一轮巡检：仍以冻结快照为准，与扫描时刻的消息比对。 */
export function runScheduledScan(checkId: string, actor: string): CheckActionResult {
  const state = qualitySnapshot()
  const check = state.checks.find((item) => item.checkId === checkId)
  if (!check) {
    return { ok: false, message: `没有找到编号为 ${checkId} 的质量检查记录` }
  }
  if (check.stage !== '已生效') {
    return {
      ok: false,
      message: `只有已生效的质量检查才能执行巡检，当前阶段「${check.stage}」`,
    }
  }
  if (retentionExpired(check)) {
    return {
      ok: false,
      message: `快照 ${check.snapshot.snapshotId} 已超过保留期（保留至 ${formatTime(
        check.snapshot.retentionUntil,
      )}），只能只读归档，不再参与扫描`,
    }
  }
  try {
    assertSnapshotIntact(check)
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '快照校验失败' }
  }
  const batch = nextBatch(state, check)
  if (!batch) {
    return { ok: false, message: `事件 ${check.eventCode} 没有新的消息批次可供巡检` }
  }
  const round = makeRound({
    state,
    check,
    kind: '定时扫描',
    batch,
    actor,
    ranAt: nowIso(),
    note: `AUDI-0002 下一轮扫描：只比对 ${check.snapshot.snapshotId} 与批次 ${batch.batchId} 的消息`,
  })
  const updated: QualityCheck = { ...check, rounds: [...check.rounds, round] }
  saveQualityState({
    ...state,
    checks: state.checks.map((item) => (item.checkId === checkId ? updated : item)),
  })
  return {
    ok: true,
    message: `已按快照 ${check.snapshot.snapshotId} 扫描批次 ${batch.batchId}，新增 ${round.anomalies.length} 条异常`,
    checkId,
    roundNo: round.roundNo,
    anomalies: round.anomalies.length,
  }
}

function diffCompatibility(from: EventVersion, to: ParameterFieldList): {
  compatibility: EventCompatibility
  notes: string[]
} {
  const before = new Map(from.parameterDict.map((field) => [field.name, field]))
  const after = new Map(to.map((field) => [field.name, field]))
  const notes: string[] = []
  let compatible = true

  for (const [name, field] of before) {
    if (!after.has(name)) {
      notes.push(`删除参数 ${name}（${field.label}）${field.required ? '，且原为必填' : ''}`)
      if (field.required) compatible = false
    }
  }
  for (const [name, field] of after) {
    const old = before.get(name)
    if (!old) {
      notes.push(`新增参数 ${name}（${field.label}）${field.required ? '，必填' : ''}`)
      if (field.required) compatible = false
      continue
    }
    if (old.type !== field.type) {
      notes.push(`参数 ${name} 类型由 ${old.type} 改为 ${field.type}`)
      compatible = false
    }
    if (old.valueMode === 'fixed' && field.valueMode === 'fixed' && old.snapshotValue !== field.snapshotValue) {
      notes.push(`参数 ${name} 固定口径由 ${old.snapshotValue} 改为 ${field.snapshotValue}`)
      compatible = false
    }
    if (old.valueMode === 'enum' && field.valueMode === 'fixed') {
      notes.push(`参数 ${name} 取值口径由枚举 ${(old.enumValues ?? []).join('/')} 收紧为固定 ${field.snapshotValue}`)
      compatible = false
    }
    if (old.valueMode === 'fixed' && field.valueMode === 'enum') {
      notes.push(`参数 ${name} 取值口径由固定 ${old.snapshotValue} 放宽为枚举 ${(field.enumValues ?? []).join('/')}`)
    }
    if (
      old.valueMode === 'enum' &&
      field.valueMode === 'enum' &&
      JSON.stringify(old.enumValues ?? []) !== JSON.stringify(field.enumValues ?? [])
    ) {
      notes.push(
        `参数 ${name} 枚举口径由 ${(old.enumValues ?? []).join('/')} 改为 ${(field.enumValues ?? []).join('/')}`,
      )
      compatible = false
    }
  }
  if (notes.length === 0) {
    notes.push('仅字段注释变化，参数结构与口径不变，判定兼容')
  }
  return { compatibility: compatible ? '兼容' : '不兼容', notes }
}

type ParameterFieldList = EventVersion['parameterDict']

/**
 * 事件改版：生成新版本，并把所有已生效快照各追加一轮「事件改版」异常。
 * 旧快照、旧轮次和旧质量结论原样保留，改版不能改写它们。
 */
export function reviseEvent(options: {
  eventCode: string
  actor: string
  toVersionLabel?: string
  notes?: string[]
}): ReviseResult {
  try {
    return reviseEventUnsafe(options)
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : '事件改版失败，未写入任何变更',
    }
  }
}

function reviseEventUnsafe(options: {
  eventCode: string
  actor: string
  toVersionLabel?: string
  notes?: string[]
}): ReviseResult {
  const state = qualitySnapshot()
  const from = state.eventVersions.find(
    (item) => item.eventCode === options.eventCode && item.isCurrent,
  )
  if (!from) {
    return { ok: false, message: `事件 ${options.eventCode} 没有当前版本，无法改版` }
  }
  const toLabel = options.toVersionLabel ?? 'v22'
  if (state.eventVersions.some((item) => item.eventCode === options.eventCode && item.versionLabel === toLabel)) {
    return { ok: false, message: `事件 ${options.eventCode} 的版本 ${toLabel} 已存在` }
  }
  if (options.eventCode !== 'EVEN-0002' || toLabel !== 'v22') {
    return {
      ok: false,
      message: '当前样例只提供 EVEN-0002 从 v7 改版到 v22 的演示数据',
    }
  }
  const template = even0002VersionV22()
  const nextVersion: EventVersion = {
    ...template,
    isCurrent: true,
    parameterDict: EVEN_0002_V22_FIELDS,
    compatibilityNotes: options.notes ?? EVEN_0002_V22_NOTES,
  }
  const diff = diffCompatibility(from, nextVersion.parameterDict)
  nextVersion.compatibility = diff.compatibility
  nextVersion.compatibilityNotes = diff.notes

  const revisedAt = nowIso()
  const revisions: EventRevision[] = [
    ...state.revisions,
    {
      revisionId: `REV-${String(state.revisions.length + 1).padStart(4, '0')}`,
      eventCode: options.eventCode,
      fromVersion: from.versionLabel,
      toVersion: nextVersion.versionLabel,
      actor: options.actor,
      revisedAt,
      compatibility: nextVersion.compatibility,
      notes: diff.notes,
      appendedChecks: [],
    },
  ]
  const revision = revisions[revisions.length - 1]

  const updatedChecks = state.checks.map((check) => {
    if (check.eventCode !== options.eventCode) return check
    if (check.stage !== '已生效') return check
    const batch = nextBatch(state, check)
    if (!batch) return check
    assertSnapshotIntact(check)
    const round = makeRound({
      state,
      check,
      kind: '事件改版',
      batch,
      actor: options.actor,
      ranAt: revisedAt,
      note: `事件改版 ${from.versionLabel} → ${nextVersion.versionLabel}（${diff.compatibility}），快照仍为 ${check.snapshot.snapshotId}，只追加新异常`,
      nextVersion,
    })
    revision.appendedChecks.push({
      checkId: check.checkId,
      roundNo: round.roundNo,
      anomalies: round.anomalies.length,
    })
    return { ...check, rounds: [...check.rounds, round] }
  })

  // 改版时把旧版本的当前标志复位，新版本成为唯一当前版本。
  const eventVersions = state.eventVersions.map((item) =>
    item.eventCode === options.eventCode ? { ...item, isCurrent: false } : item,
  )
  saveQualityState({
    ...state,
    checks: updatedChecks,
    eventVersions: [...eventVersions, nextVersion],
    revisions,
  })
  const appended = revision.appendedChecks
    .map((item) => `${item.checkId} 第 ${item.roundNo} 轮 +${item.anomalies} 条异常`)
    .join('；')
  return {
    ok: true,
    message: `事件 ${options.eventCode} 已从 ${from.versionLabel} 改版到 ${nextVersion.versionLabel}（${nextVersion.compatibility}）${appended ? `；旧快照追加新异常：${appended}` : ''}`,
    fromVersion: from.versionLabel,
    toVersion: nextVersion.versionLabel,
    compatibility: nextVersion.compatibility,
    notes: diff.notes,
    appendedChecks: revision.appendedChecks,
  }
}

/** 事件详情：版本链、改版记录、关联质量检查（与审计记录引用同一 checkId）。 */
export function loadEventDetail(eventCode: string): {
  versions: EventVersion[]
  revisions: EventRevision[]
  checks: QualityCheck[]
  retentionPolicy: string
} {
  const state = qualitySnapshot()
  return {
    versions: state.eventVersions
      .filter((item) => item.eventCode === eventCode)
      .sort((left, right) => right.versionNumber - left.versionNumber),
    revisions: state.revisions
      .filter((item) => item.eventCode === eventCode)
      .slice()
      .sort((left, right) => right.revisedAt.localeCompare(left.revisedAt)),
    checks: state.checks.filter((item) => item.eventCode === eventCode),
    retentionPolicy: RETENTION_POLICY.summary,
  }
}

/** 按快照字段逐字段复核：取该检查最近一轮扫描批次的消息分布。 */
export function buildFieldReview(checkId: string, roundNo?: number): FieldReviewRow[] {
  const state = qualitySnapshot()
  const check = state.checks.find((item) => item.checkId === checkId)
  if (!check) return []
  const round =
    (roundNo !== undefined ? check.rounds.find((item) => item.roundNo === roundNo) : undefined) ??
    check.rounds[check.rounds.length - 1]
  const batch = round ? state.messageBatches.find((item) => item.batchId === round.messageBatchId) : undefined
  return check.snapshot.parameterDict.map((field) => {
    const locator = anomalyLocator(check.eventCode, field.name)
    if (!batch) {
      return {
        field: field.name,
        locator,
        label: field.label,
        required: field.required,
        annotation: field.annotation,
        snapshotValue: field.snapshotValue,
        observedValues: '尚无扫描批次',
        status: '未采集' as const,
      }
    }
    const raw = batch.messages.map((message) => message.params[field.name])
    const present = raw.filter((value): value is string => value !== undefined && value !== '')
    const missing = batch.messages.length - present.length
    const values = [...new Set(present)]
    let status: FieldReviewRow['status'] = '一致'
    if (missing > 0 && field.required) status = '缺失'
    else if (values.some((value) => evaluateField(field, { params: { [field.name]: value } } as ScanMessage) !== null)) {
      status = '漂移'
    }
    return {
      field: field.name,
      locator,
      label: field.label,
      required: field.required,
      annotation: field.annotation,
      snapshotValue: field.snapshotValue,
      observedValues: `${values.join(' / ') || '（未上报）'}${missing > 0 ? `（${missing} 条缺失）` : ''}`,
      status,
    }
  })
}

/** 修复清单：汇总所有轮次的异常，按定位字段去重，保留最后一次命中。 */
export function buildFixList(checkId: string): FixItem[] {
  const check = getQualityCheck(checkId)
  if (!check) return []
  const merged = new Map<string, FixItem>()
  for (const round of check.rounds) {
    for (const anomaly of round.anomalies) {
      merged.set(anomaly.locator, {
        locator: anomaly.locator,
        field: anomaly.field,
        kind: anomaly.kind,
        level: anomaly.level,
        suggestion: anomaly.fixSuggestion,
      })
    }
  }
  return [...merged.values()].sort((left, right) => left.locator.localeCompare(right.locator))
}

export function checkSummary(check: QualityCheck): {
  rounds: number
  anomalies: number
  p1: number
  latestRound: AuditRound | undefined
  flatRate: string
} {
  const anomalies = check.rounds.reduce((sum, round) => sum + round.anomalies.length, 0)
  const p1 = check.rounds.reduce(
    (sum, round) => sum + round.anomalies.filter((item) => item.level === 'P1').length,
    0,
  )
  const latestRound = check.rounds.length > 0 ? check.rounds[check.rounds.length - 1] : undefined
  return {
    rounds: check.rounds.length,
    anomalies,
    p1,
    latestRound,
    flatRate: `${check.snapshot.validationFields.length} 个校验字段`,
  }
}

export function qualityOverview(): {
  total: number
  draft: number
  active: number
  archived: number
  anomalies: number
  frozen: number
} {
  const checks = qualitySnapshot().checks
  return {
    total: checks.length,
    draft: checks.filter((item) => item.stage === '草稿').length,
    active: checks.filter((item) => item.stage === '已生效').length,
    archived: checks.filter((item) => item.stage === '已归档').length,
    anomalies: checks.reduce(
      (sum, check) => sum + check.rounds.reduce((inner, round) => inner + round.anomalies.length, 0),
      0,
    ),
    frozen: checks.filter((item) => item.frozen).length,
  }
}

export function checkRows(): QualityCheck[] {
  return listQualityChecks()
}

export function resetQualityChecks(): void {
  resetQualityState()
}

export function eventRowOf(eventCode: string): EntryRow | undefined {
  return listEntries('eventdef').items.find((item) => String(item['事件编号']) === eventCode)
}

export function timeLabel(iso: string | undefined): string {
  return formatTime(iso)
}
