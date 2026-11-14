import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { downloadEntries, listEntries, moduleMeta, runAction as applyAction } from '@/api/local-service'
import {
  RETENTION_POLICY,
  applyQualityCheck,
  archiveQualityCheck,
  buildFieldReview,
  buildFixList,
  createQualityCheck,
  listEventOptions,
  listQualityChecks,
  listRuleOptions,
  runScheduledScan,
  simulateConcurrentApply,
} from '@/api/quality-service'
import type { ApplyAttempt, QualityCheck } from '@/data/quality-types'
import type { EntryRow } from '@/data/types'
import { formatTime } from '@/data/quality-utils'
import QualityCheckDetail from '@/views/quality/QualityCheckDetail'

const meta = moduleMeta('auditcheck')
const columns = [
  "规则编号",
  "审计对象",
  "校验字段",
  "异常条件",
  "告警级别",
  "审计频率",
  "修复建议",
  "规则状态"
]
const actions = [
  "提交规则评审",
  "生效规则",
  "关闭规则"
]
const statuses = [
  "草稿",
  "规则评审中",
  "已生效",
  "已关闭"
]
const stats = [
  {
    "label": "审计规则总数",
    "value": 0
  },
  {
    "label": "已生效规则",
    "value": 0
  },
  {
    "label": "规则评审中",
    "value": 0
  }
]

const STAGE_CLASS: Record<QualityCheck['stage'], string> = {
  草稿: 'badge badge-draft',
  已生效: 'badge badge-active',
  已归档: 'badge badge-archived',
}

type ApplyAttemptRow = ApplyAttempt

