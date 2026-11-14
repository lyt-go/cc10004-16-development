/**
 * 埋点参数快照与审计规则绑定相关的领域类型。
 *
 * 一条「质量检查记录」= 一次事件参数快照 + 一条审计规则的冻结绑定。
 * 快照生成时是草稿，规则生效时冻结；冻结后事件改版只能追加新的审计异常，
 * 不能改写已有快照、扫描轮次或旧的质量结论。
 */

export type ParameterFieldType = 'string' | 'number' | 'boolean'

/** 参数取值口径：固定值 / 枚举 / 自由取值（自由取值只校验类型和是否缺失）。 */
export type ParameterValueMode = 'fixed' | 'enum' | 'free'

export type ParameterField = {
  /** 参数名，例如 source */
  name: string
  /** 字段中文名，例如 来源渠道 */
  label: string
  type: ParameterFieldType
  required: boolean
  /** 取值口径；fixed 时实际值必须与 snapshotValue 一致 */
  valueMode: ParameterValueMode
  /** 枚举取值；valueMode=enum 时生效 */
  enumValues?: string[]
  /** 字段注释，随快照一起冻结 */
  annotation: string
  /** 快照时该参数的基准取值，审计时用于逐字段复核 */
  snapshotValue: string
}

export type EventCompatibility = '基线' | '兼容' | '不兼容'

export type EventVersion = {
  eventCode: string
  eventName: string
  versionLabel: string
  versionNumber: number
  /** 当前线上版本只有一条 */
  isCurrent: boolean
  parameterDict: ParameterField[]
  /** 触发条件原文，快照必须原样保留 */
  triggerConditionText: string
  samplingRatio: string
  /** 采样比例来源页 */
  samplingSourcePage: string
  /** 采样比例变更人 */
  samplingChangedBy: string
  samplingChangedAt: string
  /** 本次版本变更人 */
  changedBy: string
  changedAt: string
  changeReason: string
  compatibility: EventCompatibility
  compatibilityNotes: string[]
}

export type RuleBinding = {
  /** 规则绑定锚点，三条必须指向同一个快照版本 */
  versionPointer: string
  validationFieldsVersion: string
  auditFrequencyVersion: string
}

export type SamplingChange = {
  ratio: string
  changedAt: string
  changedBy: string
  sourcePage: string
  note: string
}

export type SnapshotContent = {
  /** 例如 snapshot-v7 */
  snapshotId: string
  eventCode: string
  eventName: string
  parameterVersion: number
  versionLabel: string
  capturedAt: string
  parameterDict: ParameterField[]
  triggerConditionText: string
  samplingRatio: string
  samplingSourcePage: string
  samplingChangedBy: string
  samplingChangedAt: string
  /** 采样比例变更轨迹，保留原比例与变更依据 */
  samplingHistory: SamplingChange[]
  /** 事件版本变更人，快照保留改版责任链 */
  versionChangedBy: string
  /** 绑定的审计规则编号 */
  ruleCode: string
  /** 规则校验字段（快照时点） */
  validationFields: string[]
  /** 规则异常条件原文（快照时点） */
  anomalyConditions: string
  /** 规则审计频率（快照时点） */
  auditFrequency: string
  ruleBinding: RuleBinding
  /** 生成时发现的口径提示：校验字段不在参数字典、审计频率版本不一致等 */
  bindingWarnings: string[]
  retentionMonths: number
  retentionUntil: string
  /** 快照指纹，生效后作为完整性校验 */
  fingerprint: string
  /** 反向引用质量检查记录，事件详情与审计记录的同一检查锚点 */
  boundCheckId: string
}

export type CheckStage = '草稿' | '已生效' | '已归档'

export type StageLog = {
  stage: CheckStage
  at: string
  actor: string
  note: string
}

export type AnomalyKind =
  | '缺失参数'
  | '口径漂移'
  | '采样偏差'
  | '类型变更'
  | '触发条件变更'
  | '重复上报'
  | '兼容变更'

export type AnomalyLevel = 'P1' | 'P2' | 'P3'

export type AuditAnomaly = {
  id: string
  /** 字段定位，例如 EVEN-0002.params.platform */
  locator: string
  field: string
  fieldLabel: string
  kind: AnomalyKind
  level: AnomalyLevel
  snapshotValue: string
  observedValue: string
  detail: string
  /** 修复清单的定位与建议 */
  fixSuggestion: string
}

export type AuditRoundKind = '基线扫描' | '事件改版' | '定时扫描'

export type AuditRound = {
  roundId: string
  roundNo: number
  kind: AuditRoundKind
  ranAt: string
  actor: string
  snapshotId: string
  snapshotVersionLabel: string
  /** 该轮审计时事件线上版本；改版后与快照版本不同是预期行为 */
  eventVersionLabel: string
  messageBatchId: string
  note: string
  anomalies: AuditAnomaly[]
}

export type QualityCheck = {
  checkId: string
  eventCode: string
  eventName: string
  ruleCode: string
  ruleName: string
  stage: CheckStage
  stageLogs: StageLog[]
  createdBy: string
  createdAt: string
  effectiveAt?: string
  archivedAt?: string
  /** 生效后为 true，快照内容不能再被修改 */
  frozen: boolean
  snapshot: SnapshotContent
  rounds: AuditRound[]
}

export type ScanMessage = {
  messageId: string
  receivedAt: string
  sourcePage: string
  samplingRate: string
  params: Record<string, string>
}

export type MessageBatch = {
  batchId: string
  eventCode: string
  windowStart: string
  windowEnd: string
  collectedAt: string
  label: string
  messages: ScanMessage[]
}

export type RevisionAppend = {
  checkId: string
  roundNo: number
  anomalies: number
}

export type EventRevision = {
  revisionId: string
  eventCode: string
  fromVersion: string
  toVersion: string
  actor: string
  revisedAt: string
  compatibility: EventCompatibility
  notes: string[]
  /** 改版后关联生效快照新追加的轮次 */
  appendedChecks: RevisionAppend[]
}

export type QualityState = {
  revision: number
  checks: QualityCheck[]
  eventVersions: EventVersion[]
  revisions: EventRevision[]
  messageBatches: MessageBatch[]
}

export type FieldReviewRow = {
  field: string
  locator: string
  label: string
  required: boolean
  annotation: string
  snapshotValue: string
  observedValues: string
  status: '一致' | '缺失' | '漂移' | '未采集'
}

export type FixItem = {
  locator: string
  field: string
  kind: AnomalyKind
  level: AnomalyLevel
  suggestion: string
}

export type StageChangeResult = {
  ok: boolean
  message: string
}

export type CheckActionResult = StageChangeResult & {
  checkId?: string
  roundNo?: number
  anomalies?: number
}

export type ApplyAttempt = {
  actor: string
  ok: boolean
  message: string
  checkId?: string
  /** 该次尝试生成但未持久化的异常数 */
  draftedAnomalies: number
  persistedAnomalies: number
}

export type ConcurrentApplyResult = {
  ok: boolean
  message: string
  attempts: ApplyAttempt[]
  activeCheckId?: string
}

export type ReviseResult = StageChangeResult & {
  fromVersion?: string
  toVersion?: string
  compatibility?: EventCompatibility
  notes?: string[]
  appendedChecks?: RevisionAppend[]
}

export type EventOption = {
  eventCode: string
  eventName: string
  versionLabel: string
  status: string
}

export type RuleOption = {
  ruleCode: string
  ruleName: string
  auditTarget: string
  validationFieldsText: string
  anomalyConditionsText: string
  auditFrequencyText: string
  status: string
}
