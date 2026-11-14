import { Link } from 'react-router-dom'

import { checkSummary, validateSnapshotIntegrity } from '@/api/quality-service'
import type { FieldReviewRow, FixItem, QualityCheck, StageLog } from '@/data/quality-types'
import { formatTime } from '@/data/quality-utils'

type Props = {
  check: QualityCheck
  fieldReview: FieldReviewRow[]
  fixList: FixItem[]
  onApply?: () => void
  onArchive?: () => void
  onScan?: () => void
  busy?: boolean
}

const STAGE_CLASS: Record<QualityCheck['stage'], string> = {
  草稿: 'badge badge-draft',
  已生效: 'badge badge-active',
  已归档: 'badge badge-archived',
}

function StageTimeline({ logs }: { logs: StageLog[] }) {
  return (
    <ol className="stage-timeline">
      {logs.map((log, index) => (
        <li key={`${log.stage}-${index}`} className="stage-step">
          <span className={STAGE_CLASS[log.stage]}>{log.stage}</span>
          <span className="stage-meta">
            {formatTime(log.at)} · {log.actor}
          </span>
          <span className="stage-note">{log.note}</span>
        </li>
      ))}
    </ol>
  )
}

export default function QualityCheckDetail({ check, fieldReview, fixList, onApply, onArchive, onScan, busy }: Props) {
  const { snapshot } = check
  const summary = checkSummary(check)
  const integrity = validateSnapshotIntegrity(check)

  return (
    <article className="detail-card" data-testid="quality-check-detail" data-check-id={check.checkId}>
      <header className="detail-head">
        <div>
          <h3>
            质量检查 {check.checkId}
            <span className={STAGE_CLASS[check.stage]}>{check.stage}</span>
            {check.frozen && <span className="badge badge-frozen">快照已冻结</span>}
          </h3>
          <p className="detail-sub">
            {check.eventCode} {check.eventName} × {check.ruleCode} {check.ruleName} · 快照{' '}
            <strong>{snapshot.snapshotId}</strong>（{snapshot.versionLabel}）· 生成人 {check.createdBy} ·{' '}
            {formatTime(check.createdAt)}
          </p>
        </div>
        <div className="detail-actions">
          {check.stage === '草稿' && onApply && (
            <button className="btn primary" type="button" onClick={onApply} disabled={busy}>
              生效规则并冻结快照
            </button>
          )}
          {check.stage === '已生效' && onScan && (
            <button className="btn" type="button" onClick={onScan} disabled={busy}>
              按快照执行下一轮扫描
            </button>
          )}
          {check.stage !== '已归档' && onArchive && (
            <button className="btn ghost" type="button" onClick={onArchive} disabled={busy}>
              归档质量检查
            </button>
          )}
          {check.stage === '已归档' && <span className="hint-text">已归档：阶段不可恢复，也不能再追加扫描</span>}
        </div>
      </header>

      {integrity && <p className="error-text">{integrity}</p>}

      <div className="meta-grid">
        <div><span className="meta-label">事件</span>{check.eventCode} {check.eventName}</div>
        <div><span className="meta-label">审计对象</span>{check.ruleCode} {check.ruleName}</div>
        <div><span className="meta-label">快照版本</span>{snapshot.snapshotId} / {snapshot.versionLabel}</div>
        <div><span className="meta-label">参数版本号</span>v{snapshot.parameterVersion}</div>
        <div><span className="meta-label">生效时间</span>{formatTime(check.effectiveAt)}</div>
        <div><span className="meta-label">归档时间</span>{formatTime(check.archivedAt)}</div>
        <div><span className="meta-label">扫描轮次</span>{summary.rounds} 轮</div>
        <div><span className="meta-label">累计异常</span>{summary.anomalies} 条（P1 {summary.p1} 条）</div>
        <div><span className="meta-label">快照保留期</span>{snapshot.retentionMonths} 个月，保留至 {formatTime(snapshot.retentionUntil)}</div>
        <div><span className="meta-label">快照指纹</span><code>{snapshot.fingerprint || '生效时写入'}</code></div>
      </div>

      <section className="detail-section">
        <h4>阶段流转</h4>
        <StageTimeline logs={check.stageLogs} />
      </section>

      <section className="detail-section">
        <h4>参数结构快照（{snapshot.snapshotId}）</h4>
        <table className="data-table compact">
          <thead>
            <tr>
              <th>参数名</th><th>字段</th><th>类型</th><th>必填</th><th>取值口径</th><th>快照值</th><th>字段注释</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.parameterDict.map((field) => (
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
                <td>{field.snapshotValue}</td>
                <td>{field.annotation}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="detail-note">
          逐字段复核定位：{snapshot.parameterDict.map((field) => `${check.eventCode}.params.${field.name}`).join('、')}
        </p>
      </section>

      <section className="detail-section">
        <h4>触发条件原文与采样口径</h4>
        <blockquote className="quote-block">{snapshot.triggerConditionText}</blockquote>
        <div className="meta-grid">
          <div><span className="meta-label">采样比例</span><strong>{snapshot.samplingRatio}</strong></div>
          <div><span className="meta-label">采样来源页</span>{snapshot.samplingSourcePage}</div>
          <div><span className="meta-label">采样变更人</span>{snapshot.samplingChangedBy}</div>
          <div><span className="meta-label">采样变更时间</span>{formatTime(snapshot.samplingChangedAt)}</div>
        </div>
        <table className="data-table compact">
          <thead><tr><th>采样比例轨迹</th><th>变更时间</th><th>变更人</th><th>来源页</th><th>说明</th></tr></thead>
          <tbody>
            {snapshot.samplingHistory.map((item, index) => (
              <tr key={`${item.ratio}-${index}`}>
                <td>{item.ratio}</td>
                <td>{formatTime(item.changedAt)}</td>
                <td>{item.changedBy}</td>
                <td>{item.sourcePage}</td>
                <td>{item.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="detail-section">
        <h4>审计规则绑定</h4>
        <div className="binding-grid">
          <div>
            <span className="meta-label">快照锚点</span>
            <code>{snapshot.ruleBinding.versionPointer}</code>
          </div>
          <div>
            <span className="meta-label">校验字段版本</span>
            <code>{snapshot.ruleBinding.validationFieldsVersion}</code>
          </div>
          <div>
            <span className="meta-label">审计频率版本</span>
            <code>{snapshot.ruleBinding.auditFrequencyVersion}</code>
          </div>
        </div>
        <p className="detail-note">三条绑定必须指向同一版本，否则质量检查不允许生效。</p>
        <div className="meta-grid">
          <div><span className="meta-label">校验字段</span>{snapshot.validationFields.join('、')}</div>
          <div><span className="meta-label">审计频率</span>{snapshot.auditFrequency}</div>
        </div>
        {snapshot.bindingWarnings.length > 0 && (
          <>
            <p className="detail-note">生成时口径提示（随快照留痕）</p>
            <ul className="note-list">
              {snapshot.bindingWarnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          </>
        )}
        <p className="detail-note">异常条件原文</p>
        <blockquote className="quote-block">{snapshot.anomalyConditions}</blockquote>
        <p className="detail-note">
          引用锚点：审计记录与事件详情共用质量检查 <code>{check.checkId}</code>（快照 <code>{snapshot.snapshotId}</code>）。
          <Link className="inline-link" to={`/eventdef?event=${check.eventCode}&check=${check.checkId}`}>
            在事件详情中查看同一次检查
          </Link>
        </p>
      </section>

      <section className="detail-section">
        <h4>扫描轮次与审计异常</h4>
        {check.rounds.length === 0 && <p className="hint-text">规则尚未生效，暂无扫描轮次。</p>}
        {check.rounds.map((round) => (
          <div key={round.roundId} className="round-block">
            <header className="round-head">
              <strong>第 {round.roundNo} 轮 · {round.kind}</strong>
              <span className="stage-meta">
                {formatTime(round.ranAt)} · {round.actor} · 快照 {round.snapshotId} ({round.snapshotVersionLabel}) · 扫描时事件版本{' '}
                {round.eventVersionLabel} · 消息批次 {round.messageBatchId} · 异常 {round.anomalies.length} 条
              </span>
              <span className="stage-note">{round.note}</span>
            </header>
            {round.anomalies.length > 0 ? (
              <table className="data-table compact">
                <thead><tr><th>定位</th><th>字段</th><th>类型</th><th>级别</th><th>快照值</th><th>实际值</th><th>说明</th></tr></thead>
                <tbody>
                  {round.anomalies.map((anomaly) => (
                    <tr key={anomaly.id}>
                      <td><code>{anomaly.locator}</code></td>
                      <td>{anomaly.fieldLabel}</td>
                      <td>{anomaly.kind}</td>
                      <td><span className={`badge badge-${anomaly.level.toLowerCase()}`}>{anomaly.level}</span></td>
                      <td>{anomaly.snapshotValue}</td>
                      <td>{anomaly.observedValue}</td>
                      <td>{anomaly.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="hint-text">本轮未发现异常。</p>
            )}
          </div>
        ))}
      </section>

      <section className="detail-section">
        <h4>修复清单</h4>
        {fixList.length === 0 ? (
          <p className="hint-text">暂无需修复的字段。</p>
        ) : (
          <table className="data-table compact">
            <thead><tr><th>定位</th><th>字段</th><th>类型</th><th>级别</th><th>修复建议</th></tr></thead>
            <tbody>
              {fixList.map((item) => (
                <tr key={item.locator}>
                  <td><code>{item.locator}</code></td>
                  <td>{item.field}</td>
                  <td>{item.kind}</td>
                  <td>{item.level}</td>
                  <td>{item.suggestion}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="detail-section">
        <h4>按快照逐字段复核</h4>
        {fieldReview.length === 0 ? (
          <p className="hint-text">尚无扫描批次，无法复核。</p>
        ) : (
          <table className="data-table compact">
            <thead><tr><th>定位</th><th>字段</th><th>必填</th><th>快照值</th><th>扫描观测</th><th>字段注释</th><th>结论</th></tr></thead>
            <tbody>
              {fieldReview.map((row) => (
                <tr key={row.locator}>
                  <td><code>{row.locator}</code></td>
                  <td>{row.label}</td>
                  <td>{row.required ? '是' : '否'}</td>
                  <td>{row.snapshotValue}</td>
                  <td>{row.observedValues}</td>
                  <td>{row.annotation}</td>
                  <td><span className={`badge badge-review-${row.status === '一致' ? 'ok' : row.status === '缺失' ? 'p1' : row.status === '漂移' ? 'p2' : 'draft'}`}>{row.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </article>
  )
}
