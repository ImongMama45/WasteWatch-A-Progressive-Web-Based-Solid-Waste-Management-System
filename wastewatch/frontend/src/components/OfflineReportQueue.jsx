import { useAuth } from '../context/AuthContext'

/**
 * components/OfflineReportQueue.jsx
 * -----------------------------------
 * Displays the local IndexedDB report queue with:
 *  - Grouped sections: Pending · Synced · Failed
 *  - Animated pulse on pending items
 *  - Retry button on failed items
 *  - "Sync Now" button when online + pending > 0
 *
 * Props:
 *   reports      : array   — from useOfflineReports
 *   isSyncing    : boolean
 *   isOnline     : boolean
 *   lastSync     : Date | null
 *   pendingCount : number
 *   failedCount  : number
 *   onSyncNow    : () => void
 *   onRetry      : (id) => void
 *   onNewReport  : () => void  — opens OfflineReportBuilder
 */

const STATUS_META = {
  pending : { label: 'Pending',  emoji: '🟡', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)',  border: 'rgba(245,158,11,0.3)'  },
  synced  : { label: 'Synced',   emoji: '🟢', color: '#22c55e', bg: 'rgba(34,197,94,0.08)',  border: 'rgba(34,197,94,0.2)'   },
  failed  : { label: 'Failed',   emoji: '🔴', color: '#ef4444', bg: 'rgba(239,68,68,0.08)',  border: 'rgba(239,68,68,0.2)'   },
}

const WASTE_EMOJI = {
  overflow         : '🗑️',
  missed           : '🚛',
  illegal_dumping  : '⚠️',
  biodegradable    : '🌿',
  residual         : '🗑️',
  recyclable       : '♻️',
  special          : '⚠️',
}

const SEV_COLOR = {
  low      : '#22c55e',
  medium   : '#f59e0b',
  high     : '#ef4444',
  critical : '#7c3aed',
}

function formatDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// ─── Single report row ────────────────────────────────────────────────────────

function ReportRow({ report, isOnline, onRetry, onClick }) {
  const meta   = STATUS_META[report.status] || STATUS_META.pending
  const isPending = report.status === 'pending'
  const retryCount = typeof report.retryCount === 'number' && !isNaN(report.retryCount) ? report.retryCount : 0

  return (
    <div
      className="orq-row"
      style={{ borderLeftColor: meta.color, cursor: 'pointer' }}
      onClick={() => onClick?.(report)}
    >
      <div className="orq-row__left">
        <span className="orq-row__emoji">
          {WASTE_EMOJI[report.issue_type] || '🗑️'}
        </span>
        <div className="orq-row__info">
          <div className="orq-row__top">
            <span className="orq-row__type">
              {report.issue_type?.charAt(0).toUpperCase() + report.issue_type?.slice(1)}
            </span>
            <span
              className="orq-row__sev"
              style={{ color: SEV_COLOR[report.severity] || '#94a3b8' }}
            >
              {report.severity?.toUpperCase()}
            </span>
            {isPending && <span className="orq-row__pulse" />}
          </div>
          <span className="orq-row__addr">
            {report.address || 'No location'}
          </span>
          {report.description && (
            <span className="orq-row__notes">{report.description}</span>
          )}
          <span className="orq-row__date">{formatDate(report.createdAt)}</span>
        </div>
      </div>

      <div className="orq-row__right">
        <span
          className="orq-row__badge"
          style={{ color: meta.color, background: meta.bg, border: `1px solid ${meta.border}` }}
        >
          {meta.emoji} {meta.label}
        </span>

        {report.status === 'failed' && isOnline && (
          <button
            className="orq-retry-btn"
            onClick={(e) => { e.stopPropagation(); onRetry(report.id) }}
            aria-label="Retry sync"
          >
            🔄 Retry
          </button>
        )}

        {retryCount > 0 && report.status !== 'synced' && (
          <span className="orq-row__retries">
            {retryCount}/{3} attempts
          </span>
        )}
      </div>
    </div>
  )
}

// ─── Section group ────────────────────────────────────────────────────────────

