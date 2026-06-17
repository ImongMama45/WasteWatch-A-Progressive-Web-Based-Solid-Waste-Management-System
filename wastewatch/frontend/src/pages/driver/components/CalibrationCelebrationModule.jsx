import React, { useEffect, useRef, useMemo } from 'react'
import Navbar from '../../../components/Navbar'

const CheckIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"></polyline>
  </svg>
)

const WeightIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 12h-4l-3 9L9 3l-3 9H2"></path>
  </svg>
)

const RouteIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"></circle>
    <polyline points="12 6 12 12 16 14"></polyline>
  </svg>
)

const MapPinIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
    <circle cx="12" cy="10" r="3"></circle>
  </svg>
)

export default function CalibrationCelebrationModule({ calibrationData, schedule, stopStatuses, currentStopIndex, onContinue }) {
  const mapRef = useRef(null)
  const mapInstance = useRef(null)

  // Calculate completed and missed
  const totalStops = schedule?.waypoints?.length ? schedule.waypoints.length - 1 : parseInt(sessionStorage.getItem('ww_total_stops') || '0', 10)
  const completedStops = parseInt(sessionStorage.getItem('ww_completed_stops') || '0', 10)

  const missedStops = useMemo(() => {
    if (!schedule?.waypoints) {
      if (import.meta.env.DEV) {
        return [
          { lat: 13.93, lng: 121.61, label: 'Dummy Missed Stop 1' },
          { lat: 13.94, lng: 121.62, label: 'Dummy Missed Stop 2' },
        ]
      }
      return []
    }
    return schedule.waypoints.filter((wp, index) => {
      if (index === 0) return false // skip base
      const status = stopStatuses?.get(index)
      return status !== 'VERIFIED_COLLECTED' && status !== 'COLLECTION_REPORTED' && status !== 'COLLECTION_DISPUTED'
    })
  }, [schedule, stopStatuses])

  useEffect(() => {
    if (!mapRef.current || !window.L || missedStops.length === 0 || mapInstance.current) return

    const L = window.L

    let minLat = 999, maxLat = -999, minLng = 999, maxLng = -999
    missedStops.forEach(wp => {
      const lat = Number(wp.lat || wp.latitude)
      const lng = Number(wp.lng || wp.longitude)
      if (lat < minLat) minLat = lat
      if (lat > maxLat) maxLat = lat
      if (lng < minLng) minLng = lng
      if (lng > maxLng) maxLng = lng
    })

    let bounds
    if (minLat === maxLat && minLng === maxLng) {
      bounds = L.latLngBounds([minLat - 0.005, minLng - 0.005], [maxLat + 0.005, maxLng + 0.005])
    } else {
      bounds = L.latLngBounds([minLat, minLng], [maxLat, maxLng]).pad(0.2)
    }

    const map = L.map(mapRef.current, { zoomControl: false, scrollWheelZoom: false, dragging: false }).fitBounds(bounds)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map)
    mapInstance.current = map

    const resizeObserver = new ResizeObserver(() => {
      if (mapInstance.current) {
        mapInstance.current.invalidateSize()
      }
    })
    if (mapRef.current) {
      resizeObserver.observe(mapRef.current)
    }

    const missedIconHtml = `
      <div style="width:24px;height:24px;background:#ef4444;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 2px 5px rgba(0,0,0,0.2);">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </div>`
    const missedIcon = L.divIcon({ html: missedIconHtml, className: '', iconSize: [24, 24], iconAnchor: [12, 12] })

    missedStops.forEach(wp => {
      const lat = Number(wp.lat || wp.latitude)
      const lng = Number(wp.lng || wp.longitude)
      L.marker([lat, lng], { icon: missedIcon }).addTo(map)
    })

    return () => {
      if (mapRef.current) {
        resizeObserver.unobserve(mapRef.current)
      }
      if (mapInstance.current) {
        mapInstance.current.remove()
        mapInstance.current = null
      }
    }
  }, [missedStops])

  const kgCollected = calibrationData?.net_weight || calibrationData?.estimated_kg || '0.00'

  return (
    <>
      <Navbar />
      <style>{`
        @keyframes fadeInScale {
          0% { opacity: 0; transform: scale(0.95); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes slideUpCard {
          0% { opacity: 0; transform: translateY(20px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes popOut {
          0% { transform: scale(0); }
          80% { transform: scale(1.1); }
          100% { transform: scale(1); }
        }
      `}</style>

      <div style={{
        height: '100dvh', display: 'flex', flexDirection: 'column',
        background: 'linear-gradient(to bottom, #f0fdf4 0%, #f8fafc 100%)',
        fontFamily: 'var(--font-body)', overflowY: 'auto',
      }}>
        <div style={{ padding: '40px 20px 24px', textAlign: 'center', animation: 'fadeInScale 0.5s cubic-bezier(0.16, 1, 0.3, 1)' }}>
          <div style={{
            width: 80, height: 80, borderRadius: '50%', background: '#22c55e',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 20px', color: '#fff',
            boxShadow: '0 8px 30px rgba(34, 197, 94, 0.3)',
            animation: 'popOut 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.1s both'
          }}>
            <CheckIcon />
          </div>
          <h1 style={{
            fontFamily: 'var(--font-head)', fontSize: 28, fontWeight: 900,
            color: '#0f172a', marginBottom: 8, letterSpacing: '-0.02em'
          }}>
            Waste Dumped!
          </h1>
          <p style={{ color: '#64748b', fontSize: 15, margin: 0, fontWeight: 500 }}>
            Your Garbage Collection has been successfully logged.
          </p>
        </div>

        <div style={{ padding: '0 20px', flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>

          <div style={{
            background: 'rgba(255, 255, 255, 0.85)', backdropFilter: 'blur(12px)',
            borderRadius: 20, padding: '24px', border: '1px solid rgba(255,255,255,0.5)',
            boxShadow: '0 4px 24px rgba(0,0,0,0.04)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            animation: 'slideUpCard 0.5s ease-out 0.2s both'
          }}>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              <div style={{ width: 48, height: 48, borderRadius: 14, background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0f172a' }}>
                <WeightIcon />
              </div>
              <div>
                <div style={{ fontSize: 13, color: '#64748b', fontWeight: 600, marginBottom: 2 }}>Total Collected</div>
                <div style={{ fontFamily: 'var(--font-head)', fontSize: 24, fontWeight: 900, color: '#0f172a' }}>
                  {kgCollected} <span style={{ fontSize: 16, color: '#94a3b8', fontWeight: 700 }}>kg</span>
                </div>
              </div>
            </div>
          </div>

          {totalStops > 0 && (
            <div style={{
              background: 'rgba(255, 255, 255, 0.85)', backdropFilter: 'blur(12px)',
              borderRadius: 20, padding: '20px', border: '1px solid rgba(255,255,255,0.5)',
              boxShadow: '0 4px 24px rgba(0,0,0,0.04)',
              animation: 'slideUpCard 0.5s ease-out 0.3s both'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <div style={{ width: 32, height: 32, borderRadius: 10, background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#3b82f6' }}>
                  <RouteIcon />
                </div>
                <div style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 800, color: '#0f172a' }}>
                  Route Summary
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 14, color: '#64748b', fontWeight: 500 }}>Completed Stops</span>
                <span style={{ fontFamily: 'var(--font-head)', fontSize: 15, fontWeight: 800, color: '#0f172a' }}>{completedStops} / {totalStops}</span>
              </div>

              <div style={{ height: 8, background: '#f1f5f9', borderRadius: 4, overflow: 'hidden', marginBottom: 20 }}>
                <div style={{
                  height: '100%',
                  background: completedStops === totalStops ? '#22c55e' : '#3b82f6',
                  width: `${Math.min(100, Math.max(0, (completedStops / totalStops) * 100))}%`,
                  borderRadius: 4
                }} />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 14, color: '#64748b', fontWeight: 500 }}>Missed Stops</span>
                <span style={{ fontFamily: 'var(--font-head)', fontSize: 15, fontWeight: 800, color: '#ef4444' }}>{missedStops.length}</span>
              </div>
            </div>
          )}

          {missedStops.length > 0 && (
            <div style={{
              background: 'rgba(255, 255, 255, 0.85)', backdropFilter: 'blur(12px)',
              borderRadius: 20, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.5)',
              boxShadow: '0 4px 24px rgba(0,0,0,0.04)',
              animation: 'slideUpCard 0.5s ease-out 0.4s both'
            }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ef4444' }}>
                  <MapPinIcon />
                </div>
                <div style={{ fontFamily: 'var(--font-head)', fontSize: 15, fontWeight: 800, color: '#0f172a' }}>
                  Uncollected Areas
                </div>
              </div>
              <div ref={mapRef} style={{ width: '100%', height: 160, background: '#e2e8f0' }} />
            </div>
          )}

        </div>

        <div style={{ padding: '24px 20px', background: 'transparent' }}>
          <button
            onClick={onContinue}
            style={{
              width: '100%', padding: '18px', borderRadius: 16,
              background: '#0f172a', color: '#fff', border: 'none',
              fontFamily: 'var(--font-head)', fontSize: 16, fontWeight: 900,
              cursor: 'pointer', boxShadow: '0 8px 25px rgba(15,23,42,0.2)',
              letterSpacing: '0.02em', transition: 'transform 0.1s'
            }}
          >
            Continue to Base
          </button>
        </div>
      </div>
    </>
  )
}
