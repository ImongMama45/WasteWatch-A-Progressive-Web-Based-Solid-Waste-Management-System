import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../../api/client'
import TrucksOverlay from './components/TrucksOverlay'
import ArrivalLogger from './ArrivalLogger'

const Ico = ({ d, size = 14, color = 'currentColor', sw = 1.75, style = {}, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw}
    strokeLinecap="round" strokeLinejoin="round" className={className} style={{ flexShrink: 0, display: 'block', ...style }}>
    {Array.isArray(d) ? d.map((p, i) => <path key={i} d={p} />) : <path d={d} />}
  </svg>
);
const IcoTruck = p => <Ico {...p} d={["M1 3h15v13H1z", "M16 8h4l3 3v5h-7V8z", "M5.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z", "M18.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"]} />;
const IcoCheck = p => <Ico {...p} d={["M20 6L9 17l-5-5"]} />;
const IcoPin = p => <Ico {...p} d={["M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1 1 18 0z", "M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"]} />;

export default function TruckQueue() {
  const navigate       = useNavigate()
  const [siteId,   setSiteId]   = useState(null)
  const [queue,    setQueue]    = useState([])
  const [loading,  setLoading]  = useState(true)
  const [lastUpdate, setLastUpdate] = useState(null)
  const [overlayOpen, setOverlayOpen] = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  const [logTruckId, setLogTruckId] = useState('')
  const intervalRef = useRef(null)

  useEffect(() => {
    api.get('/api/dumpsite/dumpsites/').then(res => {
      if (res.data.length > 0) setSiteId(res.data[0].id)
    })
    return () => clearInterval(intervalRef.current)
  }, [])

  const fetchQueue = (id) => {
    api.get(`/api/dumpsite/dumpsites/${id}/inbound_queue/`)
      .then(res => { setQueue(res.data); setLoading(false); setLastUpdate(new Date()) })
      .catch(() => setLoading(false))
  }

  useEffect(() => {
    if (!siteId) return
    fetchQueue(siteId)
    intervalRef.current = setInterval(() => fetchQueue(siteId), 30000)
    return () => clearInterval(intervalRef.current)
  }, [siteId])

  return (
    <div style={{ padding: '1.5rem', maxWidth: 900, margin: '0 auto' }}>
      <header style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 900, letterSpacing: '-0.03em', color: 'var(--surface-3)' }}>
            Truck Queue
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: 2 }}>
            Live inbound trucks heading to this dumpsite
            {lastUpdate && <span style={{ opacity: 0.6 }}> · Updated {lastUpdate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => setOverlayOpen(true)} style={{
            background: 'var(--surface-1)', border: '1px solid var(--border)', color: 'var(--surface-3)',
            borderRadius: 12, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.15s'
          }}>
            <IcoTruck size={14} /> Assigned Trucks
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', animation: 'pulse 2s infinite', boxShadow: '0 0 8px #22c55e' }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: '#22c55e' }}>Auto-refresh every 30s</span>
          </div>
        </div>
      </header>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>Loading queue...</div>
      ) : queue.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '4rem 2rem', border: '2px dashed var(--border)', borderRadius: 24, color: 'var(--text-muted)' }}>
          <IcoTruck size={48} style={{ marginBottom: 12, margin: '0 auto', opacity: 0.5 }} />
          <p style={{ fontWeight: 700, fontSize: '1rem', marginBottom: 4 }}>No trucks inbound right now</p>
          <p style={{ fontSize: '0.875rem' }}>Trucks will appear here when drivers mark themselves as heading to the dumpsite.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {queue.map(item => (
            <div key={item.shift_id} className="card-light" style={{ padding: '1.25rem', borderRadius: 22, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              {/* Left: Truck + Driver */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flex: 1 }}>
                <div style={{
                  width: 52, height: 52, borderRadius: 16,
                  background: 'rgba(46,204,113,0.12)', border: '2px solid rgba(46,204,113,0.3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#22c55e',
                }}>
                  <IcoTruck size={24} />
                </div>
                <div>
                  <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--surface-3)' }}>{item.truck_plate}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{item.driver}</div>
                </div>
              </div>

              {/* Middle: Barangays + Capacity */}
              <div style={{ flex: 2 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Barangays Covered</div>
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                  {item.barangays.length > 0 ? item.barangays.map(b => (
                    <span key={b} style={{ background: 'rgba(59,130,246,0.1)', color: '#3b82f6', border: '1px solid rgba(59,130,246,0.2)', borderRadius: 20, padding: '2px 10px', fontSize: 11, fontWeight: 700 }}>{b}</span>
                  )) : <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>}
                </div>
                <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-muted)' }}>
                  Max capacity: <strong style={{ color: 'var(--surface-3)' }}>{Number(item.truck_max_capacity_kg).toLocaleString()} kg</strong>
                </div>
              </div>

              {/* Right: Status + CTA */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'flex-end' }}>
                {item.op_status === 'at_dumpsite' ? (
                  <span style={{
                    background: 'rgba(34,197,94,0.12)', color: '#22c55e',
                    border: '1px solid rgba(34,197,94,0.3)',
                    borderRadius: 20, padding: '4px 12px', fontSize: 11, fontWeight: 800,
                    display: 'flex', alignItems: 'center', gap: '6px'
                  }}>
                    <IcoCheck size={12} sw={2.5} /> Waiting for Calibration
                  </span>
                ) : (
                  <span style={{
                    background: 'rgba(59,130,246,0.12)', color: '#3b82f6',
                    border: '1px solid rgba(59,130,246,0.3)',
                    borderRadius: 20, padding: '4px 12px', fontSize: 11, fontWeight: 800,
                    display: 'flex', alignItems: 'center', gap: '6px'
                  }}>
                    <IcoPin size={12} /> In Transit
                  </span>
                )}
                
                <button
                  disabled={item.op_status !== 'at_dumpsite'}
                  onClick={() => { setLogTruckId(item.truck_id); setLogOpen(true); }}
                  style={{
                    background: item.op_status === 'at_dumpsite' ? 'var(--accent)' : 'rgba(148,163,184,0.15)',
                    color: item.op_status === 'at_dumpsite' ? '#0d1117' : '#94a3b8',
                    border: item.op_status === 'at_dumpsite' ? 'none' : '1.5px solid var(--border)',
                    borderRadius: 12, padding: '0.55rem 1rem',
                    fontWeight: 700, fontSize: '0.8rem', 
                    cursor: item.op_status === 'at_dumpsite' ? 'pointer' : 'not-allowed',
                    whiteSpace: 'nowrap',
                    opacity: item.op_status === 'at_dumpsite' ? 1 : 0.6
                  }}
                >
                  Log This Arrival →
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <TrucksOverlay open={overlayOpen} onClose={() => setOverlayOpen(false)} siteId={siteId} />
      <ArrivalLogger 
        open={logOpen} 
        onClose={(refresh) => { 
          setLogOpen(false)
          if (refresh) fetchQueue() 
        }} 
        defaultTruckId={logTruckId} 
      />
    </div>
  )
}
