/**
 * components/ReportLocationPicker.jsx
 * -----------------------------------
 * Compact Leaflet map preview with Lucena City Barangay GeoJSON
 * geofence polygons (matching MapView.jsx).
 *
 * By default (`allowMove = false`), the report marker is strictly locked
 * to the reporter's GPS coordinates (non-draggable and non-clickable) while
 * visually highlighting the geofenced Barangay polygon the coordinates fall in.
 */

import { useEffect, useRef, useState } from 'react'
import { useLeaflet } from '../hooks/useLeaflet'
import { loadBarangayGeoJson } from '../utils/barangayGeofence'

const LUCENA_CENTER = [13.9373, 121.617]

const PIN_HTML = `
  <div style="
    width:28px;height:28px;border-radius:50% 50% 50% 0;
    background:#16a34a;border:2.5px solid #ffffff;
    transform:rotate(-45deg);
    display:flex;align-items:center;justify-content:center;
    box-shadow:0 3px 10px rgba(0,0,0,0.35);
  ">
    <div style="width:8px;height:8px;border-radius:50%;background:#ffffff;transform:rotate(45deg);"></div>
  </div>
`

export default function ReportLocationPicker({
  lat,
  lng,
  barangayName,
  allowMove = false,
  onSelectCoords,
}) {
  const { mapReady } = useLeaflet()
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markerRef = useRef(null)
  const geoLayerRef = useRef(null)
  const onSelectRef = useRef(onSelectCoords)
  onSelectRef.current = onSelectCoords

  const [geoJson, setGeoJson] = useState(null)

  useEffect(() => {
    let active = true
    loadBarangayGeoJson().then((data) => {
      if (active && data) setGeoJson(data)
    })
    return () => {
      active = false
    }
  }, [])

  // Initialize Leaflet map
  useEffect(() => {
    if (!mapReady || !window.L || !containerRef.current || mapRef.current) return
    const L = window.L
    const initialCenter =
      lat != null && lng != null && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))
        ? [Number(lat), Number(lng)]
        : LUCENA_CENTER

    const map = L.map(containerRef.current, {
      center: initialCenter,
      zoom: lat != null && lng != null ? 15 : 13,
      zoomControl: true,
      attributionControl: false,
    })

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
    }).addTo(map)

    if (allowMove) {
      map.on('click', (e) => {
        const { lat: cLat, lng: cLng } = e.latlng
        if (onSelectRef.current) onSelectRef.current(cLat, cLng)
      })
    }

    mapRef.current = map
    setTimeout(() => {
      try {
        map.invalidateSize()
      } catch {}
    }, 80)

    return () => {
      try {
        map.remove()
      } catch {}
      mapRef.current = null
      markerRef.current = null
      geoLayerRef.current = null
    }
  }, [mapReady, allowMove]) // eslint-disable-line react-hooks/exhaustive-deps

  // Render / update Barangay GeoJSON geofence polygons
  useEffect(() => {
    const map = mapRef.current
    if (!map || !window.L || !geoJson) return
    const L = window.L

    if (geoLayerRef.current) {
      try {
        map.removeLayer(geoLayerRef.current)
      } catch {}
    }

    const layer = L.geoJSON(geoJson, {
      interactive: Boolean(allowMove),
      style: (feature) => {
        const fName = feature?.properties?.brgy_name
        const isMatched = Boolean(barangayName && fName === barangayName)
        return {
          color: isMatched ? '#15803d' : '#64748b',
          weight: isMatched ? 2.5 : 1,
          opacity: isMatched ? 0.95 : 0.45,
          fillColor: isMatched ? '#22c55e' : '#94a3b8',
          fillOpacity: isMatched ? 0.22 : 0.04,
          dashArray: isMatched ? '' : '4,4',
        }
      },
      onEachFeature: allowMove
        ? (feature, fLayer) => {
            fLayer.on('click', (e) => {
              L.DomEvent.stopPropagation(e)
              const { lat: cLat, lng: cLng } = e.latlng
              if (onSelectRef.current) onSelectRef.current(cLat, cLng)
            })
          }
        : undefined,
    }).addTo(map)

    geoLayerRef.current = layer
  }, [geoJson, barangayName, mapReady, allowMove])

  // Render locked pin marker when lat/lng changes
  useEffect(() => {
    const map = mapRef.current
    if (!map || !window.L) return
    const L = window.L

    const hasCoords =
      lat != null && lng != null && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))
    if (!hasCoords) {
      if (markerRef.current) {
        try {
          map.removeLayer(markerRef.current)
        } catch {}
        markerRef.current = null
      }
      return
    }

    const pos = [Number(lat), Number(lng)]
    if (!markerRef.current) {
      const icon = L.divIcon({
        html: PIN_HTML,
        className: '',
        iconSize: [28, 28],
        iconAnchor: [14, 28],
      })
      const marker = L.marker(pos, {
        icon,
        draggable: Boolean(allowMove),
        interactive: Boolean(allowMove),
        keyboard: Boolean(allowMove),
      }).addTo(map)

      if (allowMove) {
        marker.on('dragend', () => {
          const p = marker.getLatLng()
          if (onSelectRef.current) onSelectRef.current(p.lat, p.lng)
        })
      }
      markerRef.current = marker
    } else {
      markerRef.current.setLatLng(pos)
    }

    map.panTo(pos, { animate: true })
  }, [lat, lng, mapReady, allowMove])

  return (
    <div
      style={{
        marginTop: 8,
        borderRadius: 10,
        overflow: 'hidden',
        border: '1px solid #cbd5e1',
        background: '#f1f5f9',
      }}
    >
      <div ref={containerRef} style={{ width: '100%', height: 185 }} />
      <div
        style={{
          padding: '6px 10px',
          fontSize: 11,
          color: '#475569',
          background: '#f8fafc',
          borderTop: '1px solid #e2e8f0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span>
          {allowMove
            ? 'Tap map or drag pin to set exact report coordinates'
            : 'GPS-locked report location · Barangay boundary preview'}
        </span>
        {lat != null && lng != null && (
          <span style={{ fontFamily: 'monospace', fontWeight: 600, color: '#0f172a' }}>
            {Number(lat).toFixed(5)}, {Number(lng).toFixed(5)}
          </span>
        )}
      </div>
    </div>
  )
}
