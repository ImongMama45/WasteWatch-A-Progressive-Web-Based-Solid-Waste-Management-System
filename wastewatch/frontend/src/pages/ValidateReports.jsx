/**
 * ValidateReports.jsx — Barangay Report Validation Page
 * -------------------------------------------------------
 * Route: /brgy/reports
 *
 * Features:
 *  - Shows ALL reports from the official's barangay only
 *  - Pending reports: can be Approved (goes to map) or Rejected (goes to history)
 *  - Approved reports: visible on the public map
 *  - History tab: all rejected reports with reason, never permanently deleted
 *  - Filter by status + search by address/type
 *  - Detail drawer for full report view before deciding
 */

import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import DashboardLayout from '../components/DashboardLayout'
import { useAuth } from '../context/AuthContext'

// ─── MOCK DATA ────────────────────────────────────────────────────────────────
// In production: GET /api/brgy/reports/?barangay={user.barangay_id}

const ALL_REPORTS = [
  {
    id: 'R001', type: 'overflow', status: 'pending',
    address: 'Corner Main St & 5th Ave', barangay: 'Ibabang Dupay Zone 1',
    reporter: 'Juan Dela Cruz', reporterRole: 'Watcher',
    date: '2026-04-19', time: '8:32 AM',
    description: 'Large pile of garbage overflowing near the corner sari-sari store. Blocking the sidewalk.',
    photo: true, tags: ['Near Market', 'Side Road'],
    severity: 'high',
  },
  {
    id: 'R002', type: 'illegal_dumping', status: 'pending',
    address: 'Barangay Hall Side Gate', barangay: 'Ibabang Dupay Zone 1',
    reporter: 'Maria Santos', reporterRole: 'Citizen',
    date: '2026-04-19', time: '6:14 AM',
    description: 'Someone dumped construction waste overnight near the side gate. Includes broken concrete and wood.',
    photo: true, tags: ['Residential'],
    severity: 'medium',
  },
  {
    id: 'R003', type: 'missed', status: 'pending',
    address: 'Zone 3 — Purok 2', barangay: 'Ibabang Dupay Zone 1',
    reporter: 'Pedro Reyes', reporterRole: 'Watcher',
    date: '2026-04-18', time: '11:05 AM',
    description: 'Garbage truck did not come on Monday despite being scheduled. Third time this month.',
    photo: false, tags: ['Residential'],
    severity: 'high',
  },
  {
    id: 'R004', type: 'overflow', status: 'approved',
    address: 'Purok 4 — Near Elementary School', barangay: 'Ibabang Dupay Zone 1',
    reporter: 'Ana Lim', reporterRole: 'Citizen',
    date: '2026-04-17', time: '7:45 AM',
    description: 'Garbage bin near the school is overflowing. Visible on the sidewalk.',
    photo: true, tags: ['Near School'],
    severity: 'medium',
    validatedBy: 'Brgy. Official Santos', validatedAt: '2026-04-17 10:00 AM',
    visibleOnMap: true,
  },
  {
    id: 'R005', type: 'illegal_dumping', status: 'rejected',
    address: 'Zone 1 — Near River Bank', barangay: 'Ibabang Dupay Zone 1',
    reporter: 'Carlo Mendez', reporterRole: 'Citizen',
    date: '2026-04-16', time: '3:20 PM',
    description: 'Reported dumping near river. Could not be verified on site.',
    photo: false, tags: ['Near River'],
    severity: 'low',
    rejectedBy: 'Brgy. Official Santos', rejectedAt: '2026-04-16 5:00 PM',
    rejectionReason: 'Could not be verified on-site. No photo evidence provided.',
  },
  {
    id: 'R006', type: 'missed', status: 'rejected',
    address: 'Zone 2 — Highway Ext.', barangay: 'Ibabang Dupay Zone 1',
    reporter: 'Ben Cruz', reporterRole: 'Citizen',
    date: '2026-04-15', time: '9:00 AM',
    description: 'Claimed truck did not arrive but driver log shows the route was completed.',
    photo: false, tags: ['Highway'],
    severity: 'low',
    rejectedBy: 'Brgy. Official Santos', rejectedAt: '2026-04-15 2:00 PM',
    rejectionReason: 'Driver logs confirmed route was completed on schedule.',
  },
]

