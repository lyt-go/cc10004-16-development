import type { AuditAnomaly, EventVersion, ParameterField, SnapshotContent } from './quality-types'
import { addMonths, splitFieldList } from './quality-utils'

/**
 * EVEN-0002 / AUDI-0002 的领域样例。
 * 事件侧只描述「版本」，规则侧只描述「规则正文」；二者在生成质量检查记录时才绑定成快照。
 */

/** 2026-11-12 EVEN-0002 的上报参数（snapshot-v7 的内容来源）。 */
export const EVEN_0002_SNAPSHOT_FIELDS: ParameterField[] = [
  {
    name: 'source',
    label: '来源渠道',
    type: 'string',
    required: true,
    valueMode: 'fixed',
    annotation: '投放来源渠道，固定取 feed',
    snapshotValue: 'feed',
  },
  {
    name: 'platform',
    label: '平台类型',
    type: 'string',
    required: true,
    valueMode: 'fixed',
    annotation: '客户端平台，web 表示浏览器 Web 端',
    snapshotValue: 'web',
  },
  {
    name: 'content_id',
    label: '内容标识',
    type: 'string',
    required: true,
    valueMode: 'free',
    annotation: '信息流内容唯一 ID，自由取值',
    snapshotValue: 'feed-1001',
  },
  {
    name: 'is_new_user',
    label: '新用户标记',
    type: 'boolean',
    required: false,
    valueMode: 'enum',
    enumValues: ['true', 'false'],
    annotation: '首次进入产品的用户上报 true；老用户可不传',
    snapshotValue: 'false',
  },
  {
    name: 'ab_bucket',
    label: '分流桶',
    type: 'string',
    required: false,
    valueMode: 'free',
    annotation: '分流实验桶标识，未参与实验时为空',
    snapshotValue: 'bucket-a',
  },
]

/** EVEN-0002 改版后的参数（v22）：只用来产生新异常，不写回 snapshot-v7。 */
export const EVEN_0002_V22_FIELDS: ParameterField[] = [
  {
    name: 'source',
    label: '来源渠道',
    type: 'string',
    required: true,
    valueMode: 'enum',
    enumValues: ['feed', 'organic'],
    annotation: '投放来源渠道；站内自然流量写 organic（v22 起扩展）',
    snapshotValue: 'feed',
  },
  {
    name: 'platform',
    label: '平台类型',
    type: 'string',
    required: true,
    valueMode: 'fixed',
    annotation: '客户端平台，web 表示浏览器 Web 端',
    snapshotValue: 'web',
  },
  {
    name: 'content_id',
    label: '内容标识',
    type: 'string',
    required: true,
    valueMode: 'free',
    annotation: '信息流内容唯一标识，v22 起统一为雪花 ID 字符串',
    snapshotValue: 'feed-1001',
  },
  {
    name: 'timestamp',
    label: '曝光时间',
    type: 'number',
    required: true,
    valueMode: 'free',
    annotation: 'v22 新增：毫秒级曝光时间戳，用于校准曝光口径',
    snapshotValue: '0',
  },
  {
    name: 'ab_bucket',
    label: '分流桶',
    type: 'string',
    required: false,
    valueMode: 'free',
    annotation: '分流实验桶标识，未参与实验时为空',
    snapshotValue: 'bucket-a',
  },
]

export const EVEN_0002_V22_NOTES = [
  '删除可选参数 is_new_user，新用户标记改由 user_profile 关联计算',
  '新增必填参数 timestamp（毫秒时间戳），曝光时间以消息为准',
  'source 取值口径由固定 feed 扩展为枚举 feed / organic',
  'content_id 字段注释更新为雪花 ID 字符串，取值格式不变',
]

export const EVEN_0002_TRIGGER_TEXT =
  '当用户进入信息流页面并完成内容曝光时上报：页面 path 匹配 /feed 且曝光时长 >= 500ms，同一 content_id 每会话最多上报一次。'

export const AUDI_0002_ANOMALY_TEXT =
  'source != feed 或 platform != web；message.params 缺少 source / platform / content_id；同一设备 1 分钟内重复上报超过 3 条'

export const AUDI_0002_VALIDATION_FIELDS = ['source', 'platform', 'content_id', 'is_new_user']

export const AUDI_0002_FREQUENCY = '每日 02:00 全量扫描近 24 小时消息'

export const SNAPSHOT_RETENTION_MONTHS = 24

/** 审计规则 AUDI-0002 的规则正文；快照只冻结这些字段的文本，不反向写规则表。 */
export const AUDI_0002_RULE = {
  ruleCode: 'AUDI-0002',
  ruleName: '信息流曝光参数完整性审计',
  auditTarget: 'EVEN-0002 信息流曝光上报消息',
  validationFieldsText: AUDI_0002_VALIDATION_FIELDS.join('、'),
  anomalyConditionsText: AUDI_0002_ANOMALY_TEXT,
  frequencyText: AUDI_0002_FREQUENCY,
}

