/** 质量检查模块的纯函数工具：稳定克隆、快照指纹、字段文本解析和时间格式化。 */

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/**
 * 快照指纹只覆盖快照内容本身（不含 fingerprint 字段）。
 * 冻结后可用它校验快照没有被页面或后续改版改写。
 */
export function snapshotFingerprint(snapshot: Object): string {
  const { fingerprint, ...content } = snapshot as Record<string, unknown>
  void fingerprint
  const text = JSON.stringify(content)
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

/** 「source、platform, content_id; is_new_user」这类规则字段文本拆成数组。 */
export function splitFieldList(text: string): string[] {
  return text
    .split(/[，,、;；\s]+/)
    .map((item) => item.trim())
    .filter((item) => item !== '')
}

/** ISO 时间转成页面展示的本地格式；无法解析时原样返回。 */
export function formatTime(value: string | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const pad = (input: number) => String(input).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 保留期按自然月推进，用于「快照保留 24 个月」的到期时间。 */
export function addMonths(iso: string, months: number): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  date.setMonth(date.getMonth() + months)
  return date.toISOString()
}

export function nowIso(): string {
  return new Date().toISOString()
}