const TYPE_META = {
  overflow: { label: 'Overflow', icon: '🗑️', color: '#ef4444', bg: 'rgba(239,68,68,0.1)' },
  illegal_dumping: { label: 'Illegal Dumping', icon: '🚯', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
  missed: { label: 'Missed Pickup', icon: '📭', color: '#5dade2', bg: 'rgba(93,173,226,0.1)' },
}
const STATUS_META = {
  pending: { label: 'Pending', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
  approved: { label: 'Approved', color: '#22c55e', bg: 'rgba(34,197,94,0.1)' },
  rejected: { label: 'Rejected', color: '#ef4444', bg: 'rgba(239,68,68,0.1)' },
}
const SEVERITY_COLORS = { high: '#ef4444', medium: '#f59e0b', low: '#22c55e' }

const TABS = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'history', label: 'History' },
]

// ─── COMPONENT ────────────────────────────────────────────────────────────────

export default function ValidateReports() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [reports, setReports] = useState(ALL_REPORTS)
  const [activeTab, setActiveTab] = useState('pending')
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [drawerReport, setDrawerReport] = useState(null)   // full-detail drawer
  const [rejectModal, setRejectModal] = useState(null)   // { id } for reject reason input
  const [rejectReason, setRejectReason] = useState('')
  const [toast, setToast] = useState(null)

  function showToast(msg, type = 'success') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3200)
  }

  // ── Actions ──
  function handleApprove(id) {
    setReports(prev => prev.map(r => r.id !== id ? r : {
      ...r,
      status: 'approved',
      visibleOnMap: true,
      validatedBy: user?.full_name || 'Brgy. Official',
      validatedAt: new Date().toLocaleString(),
    }))
    setDrawerReport(null)
    showToast('✅ Report approved — now visible on the live map.')
  }

  function openRejectModal(id) {
    setRejectModal(id)
    setRejectReason('')
    setDrawerReport(null)
  }

  function confirmReject() {
    if (!rejectReason.trim()) return
    setReports(prev => prev.map(r => r.id !== rejectModal ? r : {
      ...r,
      status: 'rejected',
      visibleOnMap: false,
      rejectedBy: user?.full_name || 'Brgy. Official',
      rejectedAt: new Date().toLocaleString(),
      rejectionReason: rejectReason.trim(),
    }))
    setRejectModal(null)
    setRejectReason('')
    showToast('Report rejected and moved to History.')
  }

  // ── Filtered lists ──
  const filtered = useMemo(() => {
    const statusKey = activeTab === 'history' ? 'rejected' : activeTab
    return reports.filter(r => {
      if (r.status !== statusKey) return false
      if (typeFilter !== 'all' && r.type !== typeFilter) return false
      if (search) {
        const q = search.toLowerCase()
        return r.address.toLowerCase().includes(q) ||
          r.type.toLowerCase().includes(q) ||
          r.reporter.toLowerCase().includes(q) ||
          r.description.toLowerCase().includes(q)
      }
      return true
    })
  }, [reports, activeTab, typeFilter, search])

  const counts = {
    pending: reports.filter(r => r.status === 'pending').length,
    approved: reports.filter(r => r.status === 'approved').length,
    history: reports.filter(r => r.status === 'rejected').length,
  }

  return (
    <DashboardLayout>

      <style>{`
        @keyframes fadeUp   { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        @keyframes fadeIn   { from{opacity:0} to{opacity:1} }
        @keyframes slideRight { from{transform:translateX(100%)} to{transform:translateX(0)} }
        .vr-card { transition: box-shadow .18s, border-color .18s; cursor:pointer; }
        .vr-card:hover { box-shadow:0 4px 20px rgba(0,0,0,.08); border-color:var(--accent) !important; }
        .vr-btn { transition:opacity .15s,transform .1s; cursor:pointer; }
        .vr-btn:hover { opacity:.88; }
        .vr-btn:active { transform:scale(.97); }
        .vr-pill { transition:all .15s; cursor:pointer; }
        .vr-pill:hover { opacity:.85; }
      `}</style>

      {/* ── Toast ── */}
      {toast && (
        <div style={{
          position: 'fixed', top: 70, left: '50%', transform: 'translateX(-50%)',
          background: toast.type === 'success' ? '#0f172a' : '#1a0a0a',
          color: '#fff', padding: '10px 22px', borderRadius: 12, zIndex: 9999,
          fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
          border: `1px solid ${toast.type === 'success' ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)'}`,
          boxShadow: '0 8px 32px rgba(0,0,0,.35)', animation: 'fadeUp .2s',
        }}>
          {toast.msg}
        </div>
      )}

      {/* ── REJECT REASON MODAL ── */}
      {rejectModal && (
        <>
          <div onClick={() => setRejectModal(null)} style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)',
            backdropFilter: 'blur(3px)', zIndex: 800, animation: 'fadeIn .2s',
          }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%',
            transform: 'translate(-50%,-50%)',
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 16, padding: 24, zIndex: 900,
            width: 'min(440px,calc(100vw - 32px))',
            boxShadow: '0 24px 80px rgba(0,0,0,.35)',
            animation: 'fadeUp .2s',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <div style={{
                width: 40, height: 40, borderRadius: 10,
                background: 'rgba(239,68,68,0.1)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
              }}>✕</div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>Reject Report</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Provide a reason — this will be recorded in History.
                </div>
              </div>
            </div>

            <textarea
              className="form-input"
              rows={4}
              placeholder="e.g. Could not verify on-site. No photo evidence provided."
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              style={{ marginBottom: 14 }}
              autoFocus
            />

            <div style={{ display: 'flex', gap: 10 }}>
              <button className="vr-btn btn btn-outline" style={{ flex: 1 }}
                onClick={() => setRejectModal(null)}>
                Cancel
              </button>
              <button
                className="vr-btn btn btn-danger"
                style={{ flex: 2, fontWeight: 700 }}
                disabled={!rejectReason.trim()}
                onClick={confirmReject}>
                Confirm Rejection
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── REPORT DETAIL DRAWER ── */}
      {drawerReport && (
        <>
          <div onClick={() => setDrawerReport(null)} style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
            backdropFilter: 'blur(2px)', zIndex: 700, animation: 'fadeIn .2s',
          }} />
          <div style={{
            position: 'fixed', top: 0, right: 0, bottom: 0,
            width: 'min(480px,100vw)',
            background: 'var(--surface)',
            borderLeft: '1px solid var(--border)',
            zIndex: 750, overflowY: 'auto',
            animation: 'slideRight .25s cubic-bezier(.4,0,.2,1)',
            display: 'flex', flexDirection: 'column',
          }}>
            {/* Drawer header */}
            <div style={{
              padding: '16px 20px', borderBottom: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', gap: 12, position: 'sticky', top: 0,
              background: 'var(--surface)', zIndex: 1,
            }}>
              <button className="vr-btn"
                onClick={() => setDrawerReport(null)}
                style={{
                  background: 'none', border: 'none', fontSize: 20,
                  color: 'var(--text-muted)', padding: 4
                }}>
                ✕
              </button>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>
                  {TYPE_META[drawerReport.type]?.label}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Report #{drawerReport.id}
                </div>
              </div>
              <StatusBadge status={drawerReport.status} />
            </div>

            {/* Drawer content */}
            <div style={{ padding: '20px', flex: 1 }}>

              {/* Type + severity row */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  background: TYPE_META[drawerReport.type]?.bg,
                  border: `1px solid ${TYPE_META[drawerReport.type]?.color}44`,
                  borderRadius: 10, padding: '8px 12px', flex: 1,
                }}>
                  <span style={{ fontSize: 20 }}>{TYPE_META[drawerReport.type]?.icon}</span>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '.06em' }}>TYPE</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: TYPE_META[drawerReport.type]?.color }}>
                      {TYPE_META[drawerReport.type]?.label}
                    </div>
                  </div>
                </div>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  background: `${SEVERITY_COLORS[drawerReport.severity]}11`,
                  border: `1px solid ${SEVERITY_COLORS[drawerReport.severity]}44`,
                  borderRadius: 10, padding: '8px 12px', flex: 1,
                }}>
                  <span style={{ fontSize: 20 }}>
                    {drawerReport.severity === 'high' ? '🔴' : drawerReport.severity === 'medium' ? '🟡' : '🟢'}
                  </span>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '.06em' }}>SEVERITY</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: SEVERITY_COLORS[drawerReport.severity] }}>
                      {drawerReport.severity.charAt(0).toUpperCase() + drawerReport.severity.slice(1)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Detail rows */}
              {[
                { label: 'Address', value: drawerReport.address },
                { label: 'Reporter', value: `${drawerReport.reporter} (${drawerReport.reporterRole})` },
                { label: 'Reported', value: `${drawerReport.date} at ${drawerReport.time}` },
                { label: 'Barangay', value: drawerReport.barangay },
              ].map(row => (
                <div key={row.label} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                  padding: '10px 0', borderBottom: '1px solid var(--border)', gap: 16,
                }}>
                  <span style={{
                    fontSize: 11, fontWeight: 700, color: 'var(--text-muted)',
                    letterSpacing: '.06em', flexShrink: 0
                  }}>
                    {row.label.toUpperCase()}
                  </span>
                  <span style={{ fontSize: 13, textAlign: 'right' }}>{row.value}</span>
                </div>
              ))}

              {/* Description */}
              <div style={{ marginTop: 16, marginBottom: 16 }}>
                <div style={{
                  fontSize: 11, fontWeight: 700, color: 'var(--text-muted)',
                  letterSpacing: '.06em', marginBottom: 8
                }}>DESCRIPTION</div>
                <p style={{
                  fontSize: 13, lineHeight: 1.7, color: 'var(--text)',
                  background: 'var(--surface-2)', borderRadius: 8,
                  padding: '10px 12px', margin: 0,
                }}>
                  {drawerReport.description}
                </p>
              </div>

              {/* Photo */}
              {drawerReport.photo ? (
                <div style={{
                  background: 'var(--surface-2)', border: '1px solid var(--border)',
                  borderRadius: 10, height: 160,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  marginBottom: 16, gap: 8, flexDirection: 'column',
                }}>
                  <span style={{ fontSize: 28 }}>📷</span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Photo evidence attached
                  </span>
                  {/* TODO: <img src={drawerReport.photoUrl} /> */}
                </div>
              ) : (
                <div style={{
                  background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.2)',
                  borderRadius: 10, padding: '12px 16px', marginBottom: 16,
                  fontSize: 12, color: 'var(--danger)',
                }}>
                  ⚠️ No photo evidence provided
                </div>
              )}

              {/* Tags */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20 }}>
                {drawerReport.tags.map(tag => (
                  <span key={tag} style={{
                    background: 'var(--bg)', border: '1px solid var(--border)',
                    borderRadius: 20, fontSize: 11, padding: '3px 10px', color: 'var(--text-muted)',
                  }}>{tag}</span>
                ))}
              </div>

              {/* Validation/Rejection record */}
              {drawerReport.status === 'approved' && (
                <div style={{
                  background: 'rgba(34,197,94,0.05)', border: '1px solid rgba(34,197,94,0.2)',
                  borderRadius: 10, padding: '12px 14px', marginBottom: 16,
                }}>
                  <div style={{
                    fontSize: 11, fontWeight: 700, color: 'var(--accent)',
                    letterSpacing: '.06em', marginBottom: 4
                  }}>APPROVED</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    By {drawerReport.validatedBy} · {drawerReport.validatedAt}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--accent)', marginTop: 4, fontWeight: 600 }}>
                    🗺 Visible on live map
                  </div>
                </div>
              )}

              {drawerReport.status === 'rejected' && (
                <div style={{
                  background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.2)',
                  borderRadius: 10, padding: '12px 14px', marginBottom: 16,
                }}>
                  <div style={{
                    fontSize: 11, fontWeight: 700, color: 'var(--danger)',
                    letterSpacing: '.06em', marginBottom: 4
                  }}>REJECTED</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
                    By {drawerReport.rejectedBy} · {drawerReport.rejectedAt}
                  </div>
                  <div style={{
                    fontSize: 13, color: 'var(--text)', lineHeight: 1.6,
                    fontStyle: 'italic'
                  }}>
                    "{drawerReport.rejectionReason}"
                  </div>
                </div>
              )}

              {/* Guidance for pending */}
              {drawerReport.status === 'pending' && (
                <div style={{
                  background: 'rgba(20,184,166,0.05)', border: '1px solid rgba(20,184,166,0.18)',
                  borderRadius: 8, padding: '10px 12px', marginBottom: 20,
                  fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.65,
                }}>
                  <strong style={{ color: 'var(--text)' }}>💡 Your call:</strong> Approving makes this report visible to everyone on the live map and adds it to the collection queue. Rejecting records it in History.
                </div>
              )}
            </div>

            {/* Drawer footer actions */}
            {drawerReport.status === 'pending' && (
              <div style={{
                padding: '16px 20px', borderTop: '1px solid var(--border)',
                display: 'flex', gap: 10, position: 'sticky', bottom: 0,
                background: 'var(--surface)',
              }}>
                <button className="vr-btn"
                  onClick={() => openRejectModal(drawerReport.id)}
                  style={{
                    flex: 1, background: 'transparent',
                    border: '1.5px solid var(--danger)', color: 'var(--danger)',
                    borderRadius: 10, padding: '11px', fontWeight: 700, fontSize: 13,
                  }}>
                  ✕ Reject
                </button>
                <button className="vr-btn"
                  onClick={() => handleApprove(drawerReport.id)}
                  style={{
                    flex: 2, background: 'var(--accent)', color: '#0d1117',
                    border: 'none', borderRadius: 10, padding: '11px',
                    fontWeight: 700, fontSize: 13,
                  }}>
                  ✅ Approve & Publish
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* ════════════════════════════════════════════════════
          MAIN PAGE
      ════════════════════════════════════════════════════ */}
      <div className="page" style={{ maxWidth: 1200 }}>



        <div style={{
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          flexWrap: 'wrap', gap: 10, marginBottom: 20
        }}>
          <div>
            <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 800, margin: '0 0 3px' }}>
              Validate Reports
            </h2>
            <p className="text-muted text-sm">
              {user?.barangay_name || 'Your Barangay'} · Only you and Admins can approve reports before they appear on the map
            </p>
          </div>

          {/* Barangay chip */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 10, padding: '8px 14px',
          }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '.06em' }}>
                YOUR BARANGAY
              </div>
              <div style={{ fontSize: 12, fontWeight: 700 }}>
                {user?.barangay_name || 'Ibabang Dupay Zone 1'}
              </div>
            </div>
          </div>
        </div>

        {/* ── HOW IT WORKS banner ── */}
        <div style={{
          background: 'rgba(20,184,166,0.05)', border: '1px solid rgba(20,184,166,0.18)',
          borderRadius: 12, padding: '12px 16px', marginBottom: 20,
          display: 'flex', alignItems: 'flex-start', gap: 12,
        }}>
          <span style={{ fontSize: 20, flexShrink: 0 }}>ℹ️</span>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7 }}>
            <strong style={{ color: 'var(--text)' }}>How validation works:</strong> Citizens and Watchers submit reports.
            Only <strong style={{ color: 'var(--accent)' }}>Barangay Officials</strong> and <strong style={{ color: 'var(--accent)' }}>Admins</strong> can
            approve them. Approved reports appear on the <strong>live map</strong> for all users.
            Rejected reports are <strong>never deleted</strong> — they're saved in History.
          </div>
        </div>

        {/* ── TABS ── */}
        <div style={{
          display: 'flex', gap: 4, marginBottom: 18,
          background: 'var(--surface-2)', borderRadius: 10, padding: 4,
        }}>
          {TABS.map(t => (
            <button key={t.key}
              className="vr-btn"
              onClick={() => setActiveTab(t.key)}
              style={{
                flex: 1, position: 'relative',
                padding: '9px 12px', borderRadius: 8,
                border: 'none', fontFamily: 'var(--font-body)',
                fontSize: 13, fontWeight: 600,
                background: activeTab === t.key ? 'var(--surface-3)' : 'transparent',
                color: activeTab === t.key ? '#fff' : 'var(--text-muted)',
                boxShadow: activeTab === t.key ? '0 2px 8px rgba(0,0,0,.15)' : 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}>
              <span>{t.icon}</span>
              <span>{t.label}</span>
              {counts[t.key] > 0 && (
                <span style={{
                  minWidth: 18, height: 18, borderRadius: 20, padding: '0 4px',
                  background: t.key === 'pending' ? 'var(--warning)' : t.key === 'history' ? 'var(--danger)' : 'var(--accent)',
                  color: '#fff', fontSize: 9, fontWeight: 800,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {counts[t.key]}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── SEARCH + FILTER ── */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="Search address, type, reporter…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              flex: 1, minWidth: 200,
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 8, color: 'var(--text)',
              padding: '9px 14px', fontSize: 13,
              fontFamily: 'var(--font-body)', outline: 'none',
            }}
          />
          <div style={{ display: 'flex', gap: 6 }}>
            {[
              { key: 'all', label: 'All Types' },
              { key: 'overflow', label: 'Overflow' },
              { key: 'illegal_dumping', label: 'Illegal Dumping' },
              { key: 'missed', label: 'Missed' },
            ].map(f => (
              <button key={f.key} className="vr-pill"
                onClick={() => setTypeFilter(f.key)}
                style={{
                  padding: '7px 12px', borderRadius: 8, border: '1px solid',
                  fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-body)',
                  borderColor: typeFilter === f.key ? 'var(--accent)' : 'var(--border)',
                  color: typeFilter === f.key ? 'var(--accent)' : 'var(--text-muted)',
                  background: typeFilter === f.key ? 'rgba(46,204,113,0.08)' : 'var(--surface)',
                  whiteSpace: 'nowrap',
                }}>
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── REPORT LIST ── */}
        {filtered.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '48px 20px' }}>
            <div style={{ fontSize: 44, marginBottom: 12 }}>
            </div>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>
              {activeTab === 'pending' ? 'No pending reports' :
                activeTab === 'approved' ? 'No approved reports yet' :
                  'No rejected reports in history'}
            </div>
            <div className="text-muted text-sm">
              {search || typeFilter !== 'all' ? 'Try adjusting your filters.' : ''}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filtered.map((report, i) => {
              const tm = TYPE_META[report.type]
              const sm = STATUS_META[report.status]
              return (
                <div key={report.id}
                  className="vr-card"
                  style={{
                    background: 'var(--surface)', border: '1px solid var(--border)',
                    borderRadius: 14, overflow: 'hidden',
                    animation: `fadeUp .2s ease both`,
                    animationDelay: `${i * 40}ms`,
                  }}
                  onClick={() => setDrawerReport(report)}
                >
                  <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>

                    {/* Type icon */}
                    <div style={{
                      width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                      background: tm.bg, display: 'flex', alignItems: 'center',
                      justifyContent: 'center', fontSize: 20,
                    }}>
                      {tm.icon}
                    </div>

                    {/* Content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        flexWrap: 'wrap', marginBottom: 2
                      }}>
                        <span style={{ fontWeight: 700, fontSize: 14 }}>{tm.label}</span>

                        {/* Status badge */}
                        <span style={{
                          background: sm.bg, color: sm.color,
                          fontSize: 9, fontWeight: 800, padding: '2px 8px',
                          borderRadius: 20, letterSpacing: '.05em',
                        }}>{sm.label.toUpperCase()}</span>

                        {/* Severity dot */}
                        <span style={{
                          width: 7, height: 7, borderRadius: '50%',
                          background: SEVERITY_COLORS[report.severity],
                          display: 'inline-block',
                          boxShadow: `0 0 5px ${SEVERITY_COLORS[report.severity]}`,
                        }} />

                        {/* Map visible indicator */}
                        {report.visibleOnMap && (
                          <span style={{
                            fontSize: 9, fontWeight: 700, color: 'var(--accent)',
                            background: 'rgba(34,197,94,0.08)',
                            border: '1px solid rgba(34,197,94,0.25)',
                            padding: '2px 7px', borderRadius: 20,
                          }}>🗺 On Map</span>
                        )}

                        {!report.photo && report.status === 'pending' && (
                          <span style={{ fontSize: 10, color: 'var(--danger)' }}>⚠️ No photo</span>
                        )}
                      </div>

                      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>
                        {report.address}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {report.reporter} · {report.date} {report.time}
                      </div>
                    </div>

                    {/* Arrow */}
                    <div style={{ fontSize: 16, color: 'var(--text-muted)', flexShrink: 0 }}>›</div>
                  </div>

                  {/* Quick actions bar — only for pending */}
                  {report.status === 'pending' && (
                    <div style={{
                      borderTop: '1px solid var(--border)',
                      display: 'flex',
                    }}
                      onClick={e => e.stopPropagation()}>
                      <button className="vr-btn"
                        onClick={e => { e.stopPropagation(); openRejectModal(report.id) }}
                        style={{
                          flex: 1, padding: '10px', background: 'transparent',
                          border: 'none', borderRight: '1px solid var(--border)',
                          color: 'var(--danger)', fontSize: 12, fontWeight: 700,
                        }}>
                        ✕ Reject
                      </button>
                      <button className="vr-btn"
                        onClick={e => { e.stopPropagation(); handleApprove(report.id) }}
                        style={{
                          flex: 2, padding: '10px', background: 'rgba(46,204,113,0.06)',
                          border: 'none', color: 'var(--accent)', fontSize: 12, fontWeight: 700,
                        }}>
                        Approve &amp; Publish to Map
                      </button>
                    </div>
                  )}

                  {/* History rejection reason preview */}
                  {report.status === 'rejected' && report.rejectionReason && (
                    <div style={{
                      borderTop: '1px solid var(--border)',
                      padding: '9px 16px',
                      background: 'rgba(239,68,68,0.03)',
                    }}>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        <strong style={{ color: 'var(--danger)' }}>Reason:</strong> {report.rejectionReason}
                      </span>
                    </div>
                  )}

                  {/* Approved: map visibility note */}
                  {report.status === 'approved' && (
                    <div style={{
                      borderTop: '1px solid var(--border)',
                      padding: '9px 16px',
                      background: 'rgba(34,197,94,0.03)',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    }}>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        <strong style={{ color: 'var(--accent)' }}>Validated</strong> by {report.validatedBy}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600 }}>
                        🗺 Live on map
                      </span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

      </div>
    </DashboardLayout>
  )
}

// ─── HELPER COMPONENTS ────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const sm = STATUS_META[status] || STATUS_META.pending
  return (
    <span style={{
      background: sm.bg, color: sm.color,
      border: `1px solid ${sm.color}44`,
      fontSize: 10, fontWeight: 800, padding: '3px 10px',
      borderRadius: 20, letterSpacing: '.06em',
    }}>
      {sm.label.toUpperCase()}
    </span>
  )
}