export function even0002VersionV7(): EventVersion {
  return {
    eventCode: 'EVEN-0002',
    eventName: '信息流曝光',
    versionLabel: 'v7',
    versionNumber: 7,
    isCurrent: true,
    parameterDict: EVEN_0002_SNAPSHOT_FIELDS,
    triggerConditionText: EVEN_0002_TRIGGER_TEXT,
    samplingRatio: '25%',
    samplingSourcePage: '事件定义 / EVEN-0002 / 采样策略页（v7，2026-11-12 修订）',
    samplingChangedBy: '周敏（数据产品运营）',
    samplingChangedAt: '2026-11-12T09:40:00+08:00',
    changedBy: '周敏（数据产品运营）',
    changedAt: '2026-11-12T09:40:00+08:00',
    changeReason: '信息流曝光量回升，采样比例从 5% 调至 25%',
    compatibility: '基线',
    compatibilityNotes: ['首次纳入审计的基线版本，无历史兼容判断'],
  }
}

export function even0002VersionV22(): EventVersion {
  return {
    eventCode: 'EVEN-0002',
    eventName: '信息流曝光',
    versionLabel: 'v22',
    versionNumber: 22,
    isCurrent: false,
    parameterDict: EVEN_0002_V22_FIELDS,
    triggerConditionText: EVEN_0002_TRIGGER_TEXT,
    samplingRatio: '25%',
    samplingSourcePage: '事件定义 / EVEN-0002 / 采样策略页（v22，2026-11-13 修订）',
    samplingChangedBy: '周敏（数据产品运营）',
    samplingChangedAt: '2026-11-13T15:20:00+08:00',
    changedBy: '李哲（客户端研发）',
    changedAt: '2026-11-13T15:20:00+08:00',
    changeReason: '曝光口径校准：补充 timestamp，下线 is_new_user',
    compatibility: '不兼容',
    compatibilityNotes: EVEN_0002_V22_NOTES,
  }
}

/** 生成 snapshot-v7 的内容；fingerprint 与 boundCheckId 由服务层在生成/生效时写入。 */
export function buildSnapshotV7(capturedAt = '2026-11-12T10:05:00+08:00'): SnapshotContent {
  return {
    snapshotId: 'snapshot-v7',
    eventCode: 'EVEN-0002',
    eventName: '信息流曝光',
    parameterVersion: 7,
    versionLabel: 'v7',
    capturedAt,
    parameterDict: EVEN_0002_SNAPSHOT_FIELDS,
    triggerConditionText: EVEN_0002_TRIGGER_TEXT,
    samplingRatio: '25%',
    samplingSourcePage: '事件定义 / EVEN-0002 / 采样策略页（v7，2026-11-12 修订）',
    samplingChangedBy: '周敏（数据产品运营）',
    samplingChangedAt: '2026-11-12T09:40:00+08:00',
    samplingHistory: [
      {
        ratio: '5%',
        changedAt: '2026-10-01T10:00:00+08:00',
        changedBy: '周敏（数据产品运营）',
        sourcePage: '事件定义 / EVEN-0002 / 采样策略页（v5）',
        note: '事件上线时默认 5% 采样',
      },
      {
        ratio: '25%',
        changedAt: '2026-11-12T09:40:00+08:00',
        changedBy: '周敏（数据产品运营）',
        sourcePage: '事件定义 / EVEN-0002 / 采样策略页（v7，2026-11-12 修订）',
        note: '信息流曝光量回升，采样比例从 5% 调至 25%',
      },
    ],
    versionChangedBy: '周敏（数据产品运营）',
    ruleCode: AUDI_0002_RULE.ruleCode,
    validationFields: splitFieldList(AUDI_0002_RULE.validationFieldsText),
    anomalyConditions: AUDI_0002_RULE.anomalyConditionsText,
    auditFrequency: AUDI_0002_RULE.frequencyText,
    ruleBinding: {
      versionPointer: 'EVEN-0002@v7',
      validationFieldsVersion: 'EVEN-0002@v7',
      auditFrequencyVersion: 'EVEN-0002@v7',
    },
    bindingWarnings: [],
    retentionMonths: SNAPSHOT_RETENTION_MONTHS,
    retentionUntil: addMonths(capturedAt, SNAPSHOT_RETENTION_MONTHS),
    fingerprint: '',
    boundCheckId: '',
  }
}

export function anomalyLocator(eventCode: string, fieldName: string): string {
  return `${eventCode}.params.${fieldName}`
}

export function buildAnomaly(options: {
  id: string
  eventCode: string
  field: ParameterField
  kind: AuditAnomaly['kind']
  detail: string
  observedValue: string
  level?: AuditAnomaly['level']
}): AuditAnomaly {
  const { field } = options
  return {
    id: options.id,
    locator: anomalyLocator(options.eventCode, field.name),
    field: field.name,
    fieldLabel: field.label,
    kind: options.kind,
    level: options.level ?? (field.required ? 'P1' : 'P2'),
    snapshotValue: field.snapshotValue,
    observedValue: options.observedValue,
    detail: options.detail,
    fixSuggestion:
      options.kind === '缺失参数'
        ? `在 ${options.eventCode} 上报路径补齐 ${field.name}（${field.label}），确认必填校验先于发送执行`
        : options.kind === '兼容变更'
          ? `确认 ${field.name} 的新口径已登记事件版本，并按新版本重新生成质量检查记录`
          : `把 ${field.name} 上报值改回快照口径 ${field.snapshotValue}，或走事件改版流程并重新绑定审计规则`,
  }
}
