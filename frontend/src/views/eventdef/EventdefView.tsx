import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { downloadEntries, listEntries, moduleMeta, runAction as applyAction } from '@/api/local-service'
import {
  RETENTION_POLICY,
  buildFieldReview,
  buildFixList,
  loadEventDetail,
  reviseEvent,
} from '@/api/quality-service'
import type { EntryRow } from '@/data/types'
import type { EventVersion, QualityCheck } from '@/data/quality-types'
import { formatTime } from '@/data/quality-utils'
import QualityCheckDetail from '@/views/quality/QualityCheckDetail'

const meta = moduleMeta('eventdef')
const columns = [
  "事件编号",
  "事件名称",
  "事件类型",
  "触发条件",
  "上报参数",
  "采样比例",
  "所属产品",
  "事件负责人"
]
const actions = [
  "提交事件评审",
  "发布事件",
  "下线事件"
]
const statuses = [
  "草稿",
  "事件评审中",
  "已发布",
  "已下线"
]
const stats = [
  {
    "label": "埋点事件总数",
    "value": 0
  },
  {
    "label": "已发布事件",
    "value": 0
  },
  {
    "label": "事件评审中",
    "value": 0
  }
]

function VersionCard({ version, current }: { version: EventVersion; current: boolean }) {
  return (
    <article className={`version-card${current ? ' current' : ''}`}>
      <header>
        <strong>{version.versionLabel}</strong>
        {current && <span className="badge badge-active">当前版本</span>}
        <span className={`badge ${version.compatibility === '不兼容' ? 'badge-p1' : version.compatibility === '兼容' ? 'badge-p2' : 'badge-draft'}`}>
          {version.compatibility}
        </span>
      </header>
      <p className="detail-note">
        变更人 {version.changedBy} · {formatTime(version.changedAt)} · 采样 {version.samplingRatio}（{version.samplingChangedBy}，
        {formatTime(version.samplingChangedAt)}）
      </p>
      <p className="detail-note">{version.changeReason}</p>
      <table className="data-table compact">
        <thead><tr><th>参数名</th><th>字段</th><th>类型</th><th>必填</th><th>取值口径</th><th>注释</th></tr></thead>
        <tbody>
          {version.parameterDict.map((field) => (
            <tr key={field.name}>
              <td><code>{field.name}</code></td>
              <td>{field.label}</td>
              <td>{field.type}</td>
              <td>{field.required ? '是' : '否'}</td>
              <td>
                {field.valueMode === 'fixed' && `固定 ${field.snapshotValue}`}
                {field.valueMode === 'enum' && `枚举 ${(field.enumValues ?? []).join(' / ')}`}
                {field.valueMode === 'free' && '自由取值'}
              </td>
              <td>{field.annotation}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {version.compatibilityNotes.length > 0 && (
        <ul className="note-list">
          {version.compatibilityNotes.map((note, index) => <li key={index}>{note}</li>)}
        </ul>
      )}
    </article>
  )
}

export default function EventdefView() {
  const [rows, setRows] = useState<EntryRow[]>([])
  const [total, setTotal] = useState(0)
  const [errorMessage, setErrorMessage] = useState('')
  const [filters, setFilters] = useState<Record<string, string>>({})
  const filterFields = useMemo(() => columns.slice(0, 3), [])

  const [searchParams, setSearchParams] = useSearchParams()
  const [selectedEvent, setSelectedEvent] = useState(searchParams.get('event') ?? 'EVEN-0002')
  const [detail, setDetail] = useState(() => loadEventDetail(searchParams.get('event') ?? 'EVEN-0002'))
  const [notice, setNotice] = useState('')
  const [detailError, setDetailError] = useState('')
  const [busy, setBusy] = useState(false)

  const chosenCheckId = searchParams.get('check') ?? ''
  const chosenCheck: QualityCheck | undefined =
    detail.checks.find((item) => item.checkId === chosenCheckId) ?? detail.checks[detail.checks.length - 1]

  const reload = useCallback(() => {
    setErrorMessage('')
    try {
      const payload = listEntries(meta.key, filters)
      setRows(payload.items)
      setTotal(payload.total)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '事件定义列表读取失败')
    }
  }, [filters])

  const reloadDetail = useCallback(() => {
    setDetail(loadEventDetail(selectedEvent))
  }, [selectedEvent])

  useEffect(() => {
    reload()
  }, [reload])

  useEffect(() => {
    reloadDetail()
  }, [reloadDetail])

  function runAction(action: string, row: EntryRow) {
    setErrorMessage('')
    const result = applyAction(meta.key, Number(row.id), action)
    if (!result.ok) {
      setErrorMessage(result.message)
      return
    }
    reload()
  }

  function handleRevise() {
    setDetailError('')
    setNotice('')
    setBusy(true)
    const result = reviseEvent({ eventCode: selectedEvent, actor: '李哲（客户端研发）' })
    setBusy(false)
    if (!result.ok) {
      setDetailError(result.message)
      return
    }
    setNotice(result.message)
    reloadDetail()
  }

  return (
    <section className="page" data-module="eventdef">
      <header className="page-head">
        <div>
          <h2>事件定义管理</h2>
          <p className="page-desc">管理数据产品的埋点事件定义，规范事件命名、参数结构和采样策略。</p>
        </div>
        <div className="page-actions">
          <button className="btn primary" type="button" onClick={() => setErrorMessage('埋点事件登记入口尚未接入审批流')}>
            登记埋点事件
          </button>
          <button className="btn" type="button" onClick={() => downloadEntries(meta.key)}>
            导出事件定义清单
          </button>
        </div>
      </header>

      <div className="stat-row">
        {stats.map((item) => (
          <article key={item.label} className="stat-card">
            <span className="stat-label">{item.label}</span>
            <strong className="stat-value">{item.value}</strong>
          </article>
        ))}
        <article className="stat-card">
          <span className="stat-label">参数版本</span>
          <strong className="stat-value">{detail.versions.length}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">关联质量检查</span>
          <strong className="stat-value">{detail.checks.length}</strong>
        </article>
      </div>

      <p className="status-legend">
        {statuses.map((status: string) => (
          <span key={status} className="legend-item">
            {status}：{rows.filter((row) => String(row.status) === status).length}
          </span>
        ))}
      </p>

      <form className="filter-bar" onSubmit={(event) => { event.preventDefault(); reload() }}>
        {filterFields.map((field) => (
          <label key={field} className="filter-item">
            <span>{field}</span>
            <input
              value={filters[field] ?? ''}
              placeholder={`按${field}检索`}
              onChange={(event) => setFilters((prev) => ({ ...prev, [field]: event.target.value }))}
            />
          </label>
        ))}
        <button className="btn" type="submit">查询</button>
        <button className="btn ghost" type="button" onClick={() => setFilters({})}>重置条件</button>
      </form>

      <table className="data-table">
        <thead>
          <tr>
            {columns.map((column) => <th key={column}>{column}</th>)}
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={String(row.id)}>
              {columns.map((column) => <td key={column}>{row[column] ?? '—'}</td>)}
              <td>{row.status}</td>
              <td className="row-actions">
                {actions.map((action) => (
                  <button key={action} className="link" type="button" onClick={() => runAction(action, row)}>
                    {action}
                  </button>
                ))}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td className="empty-state" colSpan={columns.length + 2}>暂无事件定义数据，可先登记埋点事件</td>
            </tr>
          )}
        </tbody>
      </table>

      <footer className="page-foot">
        <span>共 {total} 条事件定义记录</span>
        {errorMessage && <span className="error-text">{errorMessage}</span>}
      </footer>

      <section className="panel" data-testid="event-detail-panel">
        <header className="panel-head">
          <div>
            <h3>事件详情与参数版本</h3>
            <p className="page-desc">
              改版只能新增版本并追加新的审计异常；已冻结快照里的旧参数、旧字段注释与旧质量结论保持不变。
              快照保留 {RETENTION_POLICY.months} 个月。
            </p>
          </div>
          <div className="page-actions">
            <select
              value={selectedEvent}
              onChange={(event) => {
                const next = event.target.value
                setSelectedEvent(next)
                setSearchParams((prev) => {
                  const params = new URLSearchParams(prev)
                  params.set('event', next)
                  params.delete('check')
                  return params
                })
              }}
            >
              <option value="EVEN-0002">EVEN-0002 信息流曝光</option>
            </select>
            <button className="btn primary" type="button" onClick={handleRevise} disabled={busy}>
              发布事件改版 v22
            </button>
          </div>
        </header>

        {notice && <p className="success-text">{notice}</p>}
        {detailError && <p className="error-text">{detailError}</p>}

        <h4 className="section-title">版本链</h4>
        <div className="version-stack">
          {detail.versions.map((version) => (
            <VersionCard
              key={version.versionLabel}
              version={version}
              current={detail.versions[0]?.versionLabel === version.versionLabel}
            />
          ))}
        </div>

        <h4 className="section-title">改版记录</h4>
        {detail.revisions.length === 0 ? (
          <p className="hint-text">还没有改版记录。</p>
        ) : (
          <table className="data-table compact">
            <thead><tr><th>改版编号</th><th>版本</th><th>兼容判断</th><th>变更人</th><th>时间</th><th>追加异常</th></tr></thead>
            <tbody>
              {detail.revisions.map((revision) => (
                <tr key={revision.revisionId}>
                  <td><code>{revision.revisionId}</code></td>
                  <td>{revision.fromVersion} → {revision.toVersion}</td>
                  <td>{revision.compatibility}</td>
                  <td>{revision.actor}</td>
                  <td>{formatTime(revision.revisedAt)}</td>
                  <td>
                    {revision.appendedChecks.length === 0
                      ? '—'
                      : revision.appendedChecks
                          .map((item) => `${item.checkId} 第 ${item.roundNo} 轮 +${item.anomalies}`)
                          .join('；')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <h4 className="section-title">关联质量检查（与审计记录同一次检查）</h4>
        {detail.checks.length === 0 ? (
          <p className="hint-text">该事件还没有质量检查记录，请到「数据审计」生成。</p>
        ) : (
          <div className="check-list">
            {detail.checks.map((check) => (
              <button
                key={check.checkId}
                type="button"
                className={`check-chip${chosenCheck?.checkId === check.checkId ? ' selected' : ''}`}
                onClick={() =>
                  setSearchParams((prev) => {
                    const params = new URLSearchParams(prev)
                    params.set('check', check.checkId)
                    return params
                  })
                }
              >
                <strong>{check.checkId}</strong>
                <span className={`badge badge-${check.stage === '已生效' ? 'active' : check.stage === '已归档' ? 'archived' : 'draft'}`}>
                  {check.stage}
                </span>
                <span className="check-chip-meta">
                  快照 {check.snapshot.snapshotId}（{check.snapshot.versionLabel}）· {check.ruleCode} ·{' '}
                  {check.rounds.length} 轮 / {check.rounds.reduce((sum, round) => sum + round.anomalies.length, 0)} 条异常
                </span>
              </button>
            ))}
          </div>
        )}

        {chosenCheck && (
          <QualityCheckDetail
            check={chosenCheck}
            fieldReview={buildFieldReview(chosenCheck.checkId)}
            fixList={buildFixList(chosenCheck.checkId)}
          />
        )}
      </section>
    </section>
  )
}
