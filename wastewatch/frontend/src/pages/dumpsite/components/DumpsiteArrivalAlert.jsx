import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { ArrowRight, X } from 'lucide-react'
import { useAuth } from '../../../context/AuthContext'
import { ICONS } from '../../../api/navConfig'
import { getDumpsites, getDumpsiteInboundQueue, unwrapList } from '../../../api/dumpsiteApi'

export default function DumpsiteArrivalAlert() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const isDumpsiteOperator = user?.role === 'dumpsite'
  const [siteId, setSiteId] = useState(null)
  const [arrivedTrucks, setArrivedTrucks] = useState([])
  const intervalRef = useRef(null)
  const [dismissedTrucks, setDismissedTrucks] = useState(new Set())

  // Hooks must run unconditionally before any early return
  useEffect(() => {
    if (!isDumpsiteOperator) {
      setSiteId(null)
      setArrivedTrucks([])
      return
    }
    getDumpsites({ paginate: false })
      .then((raw) => {
        const sites = unwrapList(raw)
        if (sites.length > 0) setSiteId(sites[0].id)
      })
      .catch((err) => console.error('Error fetching dumpsite ID', err))
  }, [isDumpsiteOperator, user?.id])

  useEffect(() => {
    if (!isDumpsiteOperator || !siteId) return
    const fetchQueue = () => {
      if (document.hidden) return
      getDumpsiteInboundQueue(siteId)
        .then((raw) => {
          const list = unwrapList(raw)
          const arrived = list.filter((t) => t.op_status === 'at_dumpsite')
          setArrivedTrucks(arrived)
        })
        .catch(() => {})
    }

    fetchQueue()
    intervalRef.current = setInterval(fetchQueue, 15000)
    return () => clearInterval(intervalRef.current)
  }, [isDumpsiteOperator, siteId])

  if (!isDumpsiteOperator) return null

  if (location.pathname.includes('/dumpsite/queue') || location.pathname.includes('/dumpsite/log-arrival')) {
    return null
  }

  const visibleTrucks = arrivedTrucks.filter((t) => !dismissedTrucks.has(t.truck_id))
  if (visibleTrucks.length === 0) return null

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '90px',
        right: '20px',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      }}
    >
      {visibleTrucks.map((truck) => (
        <div
          key={truck.truck_id}
          style={{
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
            fontFamily: 'var(--font-body, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
              <div
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: '4px',
                  background: '#e7f5eb',
                  color: '#16a34a',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {ICONS.truck || ICONS.warning}
              </div>
              <span
                style={{
                  fontWeight: 700,
                  fontSize: '11px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  color: '#15803d',
                }}
              >
                Truck Arrived at Dumpsite
              </span>
            </div>
            <button
              type="button"
              onClick={() => setDismissedTrucks((prev) => new Set(prev).add(truck.truck_id))}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#8a8d91',
                cursor: 'pointer',
                padding: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '4px',
              }}
              title="Dismiss"
            >
              <X size={15} strokeWidth={2.5} />
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
            type="button"
            onClick={() => navigate('/dumpsite/queue')}
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
              transition: 'background-color 0.15s ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#15803d' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = '#16a34a' }}
          >
            Review in Queue <ArrowRight size={14} strokeWidth={2.5} />
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
