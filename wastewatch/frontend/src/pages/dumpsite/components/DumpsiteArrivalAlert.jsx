import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import api from '../../../api/client'
import { useAuth } from '../../../context/AuthContext'
import { ICONS } from '../../../api/navConfig'

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
          background: '#fff',
          border: '2px solid #ef4444',
          borderRadius: '16px',
          boxShadow: '0 10px 25px rgba(239,68,68,0.3)',
          padding: '16px',
          width: '320px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          animation: 'slideInRight 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#ef4444' }}>
              <div style={{ width: 20, height: 20, animation: 'pulse 2s infinite' }}>
                {ICONS.warning}
              </div>
              <span style={{ fontWeight: 900, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Truck Arrived!
              </span>
            </div>
            <button 
              onClick={() => setDismissedTrucks(prev => new Set(prev).add(truck.truck_id))}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#94a3b8',
                cursor: 'pointer',
                padding: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
          
          <div>
            <div style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
              {truck.truck_plate}
            </div>
            <div style={{ fontSize: '13px', color: '#64748b', marginTop: '2px' }}>
              Driver: {truck.driver}
            </div>
          </div>

          <button 
            onClick={() => navigate(`/dumpsite/queue`)}
            style={{
              background: '#ef4444',
              color: '#fff',
              border: 'none',
              padding: '12px',
              borderRadius: '10px',
              fontWeight: 800,
              fontSize: '14px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px'
            }}
          >
            Review in Queue →
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