export default function AuditcheckView() {
  const [rows, setRows] = useState<EntryRow[]>([])
  const [total, setTotal] = useState(0)
  const [errorMessage, setErrorMessage] = useState('')
  const [filters, setFilters] = useState<Record<string, string>>({})
  const filterFields = useMemo(() => columns.slice(0, 3), [])

  const [searchParams, setSearchParams] = useSearchParams()
  const [checks, setChecks] = useState<QualityCheck[]>([])
  const [eventOptions, setEventOptions] = useState<ReturnType<typeof listEventOptions>>([])
  const [ruleOptions, setRuleOptions] = useState<ReturnType<typeof listRuleOptions>>([])
  const [eventCode, setEventCode] = useState('EVEN-0002')
  const [ruleCode, setRuleCode] = useState('AUDI-0002')
  const [notice, setNotice] = useState('')
  const [qualityError, setQualityError] = useState('')
  const [attempts, setAttempts] = useState<ApplyAttemptRow[]>([])
  const [busy, setBusy] = useState(false)

  const selectedCheckId = searchParams.get('check') ?? ''
  const selectedCheck = checks.find((item) => item.checkId === selectedCheckId) ?? checks[0]

  const reload = useCallback(() => {
    setErrorMessage('')
    try {
      const payload = listEntries(meta.key, filters)
      setRows(payload.items)
      setTotal(payload.total)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '数据审计列表读取失败')
    }
  }, [filters])

  const reloadQuality = useCallback(() => {
    setChecks(listQualityChecks())
    setEventOptions(listEventOptions())
    setRuleOptions(listRuleOptions())
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  useEffect(() => {
    reloadQuality()
  }, [reloadQuality])

  function runAction(action: string, row: EntryRow) {
    setErrorMessage('')
    const result = applyAction(meta.key, Number(row.id), action)
    if (!result.ok) {
      setErrorMessage(result.message)
      return
    }
    reload()
    setRuleOptions(listRuleOptions())
  }

  function handleCreate() {
    setQualityError('')
    setAttempts([])
    const result = createQualityCheck({ eventCode, ruleCode, actor: '值班管理员' })
    if (!result.ok) {
      setQualityError(result.message)
      return
    }
    setNotice(result.message)
    reloadQuality()
    if (result.checkId) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        next.set('check', result.checkId as string)
        return next
      })
    }
  }

  function handleApply(check: QualityCheck) {
    setQualityError('')
    setNotice('')
    setBusy(true)
    const result = applyQualityCheck(check.checkId, { actor: '值班管理员' })
    setBusy(false)
    if (!result.ok) {
      setQualityError(result.message)
      return
    }
    setNotice(result.message)
    reloadQuality()
  }

  function handleScan(check: QualityCheck) {
    setQualityError('')
    setNotice('')
    const result = runScheduledScan(check.checkId, '值班管理员')
    if (!result.ok) {
      setQualityError(result.message)
      return
    }
    setNotice(result.message)
    reloadQuality()
  }

  function handleArchive(check: QualityCheck) {
    setQualityError('')
    setNotice('')
    const result = archiveQualityCheck(check.checkId, '值班管理员')
    if (!result.ok) {
      setQualityError(result.message)
      return
    }
    setNotice(result.message)
    reloadQuality()
  }

  function handleConcurrent() {
    setQualityError('')
    setNotice('')
    const result = simulateConcurrentApply({
      eventCode,
      ruleCode,
      actors: ['审计员-甲', '审计员-乙'],
    })
    setAttempts(result.attempts)
    if (!result.ok) {
      setQualityError(result.message)
    } else {
      setNotice(result.message)
    }
    reloadQuality()
  }

  return (
    <section className="page" data-module="auditcheck">
      <header className="page-head">
        <div>
          <h2>数据审计管理</h2>
          <p className="page-desc">
            定义数据产品的数据质量审计规则，对埋点丢失、口径漂移和异常波动进行监测。规则生效时冻结事件参数快照，
            事件改版只追加新的审计异常，不改写旧事件质量结论。
          </p>
        </div>
        <div className="page-actions">
          <button className="btn primary" type="button" onClick={() => setErrorMessage('审计规则登记入口尚未接入审批流')}>
            登记审计规则
          </button>
          <button className="btn" type="button" onClick={() => downloadEntries(meta.key)}>
            导出数据审计清单
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
          <span className="stat-label">质量检查记录</span>
          <strong className="stat-value">{checks.length}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">已冻结快照</span>
          <strong className="stat-value">{checks.filter((item) => item.frozen).length}</strong>
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
              <td className="empty-state" colSpan={columns.length + 2}>暂无数据审计数据，可先登记审计规则</td>
            </tr>
          )}
        </tbody>
      </table>

      <footer className="page-foot">
        <span>共 {total} 条数据审计记录</span>
        {errorMessage && <span className="error-text">{errorMessage}</span>}
      </footer>

      <section className="panel" data-testid="quality-panel">
        <header className="panel-head">
          <div>
            <h3>事件参数快照与审计规则绑定</h3>
            <p className="page-desc">
              选择埋点事件和审计对象后生成质量检查记录：参数结构、采样比例和异常条件一起入快照；规则生效即冻结。
              快照保留 {RETENTION_POLICY.months} 个月，冻结期间不可改写。
            </p>
          </div>
        </header>

        <form
          className="filter-bar"
          onSubmit={(event) => {
            event.preventDefault()
            handleCreate()
          }}
        >
          <label className="filter-item">
            <span>埋点事件</span>
            <select value={eventCode} onChange={(event) => setEventCode(event.target.value)}>
              {eventOptions.map((option) => (
                <option key={option.eventCode} value={option.eventCode}>
                  {option.eventCode} {option.eventName}（{option.versionLabel}，{option.status}）
                </option>
              ))}
            </select>
          </label>
          <label className="filter-item">
            <span>审计对象</span>
            <select value={ruleCode} onChange={(event) => setRuleCode(event.target.value)}>
              {ruleOptions.map((option) => (
                <option key={option.ruleCode} value={option.ruleCode}>
                  {option.ruleCode} {option.ruleName}（{option.status}）
                </option>
              ))}
            </select>
          </label>
          <button className="btn primary" type="submit">生成质量检查记录</button>
          <button className="btn" type="button" onClick={handleConcurrent}>
            模拟两名审计员同时生效
          </button>
        </form>

        {notice && <p className="success-text">{notice}</p>}
        {qualityError && <p className="error-text">{qualityError}</p>}

        {attempts.length > 0 && (
          <table className="data-table compact" data-testid="apply-attempts">
            <thead><tr><th>审计员</th><th>结果</th><th>草稿异常</th><th>落库异常</th><th>说明</th></tr></thead>
            <tbody>
              {attempts.map((attempt, index) => (
                <tr key={`${attempt.actor}-${index}`}>
                  <td>{attempt.actor}</td>
                  <td>{attempt.ok ? '提交成功' : '提交失败'}</td>
                  <td>{attempt.draftedAnomalies}</td>
                  <td>{attempt.persistedAnomalies}</td>
                  <td>{attempt.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="check-list">
          {checks.length === 0 && (
            <p className="hint-text">还没有质量检查记录。选择 EVEN-0002 与 AUDI-0002 后点「生成质量检查记录」。</p>
          )}
          {checks.map((check) => (
            <button
              key={check.checkId}
              type="button"
              className={`check-chip${selectedCheck?.checkId === check.checkId ? ' selected' : ''}`}
              onClick={() =>
                setSearchParams((prev) => {
                  const next = new URLSearchParams(prev)
                  next.set('check', check.checkId)
                  return next
                })
              }
            >
              <strong>{check.checkId}</strong>
              <span className={STAGE_CLASS[check.stage]}>{check.stage}</span>
              <span className="check-chip-meta">
                {check.eventCode} × {check.ruleCode} · 快照 {check.snapshot.snapshotId}
              </span>
              <span className="check-chip-meta">
                {check.rounds.length} 轮 / {check.rounds.reduce((sum, round) => sum + round.anomalies.length, 0)} 条异常 ·{' '}
                {formatTime(check.createdAt)}
              </span>
            </button>
          ))}
        </div>

        {selectedCheck && (
          <>
            <p className="detail-note">
              审计记录引用质量检查 <code>{selectedCheck.checkId}</code>；事件详情页的关联质量检查指向同一条记录。
            </p>
            <QualityCheckDetail
              check={selectedCheck}
              fieldReview={buildFieldReview(selectedCheck.checkId)}
              fixList={buildFixList(selectedCheck.checkId)}
              busy={busy}
              onApply={() => handleApply(selectedCheck)}
              onScan={() => handleScan(selectedCheck)}
              onArchive={() => handleArchive(selectedCheck)}
            />
          </>
        )}
      </section>
    </section>
  )
}
