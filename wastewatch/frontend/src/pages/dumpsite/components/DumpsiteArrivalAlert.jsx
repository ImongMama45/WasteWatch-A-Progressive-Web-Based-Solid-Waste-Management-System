import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import api from '../../../api/client'
import { useAuth } from '../../../context/AuthContext'
import { ICONS } from '../../../api/navConfig'

const Ico = ({ d, size = 14, color = 'currentColor', sw = 1.75, style = {}, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw}
    strokeLinecap="round" strokeLinejoin="round" className={className} style={{ flexShrink: 0, display: 'block', ...style }}>
    {Array.isArray(d) ? d.map((p, i) => <path key={i} d={p} />) : <path d={d} />}
  </svg>
);
const IcoArrowRight = p => <Ico {...p} d="M5 12h14M12 5l7 7-7 7" />;
const IcoX = p => <Ico {...p} d="M18 6L6 18M6 6l12 12" />;

export default function DumpsiteArrivalAlert() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  
  const [siteId, setSiteId] = useState(null)
  const [arrivedTrucks, setArrivedTrucks] = useState([])
  const intervalRef = useRef(null)
  const [dismissedTrucks, setDismissedTrucks] = useState(new Set())

  if (user?.role !== 'dumpsite') return null

  // Only run for dumpsite operators
  useEffect(() => {
    api.get('/api/dumpsite/dumpsites/').then(res => {
      if (res.data.length > 0) setSiteId(res.data[0].id)
    }).catch(err => console.error("Error fetching dumpsite ID", err))
  }, [user])

  const fetchQueue = (id) => {
    api.get(`/api/dumpsite/dumpsites/${id}/inbound_queue/`)
      .then(res => {
        // Filter trucks that are AT the dumpsite
        const arrived = res.data.filter(t => t.op_status === 'at_dumpsite')
        setArrivedTrucks(arrived)
      })
      .catch(() => {})
  }

  useEffect(() => {
    if (!siteId) return
    fetchQueue(siteId)
    intervalRef.current = setInterval(() => fetchQueue(siteId), 15000) // Poll every 15s
    return () => clearInterval(intervalRef.current)
  }, [siteId])

  // Don't show the alert if the user is already on the Queue or Log Arrival page
  if (location.pathname.includes('/dumpsite/queue') || location.pathname.includes('/dumpsite/log-arrival')) {
    return null
  }

  // Filter out dismissed trucks
  const visibleTrucks = arrivedTrucks.filter(t => !dismissedTrucks.has(t.truck_id))

  if (visibleTrucks.length === 0) return null

  return (
    <div style={{
      position: 'fixed',
      bottom: '90px', // Above bottom nav if present
      right: '20px',
      zIndex: 9999,
      display: 'flex',
      flexDirection: 'column',
      gap: '10px'
    }}>
      {visibleTrucks.map(truck => (
        <div key={truck.truck_id} style={{
          background: '#ffffff',
          border: '1px solid #e4e6eb',
          borderLeft: '4px solid #16a34a',
          borderRadius: '8px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
          padding: '14px 16px',
          width: '320px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          animation: 'slideInRight 0.25s ease-out forwards',
          fontFamily: 'var(--font-body, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
              <div style={{ 
                width: 22, height: 22, borderRadius: '4px', 
                background: '#e7f5eb', color: '#16a34a',
                display: 'flex', alignItems: 'center', justifyContent: 'center' 
              }}>
                {ICONS.truck || ICONS.warning}
              </div>
              <span style={{ 
                fontWeight: 700, fontSize: '11px', textTransform: 'uppercase', 
                letterSpacing: '0.04em', color: '#15803d' 
              }}>
                Truck Arrived at Dumpsite
              </span>
            </div>
            <button 
              onClick={() => setDismissedTrucks(prev => new Set(prev).add(truck.truck_id))}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#8a8d91',
                cursor: 'pointer',
                padding: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '4px'
              }}
              title="Dismiss"
            >
              <IcoX size={15} sw={2.5} />
            </button>
          </div>
          
          <div style={{ padding: '2px 0' }}>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#1c1e21', letterSpacing: '-0.01em' }}>
              {truck.truck_plate}
            </div>
            <div style={{ fontSize: '12px', color: '#65676b', marginTop: '2px' }}>
              Driver: <span style={{ color: '#1c1e21', fontWeight: 500 }}>{truck.driver}</span>
            </div>
          </div>

          <button 
            onClick={() => navigate(`/dumpsite/queue`)}
            style={{
              background: '#16a34a',
              color: '#ffffff',
              border: 'none',
              padding: '8px 12px',
              borderRadius: '6px',
              fontWeight: 600,
              fontSize: '13px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              transition: 'background-color 0.15s ease'
            }}
            onMouseEnter={e => e.currentTarget.style.background = '#15803d'}
            onMouseLeave={e => e.currentTarget.style.background = '#16a34a'}
          >
            Review in Queue <IcoArrowRight size={14} sw={2.5} />
          </button>
        </div>
      ))}
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  )
}
