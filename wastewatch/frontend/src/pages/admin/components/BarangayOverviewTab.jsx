import React, { useEffect, useRef } from 'react'
import { ClipboardList, Flame, AlertTriangle, Users } from 'lucide-react'

export default function BarangayOverviewTab({ detail, barangayId }) {
  const mapContainerRef = useRef(null)

  useEffect(() => {
    if (!window.L || !mapContainerRef.current || !detail) return

    const L = window.L
    const map = L.map(mapContainerRef.current, {
      zoomControl: true,
      scrollWheelZoom: true,
      attributionControl: false,
    })

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map)

    // Boundary polygon fetching
    let geojson = detail.boundary_geojson
    if (typeof geojson === 'string') {
      try { geojson = JSON.parse(geojson) } catch (e) { geojson = null }
    }

    const drawBoundary = (geoFeature) => {
      const normalized = geoFeature.type === 'FeatureCollection' || geoFeature.type === 'Feature'
        ? geoFeature
        : { type: 'Feature', geometry: geoFeature, properties: {} }
      const poly = L.geoJSON(normalized, {
        style: { color: '#2563EB', weight: 2.5, fillColor: '#3B82F6', fillOpacity: 0.15 }
      }).addTo(map)
      map.fitBounds(poly.getBounds(), { padding: [24, 24] })
    }

    if (geojson) {
      drawBoundary(geojson)
    } else if (detail.name) {
      // Fallback: fetch from static file and match by name
      fetch('/data/lucena_barangays.geojson')
        .then(res => res.json())
        .then(data => {
          if (!mapContainerRef.current) return; // Unmounted
          const feature = data.features?.find(f => 
            f.properties?.brgy_name?.toLowerCase() === detail.name.toLowerCase() ||
            f.properties?.name?.toLowerCase() === detail.name.toLowerCase()
          )
          if (feature) {
            drawBoundary(feature)
          } else {
            // Ultimate fallback if no match
            if (detail.latitude && detail.longitude) {
              map.setView([Number(detail.latitude), Number(detail.longitude)], 15)
            } else {
              map.setView([13.93, 121.61], 13) // Default Lucena
            }
          }
        })
        .catch(() => {
          map.setView([13.93, 121.61], 13)
        })
    }

    // Hotspot pins — color by severity if available, else default red
    detail.hotspots?.forEach(h => {
      const color = h.severity === 'high' ? '#DC2626' : h.severity === 'medium' ? '#D97706' : '#F59E0B'
      L.circleMarker([Number(h.lat || h.latitude), Number(h.lng || h.longitude)], {
        radius: 8, fillColor: color, color: '#fff', weight: 2, fillOpacity: 0.9
      }).bindPopup(`<b>${h.name || 'Hotspot'}</b><br/>${h.description || ''}`)
        .addTo(map)
    })

    return () => { map.remove() }
  }, [barangayId, detail])

  const statCards = [
    { 
      label: 'Pending Concerns', 
      value: Array.isArray(detail.pending_concerns) 
        ? detail.pending_concerns.length 
        : (detail.pending_concern_count ?? 0), 
      warn: (Array.isArray(detail.pending_concerns) ? detail.pending_concerns.length : detail.pending_concern_count) > 5, 
      icon: <ClipboardList size={24} />,
      bg: '#F8FAFC', color: '#475569', warnBg: '#FEF2F2', warnColor: '#DC2626'
    },
    { 
      label: 'Active Hotspots', 
      value: Array.isArray(detail.hotspots) 
        ? detail.hotspots.filter(h => h.is_active !== false).length 
        : (detail.active_hotspot_count ?? 0),
      warn: (Array.isArray(detail.hotspots) ? detail.hotspots.length : detail.active_hotspot_count) > 3, 
      icon: <Flame size={24} />,
      bg: '#FEF2F2', color: '#DC2626', warnBg: '#FEF2F2', warnColor: '#DC2626'
    },
    { 
      label: 'Open Escalations', 
      value: Array.isArray(detail.escalations) 
        ? detail.escalations.filter(e => !e.resolved).length 
        : (detail.open_escalation_count ?? 0),
      warn: (Array.isArray(detail.escalations) ? detail.escalations.length : detail.open_escalation_count) > 0, 
      icon: <AlertTriangle size={24} />,
      bg: '#FFFBEB', color: '#D97706', warnBg: '#FFFBEB', warnColor: '#D97706'
    },
    { 
      label: 'Personnel', 
      value: (detail.officials?.length || 0) + (detail.watchers?.length || 0) + (detail.drivers?.length || 0), 
      warn: detail.has_unassigned_roles, 
      icon: <Users size={24} />,
      bg: '#EFF6FF', color: '#3B82F6', warnBg: '#FEF2F2', warnColor: '#DC2626'
    },
  ]

  return (
    <div>
      <div style={{ position: 'relative', borderRadius: 16, overflow: 'hidden', border: '1px solid #E2E8F0', marginBottom: 20, boxShadow: '0 4px 20px rgba(0,0,0,0.03)' }}>
        <style>{`.leaflet-control-container { z-index: 1 !important; }`}</style>
        <div ref={mapContainerRef} style={{ height: 280, width: '100%', zIndex: 0 }} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
        {statCards.map(stat => {
          const isZero = stat.value === 0;
          let appliedBg = stat.warn ? stat.warnBg : stat.bg;
          let appliedColor = stat.warn ? stat.warnColor : stat.color;
          
          if (isZero && stat.label !== 'Personnel' && stat.label !== 'Pending Concerns') {
            appliedBg = '#F0FDF4'; // Green success state for 0 hotspots/escalations
            appliedColor = '#10B981';
          }
          
          return (
            <div key={stat.label} style={{
              background: '#fff', padding: 20, borderRadius: 16,
              border: `1px solid ${stat.warn ? stat.warnColor : 'rgba(0,0,0,0.06)'}`,
              display: 'flex', alignItems: 'center', gap: 16,
              boxShadow: '0 4px 20px rgba(0,0,0,0.02)'
            }}>
              <div style={{ width: 48, height: 48, borderRadius: 12, background: appliedBg, color: appliedColor, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {stat.icon}
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                  {stat.label}
                </div>
                <div style={{ fontSize: 24, fontWeight: 800, color: '#0F172A', marginTop: 2 }}>
                  {stat.value}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
