/**
 * DriverCollectionLog.jsx
 * ------------------------
 * Weekly Shift Summary for the Driver
 */

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import api from '../../api/client'

const Ico = ({ d, size = 14, color = 'currentColor', sw = 1.75, style = {}, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw}
    strokeLinecap="round" strokeLinejoin="round" className={className} style={{ flexShrink: 0, display: 'block', ...style }}>
    {Array.isArray(d) ? d.map((p, i) => <path key={i} d={p} />) : <path d={d} />}
  </svg>
);
const IcoListAlt = p => <Ico {...p} d={["M8 6h13", "M8 12h13", "M8 18h13", "M3 6h.01", "M3 12h.01", "M3 18h.01"]} />;
const IcoChevronLeft = p => <Ico {...p} d="M15 18l-6-6 6-6" />;
const IcoCheck = p => <Ico {...p} d="M20 6L9 17l-5-5" />;

const CATEGORY_COLORS = {
  'Biodegradable': '#2ecc71',
  'Recyclable': '#3b82f6',
  'Mixed Waste': '#f59e0b',
  'Hazardous': '#ef4444',
}

function categoryColor(cat) {
  return CATEGORY_COLORS[cat] || 'var(--text-muted)'
}

function HistoryCard({ entry }) {
  const color = categoryColor(entry.category)
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 0',
      borderBottom: '1px solid var(--border)',
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
        background: 'rgba(46,204,113,0.12)', border: '1.5px solid #2ecc71',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: 800, color: '#2ecc71',
      }}>
        <IcoCheck size={16} sw={3} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{entry.address}</div>
        <div className="text-muted text-xs" style={{ marginBottom: entry.note ? 4 : 0 }}>
          <span style={{ color }}>{entry.category}</span>
          {' · '}{entry.barangay}{' · '}{entry.collectedAt}
        </div>
        {entry.note && (
          <div style={{
            fontSize: 11, color: 'var(--text-muted)',
            background: 'var(--bg)', borderRadius: 6, padding: '3px 8px',
            display: 'inline-block', marginTop: 2,
          }}>
            {entry.note}
          </div>
        )}
      </div>
    </div>
  )
}

export default function DriverCollectionLog() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/api/driver/stops/history/week/')
      .then(res => {
        if (res.data) setHistory(res.data)
      })
      .catch(() => setHistory([]))
      .finally(() => setLoading(false))
  }, [])

  // Group by date
  const grouped = history.reduce((acc, stop) => {
    if (!stop.date) return acc
    if (!acc[stop.date]) acc[stop.date] = []
    acc[stop.date].push(stop)
    return acc
  }, {})

  const sortedDates = Object.keys(grouped).sort((a, b) => new Date(b) - new Date(a))

  return (
    <>
      <style>{`
        @keyframes slideDown {
          from { opacity:0; transform:translateY(-8px); }
          to   { opacity:1; transform:translateY(0); }
        }
        .dcl-section { animation: slideDown .2s ease both; }
      `}</style>
      <div className="page" style={{ paddingBottom: 88 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
          <button onClick={() => navigate('/dashboard')} style={{
            background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 14, fontWeight: 700, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6, padding: 0
          }}>
            <IcoChevronLeft size={18} sw={2.5} /> Dashboard
          </button>
        </div>

        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontFamily: 'var(--font-head)', fontSize: 24, fontWeight: 800, margin: 0 }}>Weekly Summary</h1>
          <p className="text-muted text-xs" style={{ marginTop: 2 }}>Your collections over the last 7 days</p>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: 40 }}>Loading...</div>
        ) : sortedDates.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '32px 20px' }}>
            <IcoListAlt size={36} style={{ marginBottom: 10, margin: '0 auto', opacity: 0.5 }} />
            <div className="text-muted text-sm">No collections recorded in the last 7 days.</div>
          </div>
        ) : (
          sortedDates.map(date => {
            // Because Date parsing can be tricky with timezones, we construct it properly or just use substring
            // date is "YYYY-MM-DD"
            const [y, m, d] = date.split('-')
            const dayName = new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })

            return (
              <div key={date} className="card dcl-section" style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                  <h2 className="section-title" style={{ fontSize: 14, margin: 0 }}>{dayName.toUpperCase()}</h2>
                  <span className="text-muted text-xs">{grouped[date].length} stops</span>
                </div>
                <div>
                  {grouped[date].map((entry) => (
                    <HistoryCard key={entry.id} entry={entry} />
                  ))}
                </div>
              </div>
            )
          })
        )}
      </div>
    </>
  )
}
