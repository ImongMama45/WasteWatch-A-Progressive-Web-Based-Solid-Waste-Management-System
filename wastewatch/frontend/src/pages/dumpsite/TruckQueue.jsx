import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Truck, Check, MapPin, ArrowRight, Activity, AlertCircle } from 'lucide-react'
import { getDumpsiteInboundQueue, unwrapList } from '../../api/dumpsiteApi'
import TrucksOverlay from './components/TrucksOverlay'
import ArrivalLogger from './ArrivalLogger'
import FacilityWorkspaceHeader from './components/FacilityWorkspaceHeader'
import { useFacilityScope } from './components/useFacilityScope'
import { useAuth } from '../../context/AuthContext'
import { LiveTrackerSkeleton } from '../../components/ui/Skeleton'
import { getApiErrorMessage } from '../../utils/notificationHelpers'

export default function TruckQueue() {
  const navigate = useNavigate()
  const { sites, siteId, setSiteId, activeSite, isAdmin, loading: scopeLoading, error: scopeError } = useFacilityScope()
  const { user } = useAuth()
  const isOperator = Boolean(user?.role === 'dumpsite' && !isAdmin)

  const [queue, setQueue] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lastUpdate, setLastUpdate] = useState(null)
  const [overlayOpen, setOverlayOpen] = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  const [logTruckId, setLogTruckId] = useState('')
  const intervalRef = useRef(null)

  const fetchQueue = useCallback((id) => {
    if (!id) return
    getDumpsiteInboundQueue(id)
      .then((raw) => {
        setQueue(unwrapList(raw))
        setError(null)
        setLoading(false)
        setLastUpdate(new Date())
      })
      .catch((err) => {
        setError(getApiErrorMessage(err, 'Failed to load inbound queue.'))
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    if (!siteId) {
      if (!scopeLoading) setLoading(false)
      return
    }
    setLoading(true)
    fetchQueue(siteId)
    intervalRef.current = setInterval(() => {
      if (!document.hidden) fetchQueue(siteId)
    }, 30000)
    return () => clearInterval(intervalRef.current)
  }, [siteId, scopeLoading, fetchQueue])

  return (
    <div style={{ background: '#f0f2f5', minHeight: '100vh', padding: '20px 24px 60px' }}>
      <div style={{ maxWidth: 1240, margin: '0 auto' }}>
        <FacilityWorkspaceHeader
          title="Inbound Truck Queue"
          subtitle="Live inbound trucks returning to this facility for unloading and arrival confirmation."
          sites={sites}
          siteId={siteId}
          onSiteChange={setSiteId}
          activeSite={activeSite}
          isAdmin={isAdmin}
          rightContent={
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setOverlayOpen(true)}
                disabled={!siteId}
                style={{
                  background: '#ffffff',
                  border: '1px solid #ced0d4',
                  color: '#1c1e21',
                  borderRadius: 6,
                  height: 36,
                  padding: '0 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: siteId ? 'pointer' : 'not-allowed',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Truck size={14} /> Assigned Trucks
              </button>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 6, background: '#e7f5eb', border: '1px solid #bbf7d0' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#16a34a' }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: '#15803d' }}>
                  {lastUpdate ? `  ${lastUpdate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
                </span>
              </div>
            </div>
          }
        />

        {(scopeError || error) && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 8, padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600 }}>
            <AlertCircle size={16} />
            <span>{scopeError || error}</span>
          </div>
        )}

        {loading || scopeLoading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <LiveTrackerSkeleton />
            <LiveTrackerSkeleton />
          </div>
        ) : queue.length === 0 ? (
          <div className="ww-fade-in" style={{ background: '#ffffff', textAlign: 'center', padding: '4rem 2rem', border: '1px dashed #ced0d4', borderRadius: 10, color: '#65676b' }}>
            <Truck size={42} style={{ margin: '0 auto 12px', opacity: 0.45 }} />
            <p style={{ fontWeight: 700, fontSize: 15, color: '#1c1e21', margin: '0 0 4px' }}>No trucks inbound right now</p>
            <p style={{ fontSize: 13, margin: 0 }}>Trucks appear here when drivers mark themselves as heading to this dumpsite.</p>
          </div>
        ) : (
          <div className="ww-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {queue.map((item) => (
              <div
                key={item.shift_id}
                style={{
                  background: '#ffffff',
                  border: '1px solid #e4e6eb',
                  borderRadius: 10,
                  padding: '16px 20px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 16,
                  flexWrap: 'wrap',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: '1 1 220px' }}>
                  <div
                    style={{
                      width: 46,
                      height: 46,
                      borderRadius: 8,
                      background: '#e7f5eb',
                      border: '1px solid #bbf7d0',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#16a34a',
                    }}
                  >
                    <Truck size={22} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15, color: '#1c1e21' }}>{item.truck_plate}</div>
                    <div style={{ fontSize: 13, color: '#65676b' }}>{item.driver}</div>
                  </div>
                </div>

                <div style={{ flex: '2 1 260px' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
                    Barangays Covered
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {Array.isArray(item.barangays) && item.barangays.length > 0 ? (
                      item.barangays.map((b) => (
                        <span
                          key={b}
                          style={{
                            background: '#eff6ff',
                            color: '#1d4ed8',
                            border: '1px solid #bfdbfe',
                            borderRadius: 4,
                            padding: '2px 8px',
                            fontSize: 11,
                            fontWeight: 600,
                          }}
                        >
                          {b}
                        </span>
                      ))
                    ) : (
                      <span style={{ color: '#65676b', fontSize: 12 }}>--</span>
                    )}
                  </div>
                  <div style={{ marginTop: 6, fontSize: 12, color: '#65676b' }}>
                    Max capacity: <strong style={{ color: '#1c1e21' }}>{Number(item.truck_max_capacity_kg || 0).toLocaleString()} kg</strong>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
                  {item.op_status === 'at_dumpsite' ? (
                    <span
                      style={{
                        background: '#e7f5eb',
                        color: '#15803d',
                        border: '1px solid #bbf7d0',
                        borderRadius: 4,
                        padding: '3px 10px',
                        fontSize: 11,
                        fontWeight: 700,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                      }}
                    >
                      <Check size={12} strokeWidth={2.5} /> Waiting for Calibration
                    </span>
                  ) : (
                    <span
                      style={{
                        background: '#dbeafe',
                        color: '#1d4ed8',
                        border: '1px solid #bfdbfe',
                        borderRadius: 4,
                        padding: '3px 10px',
                        fontSize: 11,
                        fontWeight: 700,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                      }}
                    >
                      <MapPin size={12} /> In Transit
                    </span>
                  )}

                  {isOperator ? (
                    <button
                      type="button"
                      disabled={item.op_status !== 'at_dumpsite'}
                      onClick={() => {
                        setLogTruckId(item.truck_id)
                        setLogOpen(true)
                      }}
                      style={{
                        background: item.op_status === 'at_dumpsite' ? '#16a34a' : '#f0f2f5',
                        color: item.op_status === 'at_dumpsite' ? '#ffffff' : '#8a8d91',
                        border: item.op_status === 'at_dumpsite' ? 'none' : '1px solid #ced0d4',
                        borderRadius: 6,
                        padding: '8px 14px',
                        fontWeight: 600,
                        fontSize: 12,
                        cursor: item.op_status === 'at_dumpsite' ? 'pointer' : 'not-allowed',
                        whiteSpace: 'nowrap',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      Log This Arrival <ArrowRight size={13} />
                    </button>
                  ) : (
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: '#65676b',
                        padding: '6px 12px',
                        background: '#f0f2f5',
                        borderRadius: 6,
                        border: '1px solid #ced0d4',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      Operator Action Only
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}


      </div>
    </div>
  )
}
