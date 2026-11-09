/**
 * pages/admin/HotspotDetection.jsx
 * ----------------------------------
 * Map-based hotspot detection showing areas with repeated reports.
 * Uses Leaflet CDN (same pattern as MapView) + circle overlays
 * sized/colored by report count to simulate a heatmap.
 */

import { useEffect, useRef, useState, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Layers,
  MapPin,
  Clock,
  Truck,
  AlertTriangle,
  AlertOctagon,
  Flame,
  CheckCircle2,
  X,
  Navigation,
  Flag,
  ArrowLeft,
  Search,
  Filter,
  Activity,
  FileText,
  Map as MapIcon,
  User,
  Trash2,
  Check
} from 'lucide-react'
import { useLeaflet } from '../../hooks/useLeaflet'
import DashboardLayout from '../../components/DashboardLayout'
import InterventionDrawer from '../../components/InterventionDrawer'
import { useHotspots } from '../../hooks/useHotspots'
import { useInterventions } from '../../hooks/useInterventions'
import AdminReports from './AdminReports'
import ReportDetail from './ReportDetail'
import api from '../../api/client'
import { resolveImageUrl } from '../../utils/imageHelpers'
import { useNotification } from '../../context/NotificationContext'
import { StatCardSkeleton, FeedCardSkeleton, MapSkeleton, SidebarWidgetSkeleton } from '../../components/ui/Skeleton'

const LUCENA_CENTER = [13.9373, 121.617]

