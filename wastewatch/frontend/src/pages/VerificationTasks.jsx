/**
 * VerificationTasks.jsx
 * ----------------------
 * Watcher-only page showing all verification tasks for their assigned route.
 * Matches Image 2 & 3 (Verification_Tasks.png).
 *
 * Features:
 *  - Hero banner with "VERIFICATION TASKS" title
 *  - Active pending card (if any) with CONFIRM / REPORT ISSUE
 *  - Progress indicator (today's completion)
 *  - Filter tabs: All | Pending | Completed | Issues Reported
 *  - Task list cards with status badges
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Navbar from '../components/Navbar'
import BottomNav from '../components/BottomNav'

const MOCK_TASKS = [
  {
    id: 1,
    title: 'Katapat ng Gripo mabaho',
    barangay: 'Baranggay 1, 5th Ave',
    date: 'Mar 14',
    status: 'awaiting',
    driver: 'Hassad Gerald',
    truck: '01-12-51',
    distance: '0.3 KM',
    time_reported: '2:00 AM',
    avatar: null,
  },
  {
    id: 2,
    title: 'Grabe man uy',
    barangay: 'Baranggay 1, 5th Ave',
    date: 'Mar 14',
    status: 'completed',
    driver: 'Ramon Santos',
    truck: '02-08-33',
    distance: '0.8 KM',
    time_reported: '4:10 AM',
    avatar: null,
  },
  {
    id: 3,
    title: 'Grabe man uy',
    barangay: 'Baranggay 1, 5th Ave',
    date: 'Mar 14',
    status: 'taken',
    driver: 'Jun Dela Cruz',
    truck: '03-11-20',
    distance: '1.2 KM',
    time_reported: '5:30 AM',
    avatar: null,
  },
]

const FILTERS = ['All', 'Pending', 'Completed', 'Issues Reported']

const STATUS_META = {
  awaiting:  { label: 'Awaiting Verification', color: '#e74c3c',  bg: 'rgba(231,76,60,.12)' },
  completed: { label: 'Completed',             color: '#2ecc71',  bg: 'rgba(46,204,113,.12)' },
  taken:     { label: 'Got Taken',             color: '#f39c12',  bg: 'rgba(243,156,18,.12)' },
  issue:     { label: 'Issue Reported',        color: '#5dade2',  bg: 'rgba(93,173,226,.12)' },
}

function filterTasks(tasks, tab) {
  if (tab === 'All')             return tasks
  if (tab === 'Pending')         return tasks.filter(t => t.status === 'awaiting')
  if (tab === 'Completed')       return tasks.filter(t => t.status === 'completed')
  if (tab === 'Issues Reported') return tasks.filter(t => t.status === 'issue')
  return tasks
}

export default function VerificationTasks() {
  const navigate = useNavigate()
  const [activeTab,    setActiveTab]    = useState('All')
  const [tasks,        setTasks]        = useState(MOCK_TASKS)
  const [expandedId,   setExpandedId]   = useState(null)

  const topPending = tasks.find(t => t.status === 'awaiting')
  const completed  = tasks.filter(t => t.status === 'completed').length
  const total      = tasks.length
  const progress   = Math.round((completed / total) * 100)

  const filtered = filterTasks(tasks, activeTab)

  function handleConfirm(task) {
    navigate('/collection/confirm')
  }

  function handleTaskClick(id) {
    setExpandedId(prev => prev === id ? null : id)
  }

  return (
    <>
      <Navbar />

      {/* Hero Banner */}
      <div className="vt-hero">
        <div className="vt-hero-overlay" />
        <h1 className="vt-hero-title">VERIFICATION TASKS</h1>
      </div>

      <div className="page" style={{ maxWidth: 480, paddingTop: 16 }}>

        {/* ── Top pending card (active task) ── */}
        {topPending ? (
          <div className="card card-dark" style={{ padding: 20, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <span style={{ color: 'var(--danger)', fontSize: 18, marginTop: 2 }}>📍</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{topPending.barangay}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.8 }}>
                    <strong>Time Reported</strong> : {topPending.time_reported}<br />
                    <strong>Driver</strong> : {topPending.driver}<br />
                    <strong>Truck</strong> : {topPending.truck}
                  </div>
                </div>
              </div>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{topPending.distance}</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block' }} />
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Status : Awaiting Verification</span>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                className="btn btn-primary"
                style={{ flex: 1, fontWeight: 700, letterSpacing: '.05em', fontSize: 13 }}
                onClick={() => handleConfirm(topPending)}
              >
                CONFIRM
              </button>
              <button
                className="btn btn-outline"
                style={{ flex: 1, fontSize: 13 }}
                onClick={() => navigate('/report/submit')}
              >
                REPORT ISSUE
              </button>
            </div>
          </div>
        ) : (
          <div className="card" style={{ textAlign: 'center', padding: '32px 20px', marginBottom: 16 }}>
            <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No Available Tasks Today</p>
          </div>
        )}

        {/* ── Progress Indicator ── */}
        <div className="card card-dark" style={{ padding: '16px 20px', marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 18 }}>✅</span>
              <span style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 14 }}>
                Progress Indicator ( Today )
              </span>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600 }}>● Verified Location</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{completed}/{total} Locations</div>
            </div>
          </div>
          {/* Progress bar */}
          <div style={{ background: 'var(--border)', borderRadius: 20, height: 8, overflow: 'hidden' }}>
            <div style={{
              width: `${progress}%`,
              height: '100%',
              background: 'var(--accent)',
              borderRadius: 20,
              transition: 'width .6s ease',
            }} />
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6, textAlign: 'right' }}>
            {progress}%
          </div>
        </div>

        {/* ── Filter Tabs ── */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {FILTERS.map(f => (
            <button
              key={f}
              onClick={() => setActiveTab(f)}
              style={{
                padding: '7px 14px',
                borderRadius: 20,
                border: '1px solid var(--border)',
                background: activeTab === f ? 'var(--surface-2)' : 'transparent',
                color: activeTab === f ? 'var(--text)' : 'var(--text-muted)',
                fontSize: 12,
                fontWeight: activeTab === f ? 700 : 400,
                cursor: 'pointer',
                fontFamily: 'var(--font-body)',
                outline: activeTab === f ? '2px solid var(--accent)' : 'none',
                outlineOffset: -1,
              }}
            >
              {f}
            </button>
          ))}
        </div>

        {/* ── Task List ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filtered.map(task => {
            const meta = STATUS_META[task.status] || STATUS_META.awaiting
            return (
              <div
                key={task.id}
                className="vt-task-card"
                onClick={() => handleTaskClick(task.id)}
              >
                {/* Status badge + menu */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <span className="vt-status-badge" style={{ background: meta.bg, color: meta.color }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: meta.color, display: 'inline-block', marginRight: 5 }} />
                    {meta.label}
                  </span>
                  <button style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>
                    ···
                  </button>
                </div>

                {/* Title */}
                <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 12 }}>
                  {task.title}
                </div>

                {/* Meta row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-muted)' }}>
                    <span>📅</span> {task.date}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-muted)' }}>
                    <span>💬</span> {task.barangay}
                  </div>
                  {/* Avatar placeholder */}
                  <div style={{ marginLeft: 'auto', width: 28, height: 28, borderRadius: '50%', background: 'var(--surface-2)', border: '2px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>
                    👤
                  </div>
                </div>

                {/* Expanded: action buttons */}
                {expandedId === task.id && task.status === 'awaiting' && (
                  <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)', display: 'flex', gap: 10 }}
                       onClick={e => e.stopPropagation()}>
                    <button className="btn btn-primary" style={{ flex: 1, fontSize: 12, fontWeight: 700 }}
                            onClick={() => handleConfirm(task)}>
                      CONFIRM
                    </button>
                    <button className="btn btn-outline" style={{ flex: 1, fontSize: 12 }}
                            onClick={() => navigate('/report/submit')}>
                      REPORT ISSUE
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>

      </div>
      <BottomNav />
    </>
  )
}