function Section({ title, count, color, children, defaultOpen = true }) {
  const displayCount = typeof count === 'number' && !isNaN(count) ? count : 0
  if (displayCount === 0) return null
  return (
    <details className="orq-section" open={defaultOpen}>
      <summary className="orq-section__summary">
        <span className="orq-section__title" style={{ color }}>{title}</span>
        <span className="orq-section__count" style={{ background: `${color}20`, color }}>{displayCount}</span>
      </summary>
      <div className="orq-section__body">{children}</div>
    </details>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function OfflineReportQueue({
  reports,
  isSyncing,
  isOnline,
  lastSync,
  pendingCount,
  failedCount,
  onSyncNow,
  onRetry,
  onNewReport,
  onReportClick,
}) {
  const { user } = useAuth()
  const pending = reports.filter(r => r.status === 'pending')
  const failed  = reports.filter(r => r.status === 'failed')
  const synced  = reports.filter(r => r.status === 'synced')

  const dispPending = typeof pendingCount === 'number' && !isNaN(pendingCount) ? pendingCount : pending.length
  const dispFailed  = typeof failedCount === 'number' && !isNaN(failedCount) ? failedCount : failed.length

  return (
    <div className="orq-wrap">

      {/* ── Header ── */}
      <div className="orq-header">
        <div className="orq-header__left">
          <div className="orq-header__icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
            </svg>
          </div>
          <div>
            <h2 className="orq-header__title">{user ? 'My Reports' : 'Community Reports'}</h2>
            <p className="orq-header__sub">
              {lastSync instanceof Date && !isNaN(lastSync.getTime())
                ? `Synced ${lastSync.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}`
                : 'Not synced this session'}
            </p>
          </div>
        </div>

        {/* Status pill */}
        <div className={`orq-pill${isOnline ? ' orq-pill--online' : ''}`}>
          <span className="orq-pill__dot" />
          {isOnline ? (isSyncing ? 'Syncing…' : 'Online') : 'Offline'}
        </div>
      </div>

      {/* ── Summary chips ── */}
      {reports.length > 0 && (
        <div className="orq-chips">
          <span className="orq-chip orq-chip--pending">{dispPending} Pending</span>
          <span className="orq-chip orq-chip--synced">{synced.length} Synced</span>
          {dispFailed > 0 && (
            <span className="orq-chip orq-chip--failed">{dispFailed} Failed</span>
          )}
          {isOnline && dispPending > 0 && !isSyncing && (
            <button className="orq-chip orq-chip--sync-btn" onClick={onSyncNow}>
              ⚡ Sync Now
            </button>
          )}
          {isSyncing && (
            <span className="orq-chip orq-chip--syncing">
              <span className="orb-spinner orb-spinner--sm" /> Syncing…
            </span>
          )}
        </div>
      )}

      {/* ── Report list ── */}
      <div className="orq-list">
        {reports.length === 0 ? (
          <div className="orq-empty">
            <div className="orq-empty__icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
              </svg>
            </div>
            <p className="orq-empty__text">No reports yet.</p>
            <p className="orq-empty__sub">Submit your first garbage report below.</p>
          </div>
        ) : (
          <>
            <Section title="⏳ Pending Sync" count={pending.length} color="#f59e0b" defaultOpen>
              {pending.map(r => <ReportRow key={r.id} report={r} isOnline={isOnline} onRetry={onRetry} onClick={onReportClick} />)}
            </Section>

            <Section title="❌ Failed" count={failed.length} color="#ef4444" defaultOpen>
              {failed.map(r => <ReportRow key={r.id} report={r} isOnline={isOnline} onRetry={onRetry} onClick={onReportClick} />)}
            </Section>

            <Section title="✅ Synced" count={synced.length} color="#22c55e" defaultOpen={false}>
              {synced.map(r => <ReportRow key={r.id} report={r} isOnline={isOnline} onRetry={onRetry} onClick={onReportClick} />)}
            </Section>
          </>
        )}
      </div>

      {/* ── CTA ── */}
      <div className="orq-cta">
        <div className="orq-cta__text">
          <h3>Report a Garbage Problem?</h3>
          <p>Works offline — we sync it when you're back online.</p>
        </div>
        <button className="orq-cta__btn" onClick={onNewReport}>
          📤 New Report
        </button>
      </div>
    </div>
  )
}