const STATUS_META = {
  critical: { label: 'Critical', color: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
  high: { label: 'High', color: '#d97706', bg: '#fffbeb', border: '#fde68a' },
  medium: { label: 'Medium', color: '#ca8a04', bg: '#fefce8', border: '#fef08a' },
  low: { label: 'Low', color: '#15803d', bg: '#f0fdf4', border: '#bbf7d0' },
}

const TYPE_ICON = {
  'Overflow': <Trash2 size={13} />,
  'Illegal Dumping': <AlertOctagon size={13} />,
  'Missed Pickup': <Clock size={13} />,
  'Road Blockage': <AlertTriangle size={13} />,
  'Littering': <Flame size={13} />,
}

// circle radius and fill color by count
function hotspotStyle(count) {
  if (count >= 12) return { radius: 80, fill: '#dc2626', opacity: 0.55 }
  if (count >= 8) return { radius: 60, fill: '#d97706', opacity: 0.50 }
  if (count >= 5) return { radius: 44, fill: '#ca8a04', opacity: 0.45 }
  return { radius: 30, fill: '#16a34a', opacity: 0.40 }
}

function StatusBadge({ s }) {
  const m = STATUS_META[s] || STATUS_META.low
  return (
    <span style={{
      background: m.bg,
      border: `1px solid ${m.border}`,
      color: m.color,
      borderRadius: 4,
      padding: '2px 7px',
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: '0.04em',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: m.color }} />
      {m.label.toUpperCase()}
    </span>
  )
}

export default function HotspotDetection() {
  const mapRef = useRef(null)
  const mapInst = useRef(null)
  const circlesRef = useRef([])
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { notify } = useNotification()

  const { items: hotspots, loading, refresh: refreshHotspots } = useHotspots()
  const { mapReady, mapError } = useLeaflet()

  // Track active interventions count for Action Progress badge
  const dispatches = useInterventions('dispatch')
  const flags = useInterventions('flag')
  const activeActionCount = (dispatches.items?.length || 0) + (flags.items?.length || 0)

  const [selected, setSelected] = useState(null)
  const [filter, setFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [distributionFilter, setDistributionFilter] = useState('all')
  const [showReports, setShowReports] = useState(false)

  const [routeModal, setRouteModal] = useState(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [trucks, setTrucks] = useState([])
  const [selectedTruckId, setSelectedTruckId] = useState('')
  const [drillDownReports, setDrillDownReports] = useState([])
  const [drillDownLoading, setDrillDownLoading] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [lightboxImg, setLightboxImg] = useState(null)
  const [selectedReportId, setSelectedReportId] = useState(null)
  const [isUpdatingSeverity, setIsUpdatingSeverity] = useState(false)

  // Anti-spam states and action locks
  const [isFlagging, setIsFlagging] = useState(false)
  const [isAddingRoute, setIsAddingRoute] = useState(false)
  const [addedToRouteIds, setAddedToRouteIds] = useState(() => new Set())
  const [confirmDeleteHotspot, setConfirmDeleteHotspot] = useState(null)
  const [isDeletingHotspot, setIsDeletingHotspot] = useState(false)

  // Derived intervention details for the selected hotspot
  const activeFlag = useMemo(() => {
    if (!selected) return null
    return flags.items?.find(f => f.hotspot === selected.id) || selected.flag_info || null
  }, [selected, flags.items])

  const activeDispatch = useMemo(() => {
    if (!selected) return null
    return dispatches.items?.find(d => d.hotspot === selected.id) || (selected.assigned_truck_id ? {
      truck_plate: selected.assigned_truck_plate,
      status: selected.dispatch_acknowledged ? 'acknowledged' : 'created',
      created_at: selected.dispatched_at,
      created_by_name: 'Admin'
    } : null)
  }, [selected, dispatches.items])

  const isFlagged = Boolean(activeFlag || selected?.is_flagged)
  const isDispatched = Boolean(activeDispatch || selected?.assigned_truck_id)
  const isAddedToRoute = Boolean(selected && addedToRouteIds.has(selected.id))

  const handleFlagToBrgy = async () => {
    if (!selected || isFlagging || isFlagged) return
    setIsFlagging(true)
    try {
      const res = await api.post(`/api/watcher/hotspots/${selected.id}/flag-to-brgy/`)
      const newIntervention = res.data?.intervention || {
        hotspot: selected.id,
        created_by_name: 'Admin',
        created_at: new Date().toISOString(),
        status: 'flagged'
      }
      setSelected(prev => prev ? { ...prev, is_flagged: true, flag_info: newIntervention } : prev)
      flags.refresh()
      notify({ variant: 'success', message: 'Successfully flagged to Barangay Officials!' })
    } catch (err) {
      console.error('[HotspotDetection] flag-to-brgy failed', err)
      notify({ variant: 'error-dark', message: 'Failed to flag to Barangay.' })
    } finally {
      setIsFlagging(false)
    }
  }

  const handleAddToRoute = () => {
    if (!selected || isAddingRoute) return
    setIsAddingRoute(true)
    setAddedToRouteIds(prev => new Set(prev).add(selected.id))
    notify({ variant: 'success', message: 'Adding hotspot to collection route planner...' })
    const lat = parseFloat(selected.latitude)
    const lng = parseFloat(selected.longitude)
    setTimeout(() => {
      navigate('/admin/routes', {
        state: {
          suggestedWaypoint: {
            lat: !isNaN(lat) ? lat : selected.latitude,
            lng: !isNaN(lng) ? lng : selected.longitude,
            label: `${selected.type} — Brgy. ${selected.barangay_name}`,
            hotspot_id: selected.id,
            barangay_id: selected.barangay_id
          }
        }
      })
      setIsAddingRoute(false)
    }, 350)
  }

  const handleDeleteHotspot = async () => {
    if (!confirmDeleteHotspot || isDeletingHotspot) return
    setIsDeletingHotspot(true)
    try {
      await api.delete(`/api/watcher/hotspots/${confirmDeleteHotspot.id}/`)
      notify({ variant: 'success', message: `Hotspot in Brgy. ${confirmDeleteHotspot.barangay_name} removed successfully.` })
      if (selected?.id === confirmDeleteHotspot.id) {
        setSelected(null)
      }
      setConfirmDeleteHotspot(null)
      refreshHotspots()
      flags.refresh()
      dispatches.refresh()
    } catch (err) {
      console.error('[HotspotDetection] delete hotspot failed', err)
      notify({ variant: 'error-dark', message: 'Failed to delete hotspot. Please try again.' })
    } finally {
      setIsDeletingHotspot(false)
    }
  }

  function flyToCoords(hotspotId, lat, lng) {
    if (!mapInst.current) return
    mapInst.current.flyTo([lat, lng], 16, { duration: 1 })
    const match = hotspots.find(h => h.id === hotspotId)
    if (match) setSelected(match)
    else console.warn('hotspot anchor id not found in current items', hotspotId)
    setDrawerOpen(false)
  }

  // Load active trucks for the assign modal when opened
  useEffect(() => {
    if (!routeModal) return
    api.get(`/api/watcher/hotspots/${routeModal.id}/recommend-trucks/`)
      .then(res => setTrucks(res.data || []))
      .catch(() => setTrucks([]))
  }, [routeModal])

  // Load drill-down reports when a hotspot is selected
  useEffect(() => {
    if (!selected) {
      setDrillDownReports([])
      return
    }
    setDrillDownLoading(true)
    api.get(`/api/watcher/hotspots/${selected.id}/reports/`)
      .then(res => setDrillDownReports(res.data || []))
      .catch(console.error)
      .finally(() => setDrillDownLoading(false))
  }, [selected])

  const refreshDrillDownReports = () => {
    if (!selected) return
    setDrillDownLoading(true)
    api.get(`/api/watcher/hotspots/${selected.id}/reports/`)
      .then(res => setDrillDownReports(res.data || []))
      .catch(console.error)
      .finally(() => setDrillDownLoading(false))
  }

  const handleUpdateHotspotSeverity = async (hotspotId, newSeverity) => {
    if (isUpdatingSeverity || selected?.status === newSeverity) return
    setIsUpdatingSeverity(true)
    try {
      await api.patch(`/api/watcher/hotspots/${hotspotId}/`, { severity: newSeverity })
      setSelected(prev => prev ? { ...prev, status: newSeverity, severity: newSeverity } : prev)
      refreshHotspots()
      notify(`Hotspot severity updated to ${newSeverity.toUpperCase()}`)
    } catch (err) {
      notify('Failed to update hotspot severity', 'error')
    } finally {
      setIsUpdatingSeverity(false)
    }
  }

  // Init map
  useEffect(() => {
    if (!mapReady || !mapRef.current || showReports) return

    // Prevent double init if component remounts
    if (mapInst.current) {
      mapInst.current.remove()
      mapInst.current = null
    }

    const L = window.L
    const map = L.map(mapRef.current, { center: LUCENA_CENTER, zoom: 14, zoomControl: false })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors', maxZoom: 19,
    }).addTo(map)
    L.control.zoom({ position: 'topright' }).addTo(map)
    mapInst.current = map

    return () => {
      if (mapInst.current) {
        mapInst.current.remove()
        mapInst.current = null
      }
    }
  }, [mapReady, showReports])

  const focusHandledRef = useRef(false)
  useEffect(() => {
    if (searchParams.get('lat') && searchParams.get('lng')) setShowReports(false)
    const focusId = searchParams.get('focus')
    if (!focusId || focusHandledRef.current || loading || !mapReady || !mapInst.current) return
    focusHandledRef.current = true
    const match = hotspots.find(h => String(h.id) === focusId)
    const next = new URLSearchParams(searchParams)
    next.delete('focus')
    setSearchParams(next, { replace: true })
    if (!match || match.latitude == null || match.longitude == null) {
      notify({ variant: 'error-dark', message: 'Hotspot no longer exists.' })
      return
    }
    setShowReports(false)
    flyToCoords(match.id, Number(match.latitude), Number(match.longitude))
  }, [searchParams, hotspots, loading, mapReady])

  useEffect(() => {
    if (mapInst.current && searchParams.get('lat') && searchParams.get('lng')) {
      const lat = parseFloat(searchParams.get('lat'))
      const lng = parseFloat(searchParams.get('lng'))
      if (!isNaN(lat) && !isNaN(lng)) {
        mapInst.current.flyTo([lat, lng], 18, { duration: 1 })

        // Draw a pinpoint marker for the exact report location
        const L = window.L
        const icon = L.divIcon({
          html: `<div style="color: #dc2626; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3)); display: flex;"><svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg></div>`,
          className: '', iconSize: [24, 24], iconAnchor: [12, 24]
        })
        const marker = L.marker([lat, lng], { icon }).addTo(mapInst.current)

        if (hotspots.length > 0 && !selected) {
          let closest = null
          let minSq = Infinity
          hotspots.forEach(h => {
            const dSq = Math.pow(h.latitude - lat, 2) + Math.pow(h.longitude - lng, 2)
            if (dSq < minSq) { minSq = dSq; closest = h }
          })
          if (closest && minSq < 0.0000002) {
            setSelected(closest)
          }
        }

        return () => {
          if (mapInst.current) mapInst.current.removeLayer(marker)
        }
      }
    }
  }, [searchParams, mapReady, hotspots, showReports])

  useEffect(() => {
    if (mapInst.current && hotspots.length > 0) {
      drawHotspots(mapInst.current)
    }
  }, [hotspots, mapReady, showReports])

  function drawHotspots(map) {
    const L = window.L
    circlesRef.current.forEach(c => { try { map.removeLayer(c) } catch { } })
    circlesRef.current = []

    hotspots.forEach(h => {
      const st = hotspotStyle(h.count)

      const outer = L.circle([h.latitude, h.longitude], {
        radius: st.radius,
        color: st.fill, weight: 0,
        fillColor: st.fill, fillOpacity: st.opacity * 0.35,
        interactive: false,
      }).addTo(map)

      const inner = L.circle([h.latitude, h.longitude], {
        radius: st.radius * 0.5,
        color: st.fill, weight: 1.5,
        fillColor: st.fill, fillOpacity: st.opacity,
      }).addTo(map)

      const icon = L.divIcon({
        html: `<div style="
          background:${st.fill};color:#fff;font-size:11px;font-weight:700;
          width:22px;height:22px;border-radius:50%;border:2px solid white;
          display:flex;align-items:center;justify-content:center;
          box-shadow:0 1px 4px rgba(0,0,0,.3);">${h.count}</div>`,
        className: '', iconSize: [22, 22], iconAnchor: [11, 11],
      })
      const marker = L.marker([h.latitude, h.longitude], { icon }).addTo(map)

      marker.on('click', () => setSelected(h))
      inner.on('click', () => setSelected(h))

      circlesRef.current.push(outer, inner, marker)
    })
  }

  function flyTo(h) {
    if (!mapInst.current) return
    mapInst.current.flyTo([h.latitude, h.longitude], 16, { duration: 1 })
    setSelected(h)
  }

  const allTypes = useMemo(() => [...new Set(hotspots.map(h => h.type).filter(Boolean))], [hotspots])

  const filtered = useMemo(() => hotspots.filter(h => {
    const ms = filter === 'all' || h.status === filter
    const mt = typeFilter === 'all' || h.type === typeFilter
    const md = distributionFilter === 'all' ? true : (distributionFilter === 'clustered' ? h.count > 1 : h.count <= 1)
    return ms && mt && md
  }).sort((a, b) => b.count - a.count), [hotspots, filter, typeFilter, distributionFilter])

  const counts = useMemo(() => ({
    critical: hotspots.filter(h => h.status === 'critical').length,
    high: hotspots.filter(h => h.status === 'high').length,
    medium: hotspots.filter(h => h.status === 'medium').length,
    low: hotspots.filter(h => h.status === 'low').length,
  }), [hotspots])

  const maxCount = useMemo(() => Math.max(...hotspots.map(h => h.count), 1), [hotspots])

  return (
    <DashboardLayout>
      <style>{`
        .meta-page-canvas {
          background: #f0f2f5;
          min-height: calc(100vh - 60px);
          padding: 24px 32px 60px;
        }
        .meta-card {
          background: #ffffff;
          border: 1px solid #e4e6eb;
          border-radius: 8px;
          box-shadow: 0 1px 2px rgba(0,0,0,0.04);
        }
        .meta-stat-card {
          background: #ffffff;
          border: 1px solid #e4e6eb;
          border-radius: 8px;
          padding: 16px 20px;
          box-shadow: 0 1px 2px rgba(0,0,0,0.04);
        }
        .meta-input {
          height: 36px;
          border: 1px solid #ccd0d5;
          border-radius: 6px;
          font-size: 13px;
          background: #ffffff;
          color: #050505;
          outline: none;
          padding: 0 10px;
          font-family: inherit;
        }
        .meta-input:focus {
          border-color: #16a34a;
          box-shadow: 0 0 0 2px rgba(22, 163, 74, 0.15);
        }
        .meta-btn-secondary {
          height: 36px;
          background: #ffffff;
          border: 1px solid #ccd0d5;
          border-radius: 6px;
          font-size: 13px;
          font-weight: 600;
          color: #050505;
          padding: 0 14px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 7px;
          transition: background 0.15s ease;
        }
        .meta-btn-secondary:hover:not(:disabled) {
          background: #f0f2f5;
        }
        .meta-btn-primary {
          height: 36px;
          background: #16a34a;
          border: 1px solid #16a34a;
          border-radius: 6px;
          font-size: 13px;
          font-weight: 600;
          color: #ffffff;
          padding: 0 16px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 7px;
          transition: background 0.15s ease;
        }
        .meta-btn-primary:hover:not(:disabled) {
          background: #15803d;
        }
        .hs-row {
          transition: all 0.15s ease;
          cursor: pointer;
        }
        .hs-row:hover {
          background: #f9fafb !important;
        }
        @media (max-width: 1024px) {
          .hotspot-main-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>

      <div style={{
        height: 'calc(100vh - 60px)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: '#f0f2f5',
        fontFamily: 'var(--font-body, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif)'
      }}>

        {/* ── Top Slim Header Toolbar ── */}
        <div style={{
          height: 56,
          background: '#ffffff',
          borderBottom: '1px solid #e4e6eb',
          padding: '0 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
          zIndex: 10,
          gap: 16
        }}>
          {/* Left: Icon & Title & Status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <div style={{
              width: 32,
              height: 32,
              borderRadius: 6,
              background: '#e7f3ed',
              color: '#166534',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}>
              {showReports ? <FileText size={17} /> : <Flame size={17} />}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
              <h1 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: '#050505', whiteSpace: 'nowrap' }}>
                {showReports ? 'Waste Reports' : 'Hotspot Detection'}
              </h1>
              <span style={{
                background: '#e7f5eb', color: '#15803d', border: '1px solid #bbf7d0',
                fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4, letterSpacing: '.04em'
              }}>ADMIN</span>
              {!showReports && counts.critical > 0 && (
                <span style={{
                  background: '#fef2f2',
                  color: '#dc2626',
                  border: '1px solid #fecaca',
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '1px 7px',
                  borderRadius: 4,
                  letterSpacing: '0.04em',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4
                }}>
                  <AlertTriangle size={11} /> {counts.critical} CRITICAL
                </span>
              )}
            </div>
          </div>

          {/* Center: Inline Compact Metric Pills */}
          {!showReports && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'nowrap' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '4px 10px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 11
              }}>
                <span style={{ color: '#64748b', fontWeight: 600 }}>Total:</span>
                <strong style={{ color: '#0f172a' }}>{hotspots.length}</strong>
              </div>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '4px 10px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 11
              }}>
                <span style={{ color: '#dc2626', fontWeight: 600 }}>Critical:</span>
                <strong style={{ color: '#991b1b' }}>{counts.critical}</strong>
              </div>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '4px 10px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, fontSize: 11
              }}>
                <span style={{ color: '#d97706', fontWeight: 600 }}>High:</span>
                <strong style={{ color: '#92400e' }}>{counts.high}</strong>
              </div>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '4px 10px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 6, fontSize: 11
              }}>
                <span style={{ color: '#2563eb', fontWeight: 600 }}>Med/Low:</span>
                <strong style={{ color: '#1e40af' }}>{counts.medium + counts.low}</strong>
              </div>
            </div>
          )}

          {/* Right: Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {/* Validate Reports Button */}
            <button
              onClick={() => navigate('/admin/validate-reports')}
              className="meta-btn-secondary"
              style={{ height: 32, fontSize: 12, padding: '0 10px' }}
              title="Moderate reports, evaluate waste severity, and approve or reject"
            >
              <CheckCircle2 size={13} color="#16a34a" />
              <span>Validate Reports</span>
            </button>

            {/* Action Progress Button */}
            <button
              onClick={() => setDrawerOpen(true)}
              className="meta-btn-secondary"
              style={{ height: 32, fontSize: 12, padding: '0 10px' }}
            >
              <Activity size={13} color="#166534" />
              <span>Action Progress</span>
              {activeActionCount > 0 && (
                <span style={{
                  background: '#16a34a',
                  color: '#ffffff',
                  fontSize: 10,
                  fontWeight: 700,
                  borderRadius: 10,
                  padding: '1px 5px',
                  lineHeight: 1.2
                }}>
                  {activeActionCount}
                </span>
              )}
            </button>

            <InterventionDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} onFlyTo={flyToCoords} />

            {/* View Reports / Back to Map Toggle */}
            <button
              onClick={() => setShowReports(!showReports)}
              className={showReports ? 'meta-btn-secondary' : 'meta-btn-primary'}
              style={{ height: 32, fontSize: 12, padding: '0 12px' }}
            >
              {showReports ? (
                <><ArrowLeft size={13} /> Back to Map</>
              ) : (
                <><FileText size={13} /> View All Reports</>
              )}
            </button>
          </div>
        </div>

        {/* ── Main Workspace Body ── */}
        {showReports ? (
          <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
            <AdminReports />
          </div>
        ) : (
          <div style={{
            display: 'flex',
            flex: 1,
            minHeight: 0,
            overflow: 'hidden',
            position: 'relative'
          }}>

            {/* ── LEFT SIDEBAR: HOTSPOTS DIRECTORY & FILTERS (Width: 320px) ── */}
            <div style={{
              width: 320,
              minWidth: 320,
              maxWidth: 320,
              background: '#ffffff',
              borderRight: '1px solid #e4e6eb',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              zIndex: 2
            }}>
              {/* Directory Filter Controls Header */}
              <div style={{
                padding: '12px 14px',
                borderBottom: '1px solid #f0f2f5',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                background: '#fafbfc'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#050505', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                    Hotspots Directory
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#65676b', background: '#f0f2f5', padding: '1px 6px', borderRadius: 4 }}>
                    {filtered.length} of {hotspots.length}
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <select
                    className="meta-input"
                    value={filter}
                    onChange={e => setFilter(e.target.value)}
                    style={{ height: 30, fontSize: 11, padding: '0 6px', cursor: 'pointer' }}
                  >
                    <option value="all">All Priorities</option>
                    <option value="critical">Critical</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>

                  <select
                    className="meta-input"
                    value={distributionFilter}
                    onChange={e => setDistributionFilter(e.target.value)}
                    style={{ height: 30, fontSize: 11, padding: '0 6px', cursor: 'pointer' }}
                  >
                    <option value="all">All Densities</option>
                    <option value="clustered">Clustered (&gt; 1)</option>
                    <option value="isolated">Isolated (1)</option>
                  </select>
                </div>

                <select
                  className="meta-input"
                  value={typeFilter}
                  onChange={e => setTypeFilter(e.target.value)}
                  style={{ width: '100%', height: 30, fontSize: 11, padding: '0 6px', cursor: 'pointer' }}
                >
                  <option value="all">All Waste Types</option>
                  {allTypes.map(t => (
                    <option key={`type-${t}`} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              {/* Scrollable Hotspot Cards List */}
              <div style={{
                flex: 1,
                overflowY: 'auto',
                padding: '10px 12px',
                display: 'flex',
                flexDirection: 'column',
                gap: 8
              }}>
                {loading && hotspots.length === 0 ? (
                  <FeedCardSkeleton count={4} compact />
                ) : filtered.length === 0 ? (
                  <div style={{
                    padding: '32px 16px',
                    textAlign: 'center',
                    color: '#65676b'
                  }}>
                    <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#f0fdf4', color: '#16a34a', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 8px' }}>
                      <CheckCircle2 size={18} />
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 13, color: '#050505' }}>No matching hotspots</div>
                    <div style={{ fontSize: 11, marginTop: 4 }}>Adjust or clear the filter criteria above.</div>
                  </div>
                ) : (
                  filtered.map((h, i) => {
                    const m = STATUS_META[h.status] || STATUS_META.low
                    const st = hotspotStyle(h.count)
                    const isSelected = selected?.id === h.id

                    return (
                      <div
                        key={h.id}
                        className="meta-card hs-row"
                        onClick={() => flyTo(h)}
                        style={{
                          padding: '10px 12px',
                          border: isSelected ? '1.5px solid #16a34a' : '1px solid #e4e6eb',
                          background: isSelected ? '#f0fdf4' : '#ffffff',
                          cursor: 'pointer',
                          borderRadius: 6
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                          {/* Rank */}
                          <div style={{
                            width: 20,
                            height: 20,
                            borderRadius: 4,
                            background: isSelected ? '#dcfce7' : '#f0f2f5',
                            color: isSelected ? '#15803d' : '#050505',
                            fontSize: 10,
                            fontWeight: 700,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0
                          }}>
                            {i + 1}
                          </div>

                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2, flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 12, fontWeight: 700, color: '#050505', display: 'flex', alignItems: 'center', gap: 4 }}>
                                {TYPE_ICON[h.type] || <Flame size={12} />}
                                {h.type}
                              </span>
                              <StatusBadge s={h.status} />
                            </div>
                            <div style={{ fontSize: 10, color: '#65676b', display: 'flex', alignItems: 'center', gap: 4 }}>
                              <MapPin size={10} /> Brgy. {h.barangay_name} · {h.ago || 'recently'}
                            </div>
                          </div>

                          {/* Report count bubble */}
                          <div style={{ textAlign: 'center', flexShrink: 0, paddingLeft: 4 }}>
                            <div style={{ fontWeight: 700, fontSize: 16, color: st.fill, lineHeight: 1 }}>
                              {h.count}
                            </div>
                            <div style={{ fontSize: 8, color: '#65676b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                              reps
                            </div>
                          </div>
                        </div>

                        {/* Mini Intensity Bar */}
                        <div style={{ background: '#f0f2f5', borderRadius: 3, height: 3, overflow: 'hidden' }}>
                          <div style={{
                            width: `${Math.round((h.count / maxCount) * 100)}%`,
                            height: '100%',
                            background: st.fill,
                            borderRadius: 3,
                            transition: 'width .3s ease'
                          }} />
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>

            {/* ── CENTER EXPANSIVE CANVAS: LEAFLET MAP ── */}
            <div style={{
              flex: 1,
              height: '100%',
              position: 'relative',
              minWidth: 0,
              background: '#e4e6eb'
            }}>
              <div ref={mapRef} style={{ position: 'absolute', inset: 0, zIndex: 1 }} />

              {!mapReady && !mapError && (
                <div style={{ position: 'absolute', inset: 0, zIndex: 5 }}>
                  <MapSkeleton height="100%" dark label="Initializing Lucena Hotspot Map..." />
                </div>
              )}

              {mapError && (
                <div style={{ position: 'absolute', inset: 0, background: '#fef2f2', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 5, border: '1px solid #fecaca', padding: 20, textAlign: 'center' }}>
                  <AlertTriangle size={28} color="#dc2626" style={{ marginBottom: 8 }} />
                  <span style={{ color: '#991b1b', fontWeight: 700, fontSize: 14 }}>Failed to load map</span>
                  <span style={{ color: '#b91c1c', fontSize: 12, marginTop: 4 }}>Please verify your network connection and refresh.</span>
                </div>
              )}

              {/* Floating Critical Alert Banner */}
              {counts.critical > 0 && (
                <div style={{
                  position: 'absolute',
                  top: 14,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  zIndex: 400,
                  background: 'rgba(254, 242, 242, 0.96)',
                  backdropFilter: 'blur(6px)',
                  border: '1px solid #fecaca',
                  borderRadius: 8,
                  padding: '8px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                  maxWidth: '90%'
                }}>
                  <div style={{
                    width: 26,
                    height: 26,
                    borderRadius: 6,
                    background: '#fee2e2',
                    color: '#dc2626',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}>
                    <AlertOctagon size={16} />
                  </div>
                  <div style={{ fontSize: 12 }}>
                    <span style={{ fontWeight: 700, color: '#991b1b' }}>
                      {counts.critical} critical hotspot cluster(s) require truck dispatch.
                    </span>
                    <span style={{ color: '#7f1d1d', marginLeft: 6 }}>
                      ({hotspots.filter(h => h.status === 'critical').map(h => `Brgy. ${h.barangay_name}`).join(', ')})
                    </span>
                  </div>
                </div>
              )}

              {/* Clean Intensity Legend Overlay */}
              <div style={{
                position: 'absolute',
                bottom: 14,
                left: 14,
                zIndex: 400,
                background: 'rgba(255, 255, 255, 0.95)',
                backdropFilter: 'blur(4px)',
                borderRadius: 6,
                padding: '8px 12px',
                border: '1px solid #e4e6eb',
                boxShadow: '0 2px 8px rgba(0,0,0,0.08)'
              }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: '#65676b', letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 4 }}>
                  HOTSPOT INTENSITY
                </div>
                {[
                  { color: '#dc2626', label: 'Critical (12+ reports)' },
                  { color: '#d97706', label: 'High (8–11 reports)' },
                  { color: '#ca8a04', label: 'Medium (5–7 reports)' },
                  { color: '#16a34a', label: 'Low (2–4 reports)' },
                ].map(l => (
                  <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <div style={{ width: 7, height: 7, borderRadius: '50%', background: l.color }} />
                    <span style={{ color: '#050505', fontSize: 10, fontWeight: 500 }}>{l.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* ── RIGHT COMMAND & INSPECTOR PANEL (Width: 380px) ── */}
            <div style={{
              width: 380,
              minWidth: 380,
              maxWidth: 380,
              background: '#ffffff',
              borderLeft: '1px solid #e4e6eb',
              display: 'flex',
              flexDirection: 'column',
              overflowY: 'auto',
              padding: 16,
              gap: 12,
              zIndex: 2
            }}>
              {selected ? (
                /* ── DRILL-DOWN / SELECTED HOTSPOT COMMAND INSPECTOR ── */
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {/* Inspector Header */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingBottom: 10,
                    borderBottom: '1px solid #e4e6eb'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{
                        width: 30,
                        height: 30,
                        borderRadius: 6,
                        background: STATUS_META[selected.status]?.bg || '#f0f2f5',
                        color: STATUS_META[selected.status]?.color || '#050505',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0
                      }}>
                        {TYPE_ICON[selected.type] || <AlertTriangle size={15} />}
                      </div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#050505' }}>{selected.type || selected.name}</div>
                        <div style={{ fontSize: 11, color: '#65676b', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <MapPin size={11} /> Brgy. {selected.barangay_name}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <StatusBadge s={selected.status} />
                      <button
                        onClick={() => setSelected(null)}
                        style={{
                          background: '#f0f2f5',
                          border: 'none',
                          borderRadius: '50%',
                          width: 22,
                          height: 22,
                          color: '#65676b',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}
                        title="Close Inspector"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  </div>

                  {/* Hotspot Metadata Grid */}
                  <div style={{
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: 6,
                    padding: '8px 12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    fontSize: 11
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#64748b' }}>Report Frequency:</span>
                      <strong style={{ color: STATUS_META[selected.status]?.color }}>{selected.count} reports</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#64748b' }}>Detected:</span>
                      <span style={{ color: '#0f172a' }}>{selected.ago || 'Recently'}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#64748b' }}>Coordinates:</span>
                      <span style={{ color: '#64748b', fontFamily: 'monospace' }}>
                        {Number(selected.latitude).toFixed(4)}, {Number(selected.longitude).toFixed(4)}
                      </span>
                    </div>
                  </div>

                  {/* Waste Severity Selector */}
                  <div style={{
                    background: '#ffffff',
                    border: '1px solid #e2e8f0',
                    borderRadius: 8,
                    padding: '10px 12px'
                  }}>
                    <div style={{ fontSize: 10, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Flame size={12} color="#f59e0b" /> Waste Severity
                      </span>
                      <span style={{ fontSize: 10, color: STATUS_META[selected.status]?.color, fontWeight: 700 }}>
                        {STATUS_META[selected.status]?.label || selected.status}
                      </span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
                      {['low', 'medium', 'high', 'critical'].map(sev => {
                        const meta = STATUS_META[sev]
                        const isCurrent = selected.status === sev
                        return (
                          <button
                            key={sev}
                            type="button"
                            onClick={() => handleUpdateHotspotSeverity(selected.id, sev)}
                            disabled={isUpdatingSeverity}
                            style={{
                              padding: '5px 4px',
                              fontSize: 10,
                              fontWeight: 700,
                              borderRadius: 6,
                              border: `1px solid ${isCurrent ? meta.color : '#e2e8f0'}`,
                              background: isCurrent ? meta.bg : '#ffffff',
                              color: isCurrent ? meta.color : '#64748b',
                              cursor: isUpdatingSeverity ? 'wait' : 'pointer',
                              textAlign: 'center',
                              transition: 'all 0.15s ease'
                            }}
                          >
                            {meta.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* Flagged Status Card */}
                  {isFlagged && (
                    <div style={{
                      background: '#fffbeb',
                      border: '1px solid #fde68a',
                      borderRadius: 6,
                      padding: '8px 10px',
                      fontSize: 11,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontWeight: 700, color: '#b45309', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <Flag size={11} /> Flagged to Barangay
                        </span>
                        <span style={{
                          fontSize: 9,
                          fontWeight: 700,
                          padding: '1px 5px',
                          borderRadius: 4,
                          background: activeFlag?.status === 'acknowledged' ? '#f0fdf4' : '#fffbeb',
                          color: activeFlag?.status === 'acknowledged' ? '#15803d' : '#b45309',
                          border: `1px solid ${activeFlag?.status === 'acknowledged' ? '#bbf7d0' : '#fde68a'}`
                        }}>
                          {activeFlag?.status === 'acknowledged' ? 'Responded' : 'Awaiting'}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: '#65676b', display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <div>Flagged By: <strong style={{ color: '#050505' }}>{activeFlag?.created_by_name || 'Admin'}</strong></div>
                        <div>To Whom: <strong style={{ color: '#050505' }}>Brgy. {selected.barangay_name} Officials</strong></div>
                        <div>Time: <span style={{ color: '#050505' }}>{activeFlag?.created_at ? new Date(activeFlag.created_at).toLocaleString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) : 'Recently'}</span></div>
                        <div>Response: <strong style={{ color: activeFlag?.status === 'acknowledged' ? '#15803d' : '#b45309' }}>{activeFlag?.status === 'acknowledged' ? `Acknowledged by ${activeFlag.acknowledged_by_name || 'Official'}` : 'Not yet responded'}</strong></div>
                      </div>
                    </div>
                  )}

                  {/* Dispatched Status Card */}
                  {isDispatched && (
                    <div style={{
                      background: '#eff6ff',
                      border: '1px solid #bfdbfe',
                      borderRadius: 6,
                      padding: '8px 10px',
                      fontSize: 11,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontWeight: 700, color: '#1d4ed8', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <Truck size={11} /> Dispatched Work Order
                        </span>
                        <span style={{
                          fontSize: 9,
                          fontWeight: 700,
                          padding: '1px 5px',
                          borderRadius: 4,
                          background: (activeDispatch?.status === 'acknowledged' || selected.dispatch_acknowledged) ? '#f0fdf4' : '#eff6ff',
                          color: (activeDispatch?.status === 'acknowledged' || selected.dispatch_acknowledged) ? '#15803d' : '#1d4ed8',
                          border: `1px solid ${(activeDispatch?.status === 'acknowledged' || selected.dispatch_acknowledged) ? '#bbf7d0' : '#bfdbfe'}`
                        }}>
                          {(activeDispatch?.status === 'acknowledged' || selected.dispatch_acknowledged) ? 'En Route' : 'Pending'}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: '#65676b', display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <div>Assigned Truck: <strong style={{ color: '#1d4ed8' }}>Truck {activeDispatch?.truck_plate || selected.assigned_truck_plate || 'Assigned'}</strong></div>
                        <div>Dispatched By: <strong style={{ color: '#050505' }}>{activeDispatch?.created_by_name || 'Admin'}</strong></div>
                        <div>Status: <strong style={{ color: (activeDispatch?.status === 'acknowledged' || selected.dispatch_acknowledged) ? '#15803d' : '#1d4ed8' }}>{(activeDispatch?.status === 'acknowledged' || selected.dispatch_acknowledged) ? 'Acknowledged & on route' : 'Pending pickup'}</strong></div>
                      </div>
                    </div>
                  )}

                  {/* Command Actions Grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    <button
                      disabled={isDispatched}
                      onClick={() => {
                        if (isDispatched) return
                        setRouteModal(selected)
                        setSelectedTruckId(selected.assigned_truck_id ? String(selected.assigned_truck_id) : '')
                      }}
                      style={{
                        background: isDispatched ? '#f0f2f5' : '#eff6ff',
                        border: `1px solid ${isDispatched ? '#e4e6eb' : '#bfdbfe'}`,
                        color: isDispatched ? '#65676b' : '#1d4ed8',
                        borderRadius: 6,
                        padding: '7px 8px',
                        fontWeight: 600,
                        fontSize: 11,
                        cursor: isDispatched ? 'not-allowed' : 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 5
                      }}
                    >
                      {isDispatched ? <Check size={11} /> : <Truck size={11} />}
                      {isDispatched ? 'Dispatched' : 'Dispatch'}
                    </button>

                    <button
                      disabled={isFlagged || isFlagging}
                      onClick={handleFlagToBrgy}
                      style={{
                        background: isFlagged ? '#f0f2f5' : '#fffbeb',
                        border: `1px solid ${isFlagged ? '#e4e6eb' : '#fde68a'}`,
                        color: isFlagged ? '#65676b' : '#b45309',
                        borderRadius: 6,
                        padding: '7px 8px',
                        fontWeight: 600,
                        fontSize: 11,
                        cursor: (isFlagged || isFlagging) ? 'not-allowed' : 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 5
                      }}
                    >
                      {isFlagging ? <div className="spinner" style={{ width: 10, height: 10, borderWidth: 2 }} /> : isFlagged ? <Check size={11} /> : <Flag size={11} />}
                      {isFlagged ? 'Flagged' : 'Flag Brgy'}
                    </button>

                    <button
                      disabled={isAddedToRoute || isAddingRoute}
                      onClick={handleAddToRoute}
                      style={{
                        background: isAddedToRoute ? '#f0f2f5' : '#f0fdf4',
                        border: `1px solid ${isAddedToRoute ? '#e4e6eb' : '#bbf7d0'}`,
                        color: isAddedToRoute ? '#65676b' : '#15803d',
                        borderRadius: 6,
                        padding: '7px 8px',
                        fontWeight: 600,
                        fontSize: 11,
                        cursor: (isAddedToRoute || isAddingRoute) ? 'not-allowed' : 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 5
                      }}
                    >
                      {isAddedToRoute ? <Check size={11} /> : <Navigation size={11} />}
                      {isAddedToRoute ? 'Added' : 'Add to Route'}
                    </button>

                    <button
                      onClick={() => setConfirmDeleteHotspot(selected)}
                      style={{
                        background: '#ffffff',
                        border: '1px solid #fecaca',
                        color: '#dc2626',
                        borderRadius: 6,
                        padding: '7px 8px',
                        fontWeight: 600,
                        fontSize: 11,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 5
                      }}
                    >
                      <Trash2 size={11} /> Delete
                    </button>
                  </div>

                  {/* Drill-down Reports list */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                    <div style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: '#65676b',
                      textTransform: 'uppercase',
                      letterSpacing: '.04em',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between'
                    }}>
                      <span>Cluster Reports ({drillDownReports.length})</span>
                      <span style={{ fontSize: 10, color: '#16a34a' }}>Brgy. {selected.barangay_name}</span>
                    </div>

                    {drillDownLoading ? (
                      <SidebarWidgetSkeleton rows={3} />
                    ) : drillDownReports.length === 0 ? (
                      <div style={{ padding: '16px 12px', textAlign: 'center', color: '#65676b', fontSize: 11, background: '#f8fafc', borderRadius: 6 }}>
                        No individual reports found for this cluster.
                      </div>
                    ) : (
                      drillDownReports.map(r => (
                        <div
                          key={r.id}
                          className="meta-card"
                          style={{ padding: '10px 12px', borderRadius: 6, border: '1px solid #e4e6eb' }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                            <span style={{ fontSize: 12, fontWeight: 700, color: '#050505' }}>
                              {r.issue_type}
                            </span>
                            <span style={{ fontSize: 10, color: '#65676b', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                              <Clock size={10} />
                              {new Date(r.created_at).toLocaleDateString()}
                            </span>
                          </div>

                          <div style={{ fontSize: 11, color: '#65676b', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                            <User size={10} />
                            Reported by <strong style={{ color: '#050505' }}>{r.reported_by || 'Citizen'}</strong>
                          </div>

                          {r.description && (
                            <div style={{
                              fontSize: 11,
                              color: '#050505',
                              lineHeight: 1.4,
                              background: '#f9fafb',
                              padding: '6px 8px',
                              borderRadius: 4,
                              border: '1px solid #e4e6eb',
                              marginBottom: 6
                            }}>
                              {r.description}
                            </div>
                          )}

                          {r.images?.length > 0 && (
                            <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
                              {r.images.map((url, idx) => {
                                const resolved = resolveImageUrl(url)
                                if (!resolved) return null
                                return (
                                  <div
                                    key={idx}
                                    onClick={() => setLightboxImg(resolved)}
                                    style={{
                                      position: 'relative',
                                      width: 50,
                                      height: 50,
                                      borderRadius: 4,
                                      overflow: 'hidden',
                                      flexShrink: 0,
                                      cursor: 'pointer',
                                      border: '1px solid #e4e6eb',
                                      background: '#f0f2f5'
                                    }}
                                  >
                                    <img
                                      src={resolved}
                                      alt="Evidence"
                                      onError={(e) => {
                                        e.currentTarget.style.display = 'none'
                                        if (e.currentTarget.parentElement) {
                                          e.currentTarget.parentElement.style.display = 'none'
                                        }
                                      }}
                                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                    />
                                  </div>
                                )
                              })}
                            </div>
                          )}

                          <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            marginTop: 6,
                            paddingTop: 6,
                            borderTop: '1px solid #f1f5f9'
                          }}>
                            <span style={{
                              fontSize: 9,
                              fontWeight: 700,
                              padding: '1px 6px',
                              borderRadius: 4,
                              background: r.severity === 'high' ? '#fef2f2' : r.severity === 'medium' ? '#fffbeb' : '#f0fdf4',
                              color: r.severity === 'high' ? '#dc2626' : r.severity === 'medium' ? '#d97706' : '#15803d',
                              border: `1px solid ${r.severity === 'high' ? '#fecaca' : r.severity === 'medium' ? '#fde68a' : '#bbf7d0'}`
                            }}>
                              SEVERITY: {(r.severity || 'medium').toUpperCase()}
                            </span>
                            <button
                              type="button"
                              onClick={() => setSelectedReportId(r.id)}
                              style={{
                                background: '#eff6ff',
                                border: '1px solid #bfdbfe',
                                color: '#1d4ed8',
                                fontSize: 10,
                                fontWeight: 700,
                                borderRadius: 4,
                                padding: '3px 7px',
                                cursor: 'pointer'
                              }}
                            >
                              Review &rsaquo;
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ) : (
                /* ── EMPTY STATE COMMAND INSPECTOR ── */
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                  textAlign: 'center',
                  padding: '24px 16px',
                  color: '#65676b'
                }}>
                  <div style={{
                    width: 48,
                    height: 48,
                    borderRadius: '50%',
                    background: '#f0fdf4',
                    color: '#16a34a',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: 12
                  }}>
                    <MapPin size={22} />
                  </div>
                  <h3 style={{ fontSize: 15, fontWeight: 700, color: '#050505', margin: '0 0 6px' }}>
                    Select a Hotspot Cluster
                  </h3>
                  <p style={{ fontSize: 12, lineHeight: 1.5, margin: '0 0 20px', maxWidth: 280 }}>
                    Click any hotspot cluster on the map or select from the directory on the left to inspect reports, adjust severity, flag to barangay officials, or dispatch collection trucks.
                  </p>

                  {/* Summary Card */}
                  <div style={{
                    width: '100%',
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: 8,
                    padding: '12px 14px',
                    textAlign: 'left',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    fontSize: 11
                  }}>
                    <div style={{ fontWeight: 700, color: '#0f172a', textTransform: 'uppercase', letterSpacing: '.04em', fontSize: 10 }}>
                      Municipal Overview
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#64748b' }}>Active Clusters:</span>
                      <strong style={{ color: '#0f172a' }}>{hotspots.length} detected</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#64748b' }}>Urgent Hotspots:</span>
                      <strong style={{ color: '#dc2626' }}>{counts.critical} critical</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#64748b' }}>Active Interventions:</span>
                      <strong style={{ color: '#16a34a' }}>{activeActionCount} ongoing</strong>
                    </div>
                  </div>
                </div>
              )}
            </div>

          </div>
        )}

      </div>

      {/* ── Assign Truck Modal ── */}
      {routeModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(3px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
        }}>
          <div className="meta-card" style={{
            padding: 24,
            width: '100%',
            maxWidth: 440,
            boxShadow: '0 12px 36px rgba(0,0,0,0.18)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <div style={{ width: 34, height: 34, borderRadius: 6, background: '#eff6ff', color: '#1d4ed8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Truck size={18} />
              </div>
              <h3 style={{ margin: 0, fontSize: 16, color: '#050505', fontWeight: 700 }}>
                {routeModal.count > 1 ? 'Assign Truck for Route Waypoint' : 'Assign Truck for Direct Collection'}
              </h3>
            </div>

            <p style={{ fontSize: 13, color: '#65676b', marginBottom: 16, lineHeight: 1.5 }}>
              Brgy. {routeModal.barangay_name} · <strong>{routeModal.count} report{routeModal.count > 1 ? 's' : ''}</strong>
              {routeModal.count > 1
                ? ' — this hotspot cluster will be added as a mandatory collection waypoint in the selected truck\'s scheduled route.'
                : ' — the selected truck will be dispatched for direct isolated collection.'}
            </p>

            <label style={{ fontSize: 11, fontWeight: 700, color: '#65676b', letterSpacing: '0.04em', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
              Select Vehicle
            </label>

            {trucks.length === 0 ? (
              <p style={{ fontSize: 12, color: '#65676b', marginBottom: 18 }}>No active trucks found in jurisdiction.</p>
            ) : (
              <select
                value={selectedTruckId}
                onChange={e => setSelectedTruckId(e.target.value)}
                className="meta-input"
                style={{ width: '100%', marginBottom: 20, cursor: 'pointer' }}
              >
                <option value=''>— Choose an active truck —</option>
                {trucks.map(t => (
                  <option key={t.id} value={String(t.id)}>
                    {t.plate_number} · {t.model}{t.zone ? ` · ${t.zone}` : ''}
                  </option>
                ))}
              </select>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                disabled={isGenerating}
                onClick={() => { setRouteModal(null); setSelectedTruckId('') }}
                className="meta-btn-secondary"
              >
                Cancel
              </button>

              <button
                disabled={isGenerating || !selectedTruckId}
                onClick={async () => {
                  setIsGenerating(true)
                  try {
                    const res = await api.post(`/api/watcher/hotspots/${routeModal.id}/assign-truck/`, { truck_id: Number(selectedTruckId) })
                    setSelected(prev => prev ? { ...prev, assigned_truck_id: res.data.assigned_truck_id, assigned_truck_plate: res.data.assigned_truck_plate } : prev)
                    refreshHotspots()
                    dispatches.refresh()
                    notify({ variant: 'success', message: 'Truck successfully assigned to hotspot.' })
                  } catch (err) {
                    console.error('[HotspotDetection] assign-truck failed', err)
                    notify({ variant: 'error-dark', message: 'Failed to assign truck.' })
                  } finally {
                    setIsGenerating(false)
                    setRouteModal(null)
                    setSelectedTruckId('')
                  }
                }}
                className="meta-btn-primary"
                style={{ opacity: (isGenerating || !selectedTruckId) ? 0.6 : 1, cursor: (isGenerating || !selectedTruckId) ? 'not-allowed' : 'pointer' }}
              >
                {isGenerating ? <div className='spinner' style={{ width: 13, height: 13, borderWidth: 2 }} /> : <Truck size={14} />}
                {isGenerating ? 'Assigning...' : 'Confirm Assignment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirm Delete Hotspot Modal ── */}
      {confirmDeleteHotspot && (
        <div
          onClick={() => { if (!isDeletingHotspot) setConfirmDeleteHotspot(null) }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10000,
            background: 'rgba(0,0,0,0.45)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="meta-card"
            style={{
              padding: 24,
              width: '100%',
              maxWidth: 420,
              boxShadow: '0 12px 36px rgba(0,0,0,0.18)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <div style={{
                width: 36,
                height: 36,
                borderRadius: 6,
                background: '#fef2f2',
                color: '#dc2626',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}>
                <AlertOctagon size={20} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#050505' }}>
                  Confirm Delete Hotspot
                </h3>
                <span style={{ fontSize: 11, color: '#dc2626', fontWeight: 600 }}>
                  Permanent Action
                </span>
              </div>
            </div>

            <p style={{ fontSize: 13, color: '#65676b', lineHeight: 1.5, marginBottom: 20 }}>
              Are you sure you want to permanently delete or dismiss the hotspot <strong>{confirmDeleteHotspot.type || confirmDeleteHotspot.name}</strong> in <strong>Brgy. {confirmDeleteHotspot.barangay_name}</strong>?
              <br /><br />
              This will remove the detected hotspot point from the map and cancel any associated active interventions.
            </p>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                disabled={isDeletingHotspot}
                onClick={() => setConfirmDeleteHotspot(null)}
                className="meta-btn-secondary"
              >
                Cancel
              </button>
              <button
                disabled={isDeletingHotspot}
                onClick={handleDeleteHotspot}
                style={{
                  background: '#dc2626',
                  border: '1px solid #dc2626',
                  color: '#ffffff',
                  padding: '0 16px',
                  height: 36,
                  borderRadius: 6,
                  cursor: isDeletingHotspot ? 'not-allowed' : 'pointer',
                  fontWeight: 600,
                  fontSize: 13,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 7,
                  opacity: isDeletingHotspot ? 0.75 : 1
                }}
              >
                {isDeletingHotspot ? <div className='spinner' style={{ width: 13, height: 13, borderWidth: 2 }} /> : <Trash2 size={14} />}
                {isDeletingHotspot ? 'Deleting...' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Photo Lightbox Modal ── */}
      {lightboxImg && (
        <div
          onClick={() => setLightboxImg(null)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10000,
            background: 'rgba(0,0,0,0.85)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20
          }}
        >
          <div style={{ position: 'relative', maxWidth: 800, width: '100%', maxHeight: '90vh' }} onClick={e => e.stopPropagation()}>
            <button
              onClick={() => setLightboxImg(null)}
              style={{
                position: 'absolute',
                top: -36,
                right: 0,
                background: 'none',
                border: 'none',
                color: '#ffffff',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 13,
                fontWeight: 600
              }}
            >
              <X size={18} /> Close
            </button>
            <img
              src={resolveImageUrl(lightboxImg)}
              alt="Evidence Full View"
              onError={(e) => {
                e.currentTarget.style.display = 'none'
                const parent = e.currentTarget.parentElement
                if (parent) {
                  const fallback = document.createElement('div')
                  fallback.style.padding = '40px 24px'
                  fallback.style.background = '#1e293b'
                  fallback.style.color = '#f87171'
                  fallback.style.borderRadius = '8px'
                  fallback.style.fontSize = '14px'
                  fallback.style.fontWeight = '600'
                  fallback.style.textAlign = 'center'
                  fallback.innerText = 'Photo evidence unavailable or removed from storage.'
                  parent.appendChild(fallback)
                }
              }}
              style={{
                width: '100%',
                maxHeight: '85vh',
                objectFit: 'contain',
                borderRadius: 8,
                boxShadow: '0 12px 40px rgba(0,0,0,0.5)'
              }}
            />
          </div>
        </div>
      )}

      {/* ── Report Detail Overlay Modal ── */}
      {selectedReportId && (
        <ReportDetail
          reportId={selectedReportId}
          onClose={() => setSelectedReportId(null)}
          onUpdated={() => {
            refreshDrillDownReports()
            refreshHotspots()
          }}
        />
      )}

    </DashboardLayout>
  )
}
