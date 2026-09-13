import { useEffect, useRef } from 'react'
import { isCompletedStopStatus, normalizeStopStatus } from '../../../utils/pickupStatusSync'

export default function RouteCompletionMiniMap({ schedule, stopStatuses }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)

  useEffect(() => {
    if (!window.L || !containerRef.current || !schedule?.waypoints) return
    const L = window.L
    const wps = schedule.waypoints
    const pts = wps.map(wp => [Number(wp.lat), Number(wp.lng)])

    const map = L.map(containerRef.current, {
      zoomControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      touchZoom: false,
      keyboard: false,
      attributionControl: false,
    })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map)
    mapRef.current = map

    // Route polyline
    const line = L.polyline(pts, { color: '#94a3b8', weight: 3, opacity: 0.6, dashArray: '6 4' }).addTo(map)
    map.fitBounds(line.getBounds(), { padding: [24, 24] })

    // Depot marker
    L.marker([pts[0][0], pts[0][1]], {
      icon: L.divIcon({ html: '<div style="font-size:18px">🏠</div>', className: '', iconAnchor: [9, 9] })
    }).addTo(map)

    // Stop markers — show ALL stops, colour by status
    wps.slice(1).forEach((wp, i) => {
      const idx = i + 1
      const status = normalizeStopStatus(stopStatuses?.get(idx) ?? 'PENDING_INSPECTION')
      const isCollected = isCompletedStopStatus(status)
      const isMissed = status === 'DRIVER_MISSED'
      const isPending = status === 'PENDING_INSPECTION' || status === 'READY_FOR_COLLECTION'

      // Colour legend:
      //   green  = collected / confirmed
      //   orange = disputed
      //   red    = explicitly DRIVER_MISSED
      //   grey dashed = never reached (PENDING / READY)
      let bg, border, label, shadow
      if (isCollected) {
        bg = '#16a34a'; border = '#fff'; label = '✓'; shadow = 'rgba(22,163,74,0.4)'
      } else if (isMissed) {
        bg = '#ef4444'; border = '#fff'; label = '×'; shadow = 'rgba(239,68,68,0.4)'
      } else if (isPending) {
        bg = 'transparent'; border = '#94a3b8'; label = String(idx); shadow = 'none'
      } else {
        bg = '#f59e0b'; border = '#fff'; label = '!'; shadow = 'rgba(245,158,11,0.4)'
      }

      const html = `<div style="
        width:20px;height:20px;border-radius:50%;
        background:${bg};color:${isPending ? '#64748b' : '#fff'};
        display:flex;align-items:center;justify-content:center;
        font-size:9px;font-weight:900;
        border:${isPending ? '2px dashed #94a3b8' : `2px solid ${border}`};
        box-shadow:0 2px 6px ${shadow};
      ">${label}</div>`

      const statusLabel = isCollected ? 'Collected' : isMissed ? 'Missed — available for pickup' : 'Not yet reached'
      const popupContent = `<div style="font-family:sans-serif;min-width:130px;">
        <b style="font-size:11px;">${wp.label || `Stop ${idx}`}</b><br/>
        <span style="font-size:10px;color:${isCollected ? '#16a34a' : isMissed ? '#ef4444' : '#94a3b8'};font-weight:700;">${statusLabel}</span>
      </div>`

      L.marker([Number(wp.lat), Number(wp.lng)], {
        icon: L.divIcon({ html, className: '', iconSize: [20, 20], iconAnchor: [10, 10] })
      }).addTo(map).bindPopup(popupContent)
    })

    return () => { map.remove(); mapRef.current = null }
  }, [schedule?.id, stopStatuses])

  return (
    <div style={{ pointerEvents: 'none', borderRadius: 12, overflow: 'hidden', height: 180, border: '1px solid #e2e8f0', marginBottom: 16 }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  )
}
