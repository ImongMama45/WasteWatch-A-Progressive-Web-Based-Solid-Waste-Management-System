/**
 * pages/dashboard/PublicDashboard.jsx
 * ------------------------------------
 * Changes from previous version:
 *  1. CachedMapSnapshot removed from standalone section → used as hero background
 *  2. Schedule section + Report Queue merged into one combo section
 *  3. "View Schedule" opens an in-page popup with barangay selector (auto-sync)
 *  4. "View Calendar" opens a popup around OfflineEventCalendar
 *  5. "Add Report" popup unchanged in mechanism, but OfflineReportBuilder now
 *     requires a mandatory photo (handled in that component)
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

import Navbar from '../../components/Navbar'
import BottomNav from '../../components/BottomNav'
import OfflineBanner from '../../components/OfflineBanner'
import OfflineReportBuilder from '../../components/OfflineReportBuilder'
import OfflineReportQueue from '../../components/OfflineReportQueue'
import OfflineEventCalendar from '../../components/OfflineEventCalendar'
import {
  GARBAGE_REPORTS as MAPVIEW_GARBAGE_REPORTS,
  LUCENA_CENTER as MAPVIEW_LUCENA_CENTER,
  TRUCK_ROUTES as MAPVIEW_TRUCK_ROUTES,
  ZONE_META as MAPVIEW_ZONE_META,
  getZoneType as getMapViewZoneType,
} from '../MapView'

import { useAuth } from '../../context/AuthContext'
import { useOnline } from '../../hooks/useOnline'
import { useOfflineReports } from '../../hooks/useOfflineReports'
import { useOfflineAnnouncements } from '../../hooks/useOfflineAnnouncements'
import { useOfflineSyncManager } from '../../hooks/useOfflineSyncManager'
import { usePublicStats } from '../../hooks/usePublicStats'
import { usePublicSchedule } from '../../hooks/usePublicSchedule'

import '../../styles/pages/Publicdashboardlanding.css'
import '../../styles/pages/OfflineModules.css'
import '../../styles/pages/OfflineModules2.css'

// ─── Constants ────────────────────────────────────────────────────────────────

const HERO_SLIDES = [
  {
    eyebrow: 'Lucena City · CENRO',
    title: (<>Cleaner Lucena,{' '}<em>One Report at a Time</em></>),
    sub: "I-report ang basura sa inyong barangay, alamin ang schedule ng kolektor, at makiisa sa mas malinis na Lucena City.",
  },
  {
    eyebrow: 'Citizen Portal',
    title: (<>Mag-report ng Problema. <em>Madali Lang.</em></>),
    sub: "I-capture ang inyong lokasyon kahit offline, mag-submit anumang oras — i-sync pagbalik ng signal.",
  },
  {
    eyebrow: 'Collection Schedules',
    title: (<>Alamin Kung Kailan <em>Darating ang Truck</em></>),
    sub: "Huwag palampasin ang koleksyon. Tingnan ang schedule ng inyong barangay anumang oras.",
  },
]

const LUCENA_BARANGAYS = [
  'Bocohan','Cotta','Dalahican','Domoit','Gulang-Gulang',
  'Ibabang Dupay','Ibabang Iyam','Ibabang Talim','Ilayang Dupay','Ilayang Iyam',
  'Isabang','Labor','Maranggal','Market View','Mayao Castillo',
  'Mayao Kanluran','Mayao Parada','Mayao Silangan','Novaliches','Palale',
  'Ransohan','Salinas','San Antonio','San Fernando','San Isidro',
  'San Jose','San Lucas','San Pablo','San Pedro','Santa Lucia',
  'Santo Niño','Talao-Talao','Tayabas Drive',
]

// ─── Map coordinate utilities (shared with OfflineGISLite) ───────────────────
const MAP_BOUNDS = { latMin: 13.900, latMax: 13.975, lngMin: 121.575, lngMax: 121.655 }
const MAP_W = 200, MAP_H = 200

function mapToXY(lat, lng) {
  const x = ((lng - MAP_BOUNDS.lngMin) / (MAP_BOUNDS.lngMax - MAP_BOUNDS.lngMin)) * MAP_W
  const y = ((MAP_BOUNDS.latMax - lat) / (MAP_BOUNDS.latMax - MAP_BOUNDS.latMin)) * MAP_H
  return [parseFloat(x.toFixed(2)), parseFloat(y.toFixed(2))]
}

function mapPts(coords) {
  return coords.map(([lat, lng]) => mapToXY(lat, lng).join(',')).join(' ')
}

// Simplified Lucena City barangay polygons for background map
const HERO_BARANGAYS = [
  { id: 'ibabang_dupay', poly: [[13.944,121.604],[13.950,121.606],[13.952,121.618],[13.948,121.624],[13.942,121.621],[13.940,121.610]] },
  { id: 'gulang_gulang', poly: [[13.950,121.600],[13.958,121.602],[13.962,121.614],[13.956,121.618],[13.950,121.614],[13.948,121.606]] },
  { id: 'cotta',         poly: [[13.930,121.604],[13.938,121.606],[13.940,121.614],[13.935,121.618],[13.928,121.615],[13.926,121.607]] },
  { id: 'isabang',       poly: [[13.924,121.596],[13.932,121.598],[13.934,121.608],[13.928,121.612],[13.921,121.608],[13.920,121.600]] },
  { id: 'dalahican',     poly: [[13.912,121.610],[13.920,121.612],[13.922,121.622],[13.916,121.628],[13.908,121.622],[13.907,121.614]] },
  { id: 'ilayang_dupay', poly: [[13.935,121.618],[13.942,121.620],[13.945,121.632],[13.938,121.636],[13.932,121.630],[13.930,121.622]] },
  { id: 'bocohan',       poly: [[13.920,121.622],[13.928,121.625],[13.930,121.635],[13.923,121.638],[13.916,121.632],[13.915,121.624]] },
  { id: 'domoit',        poly: [[13.926,121.586],[13.934,121.590],[13.935,121.598],[13.928,121.600],[13.922,121.596],[13.921,121.588]] },
  { id: 'ibabang_iyam',  poly: [[13.938,121.586],[13.946,121.590],[13.948,121.600],[13.942,121.604],[13.934,121.598],[13.932,121.590]] },
  { id: 'ransohan',      poly: [[13.956,121.590],[13.964,121.593],[13.967,121.604],[13.960,121.607],[13.953,121.602],[13.951,121.594]] },
  { id: 'ilayang_iyam',  poly: [[13.948,121.594],[13.956,121.596],[13.958,121.606],[13.952,121.610],[13.944,121.606],[13.942,121.597]] },
  { id: 'labor',         poly: [[13.960,121.610],[13.966,121.613],[13.968,121.624],[13.962,121.627],[13.956,121.622],[13.954,121.614]] },
  { id: 'san_jose',      poly: [[13.968,121.596],[13.975,121.600],[13.975,121.610],[13.969,121.614],[13.963,121.608],[13.962,121.599]] },
]

const SEV_CLR = { high: '#ff3b30', medium: '#ff9f0a', low: '#34c759', critical: '#bf5af2' }
const HERO_MAP_GEO_CACHE = 'ww_hero_map_geojson'
const HERO_MAP_SYNC_CACHE = 'ww_hero_map_sync'

const LUCENA_CENTER = [13.9373, 121.6170]

const ZONE_TYPE_MAP = {
  'Barangay 1 (Pob.)': 'commercial',
  'Barangay 2 (Pob.)': 'commercial',
  'Barangay 3 (Pob.)': 'commercial',
  'Barangay 4 (Pob.)': 'commercial',
  'Barangay 5 (Pob.)': 'commercial',
  'Barangay 6 (Pob.)': 'commercial',
  'Barangay 7 (Pob.)': 'commercial',
  'Barangay 8 (Pob.)': 'commercial',
  'Barangay 9 (Pob.)': 'commercial',
  'Barangay 10 (Pob.)': 'commercial',
  'Barangay 11 (Pob.)': 'commercial',
  'Gulang-Gulang': 'industrial',
  Cotta: 'industrial',
  'Mayao Crossing': 'agricultural',
  'Mayao Kanluran': 'agricultural',
  'Mayao Parada': 'agricultural',
  'Mayao Silangan': 'agricultural',
  'Ilayang Dupay': 'agricultural',
}

const ZONE_META = {
  residential: { color: '#4ade80' },
  commercial: { color: '#fb923c' },
  industrial: { color: '#94a3b8' },
  agricultural: { color: '#a3e635' },
}

function getZoneType(brgyName) {
  return ZONE_TYPE_MAP[brgyName] ?? 'residential'
}

function HeroOfflineMapSnapshot({ hotspots, isOnline }) {
  const reports = [...MAPVIEW_GARBAGE_REPORTS, ...hotspots]

  return (
    <svg
      viewBox={`-5 -5 ${MAP_W + 10} ${MAP_H + 10}`}
      className={`ld-hero__offline-map${isOnline ? '' : ' ld-hero__offline-map--visible'}`}
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="xMidYMid slice"
    >
      {[0.25, 0.5, 0.75].map((f, i) => (
        <g key={i}>
          <line x1={MAP_W * f} y1={0} x2={MAP_W * f} y2={MAP_H} stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
          <line x1={0} y1={MAP_H * f} x2={MAP_W} y2={MAP_H * f} stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
        </g>
      ))}

      {HERO_BARANGAYS.map(b => (
        <polygon
          key={b.id}
          points={mapPts(b.poly)}
          fill="rgba(129,199,132,0.08)"
          stroke="rgba(165,214,167,0.26)"
          strokeWidth="0.7"
        />
      ))}

      {MAPVIEW_TRUCK_ROUTES.map(route => (
        <g key={route.id}>
          <polyline
            points={route.waypoints.map(([lat, lng]) => mapToXY(lat, lng).join(',')).join(' ')}
            fill="none"
            stroke={route.color}
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.5"
          />
          {(() => {
            const [x, y] = mapToXY(...route.waypoints[route.completedUpTo])
            return <circle cx={x} cy={y} r="3.7" fill={route.color} stroke="rgba(255,255,255,0.76)" strokeWidth="0.8" />
          })()}
        </g>
      ))}

      {reports.map(report => {
        const [x, y] = mapToXY(report.lat, report.lng)
        return (
          <circle
            key={report.id}
            cx={x}
            cy={y}
            r={isOnline ? 2.8 : 2.2}
            fill={SEV_CLR[report.severity] || SEV_CLR.medium}
            stroke="rgba(255,255,255,0.55)"
            strokeWidth="0.55"
            opacity={isOnline ? '0.72' : '0.45'}
          />
        )
      })}
    </svg>
  )
}

// ─── Hero Map Layer Component ─────────────────────────────────────────────────
function HeroMapLayer({ isOnline }) {
  const mapRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const layerGroupRef = useRef(null)
  const [hotspots, setHotspots] = useState([])
  const [leafletReady, setLeafletReady] = useState(() => isOnline && Boolean(window.L))
  const [barangayGeo, setBarangayGeo] = useState(() => {
    try { return JSON.parse(localStorage.getItem(HERO_MAP_GEO_CACHE) || 'null') }
    catch { return null }
  })

  useEffect(() => {
    try {
      const rep = JSON.parse(localStorage.getItem('ww_offline_reports') || '[]')
      setHotspots(
        rep.filter(r => r.location?.lat && r.location?.lng)
           .map(r => ({ lat: r.location.lat, lng: r.location.lng, severity: r.severity || 'medium', id: r.id }))
      )
    } catch { /* silent */ }
  }, [])

  useEffect(() => {
    if (!isOnline) {
      setLeafletReady(false)
      return
    }

    if (window.L) {
      setLeafletReady(true)
      return
    }

    const existingScript = document.querySelector('script[data-ww-leaflet="true"]')
    if (existingScript) {
      existingScript.addEventListener('load', () => setLeafletReady(true), { once: true })
      return
    }

    if (!document.querySelector('link[data-ww-leaflet="true"]')) {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
      link.dataset.wwLeaflet = 'true'
      document.head.appendChild(link)
    }

    const script = document.createElement('script')
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
    script.dataset.wwLeaflet = 'true'
    script.onload = () => setLeafletReady(true)
    document.head.appendChild(script)
  }, [isOnline])

  useEffect(() => {
    if (!isOnline) return

    fetch('/data/lucena_barangays.geojson')
      .then(r => r.json())
      .then(data => {
        setBarangayGeo(data)
        try { localStorage.setItem(HERO_MAP_GEO_CACHE, JSON.stringify(data)) } catch { /* silent */ }
      })
      .catch(() => setBarangayGeo(null))
  }, [isOnline])

  useEffect(() => {
    if (!isOnline) return

    try {
      localStorage.setItem(HERO_MAP_SYNC_CACHE, JSON.stringify({
        syncedAt: new Date().toISOString(),
        routes: MAPVIEW_TRUCK_ROUTES.map(route => ({
          id: route.id,
          truckId: route.truckId,
          status: route.status,
          completedUpTo: route.completedUpTo,
          color: route.color,
        })),
        reports: MAPVIEW_GARBAGE_REPORTS.map(report => ({
          id: report.id,
          severity: report.severity,
          lat: report.lat,
          lng: report.lng,
        })),
      }))
    } catch { /* silent */ }
  }, [isOnline])

  useEffect(() => {
    if (!isOnline || !leafletReady || !mapRef.current || mapInstanceRef.current) return

    const L = window.L
    const map = L.map(mapRef.current, {
      center: MAPVIEW_LUCENA_CENTER,
      zoom: 13.45,
      zoomSnap: 0.25,
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      touchZoom: false,
      tap: false,
    })

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      crossOrigin: true,
    }).addTo(map)

    mapInstanceRef.current = map
    layerGroupRef.current = L.layerGroup().addTo(map)

    const resizeTimer = window.setTimeout(() => map.invalidateSize(), 120)
    return () => {
      window.clearTimeout(resizeTimer)
      map.remove()
      mapInstanceRef.current = null
      layerGroupRef.current = null
    }
  }, [isOnline, leafletReady])

  useEffect(() => {
    const map = mapInstanceRef.current
    const layerGroup = layerGroupRef.current
    if (!map || !layerGroup || !window.L) return

    const L = window.L
    layerGroup.clearLayers()

    if (barangayGeo) {
      L.geoJSON(barangayGeo, {
        interactive: false,
        style: (feature) => {
          const type = getMapViewZoneType(feature.properties.brgy_name)
          const color = MAPVIEW_ZONE_META[type].color
          return {
            color,
            weight: 1.25,
            opacity: 0.65,
            fillColor: color,
            fillOpacity: 0.14,
            dashArray: '5,4',
          }
        },
      }).addTo(layerGroup)
    }

    MAPVIEW_TRUCK_ROUTES.forEach(route => {
      const donePts = route.waypoints.slice(0, route.completedUpTo + 1)
      const remainingPts = route.waypoints.slice(route.completedUpTo)

      L.polyline(donePts, {
        interactive: false,
        color: route.color,
        weight: 5,
        opacity: 0.9,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(layerGroup)

      L.polyline(remainingPts, {
        interactive: false,
        color: route.color,
        weight: 4,
        opacity: 0.42,
        dashArray: '10,8',
      }).addTo(layerGroup)

      route.waypoints.forEach((coord, index) => {
        const isDone = index <= route.completedUpTo
        L.circleMarker(coord, {
          interactive: false,
          radius: isDone ? 5.5 : 4,
          fillColor: isDone ? route.color : '#1e293b',
          color: route.color,
          weight: 2,
          opacity: 0.95,
          fillOpacity: isDone ? 0.95 : 0.58,
        }).addTo(layerGroup)
      })

      L.circleMarker(route.waypoints[route.completedUpTo], {
        interactive: false,
        radius: 10,
        fillColor: route.color,
        color: '#ffffff',
        weight: 2.5,
        opacity: 0.95,
        fillOpacity: 0.95,
      }).addTo(layerGroup)
    })

    ;[...MAPVIEW_GARBAGE_REPORTS, ...hotspots].forEach(report => {
      const color = SEV_CLR[report.severity] || SEV_CLR.medium
      L.circleMarker([report.lat, report.lng], {
        interactive: false,
        radius: isOnline ? 8 : 6,
        fillColor: color,
        color: '#ffffff',
        weight: 2,
        opacity: 0.85,
        fillOpacity: isOnline ? 0.78 : 0.48,
      }).addTo(layerGroup)
    })

    L.circleMarker([13.9370, 121.6155], {
      interactive: false,
      radius: 9,
      fillColor: '#3b82f6',
      color: '#ffffff',
      weight: 2.5,
      opacity: 0.9,
      fillOpacity: 0.85,
    }).addTo(layerGroup)
  }, [barangayGeo, hotspots, isOnline])

  return (
    <div className="ld-hero__map-layer" aria-hidden="true">
      <HeroOfflineMapSnapshot hotspots={hotspots} isOnline={isOnline} />
      <div ref={mapRef} className={`ld-hero__leaflet${isOnline && leafletReady ? ' ld-hero__leaflet--ready' : ''}`} />
      {!isOnline && <div className="ld-hero__cache-note">Cached route snapshot</div>}
      {isOnline && !leafletReady && <div className="ld-hero__map-fallback" />}
    </div>
  )
}

// ─── Inline SVG Icons ─────────────────────────────────────────────────────────
const IconMap = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
    <path d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
)
const IconTruck = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
    <path d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1" />
  </svg>
)
const IconPhone = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
    <line x1="12" y1="18" x2="12.01" y2="18" />
  </svg>
)
const IconCalendar = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" /><path d="M9 16l2 2 4-4" />
  </svg>
)
const IconCheck = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
)
const IconX = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)
const IconFlag = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" y1="22" x2="4" y2="15" />
  </svg>
)

// ─── Component ────────────────────────────────────────────────────────────────

export default function PublicDashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const isOnline = useOnline()

  // ── Data hooks ───────────────────────────────────────────────────────────────
  const { announcements, isStale, isRefreshing } = useOfflineAnnouncements()
  const { stats } = usePublicStats()
  const { schedule } = usePublicSchedule()

  const {
    reports, addReport, retryReport,
    isSyncing: reportsSyncing, pendingCount, failedCount,
  } = useOfflineReports()

  const { syncNow, isSyncing, lastSyncAt } = useOfflineSyncManager()

  // ── UI state ─────────────────────────────────────────────────────────────────
  const [heroSlide, setHeroSlide] = useState(0)
  const [annSlide, setAnnSlide] = useState(0)
  const [showBuilder, setShowBuilder] = useState(false)

  // Popup state
  const [showSchedulePopup, setShowSchedulePopup] = useState(false)
  const [showCalendarPopup, setShowCalendarPopup] = useState(false)
  const [selectedBarangay, setSelectedBarangay] = useState('all')

  // Per-barangay schedule cache: { [barangayName]: scheduleItems[] }
  const [barangayScheduleCache, setBarangayScheduleCache] = useState(() => {
    try { return JSON.parse(localStorage.getItem('ww_brgy_schedules') || '{}') }
    catch { return {} }
  })

  // ── Auto-play ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setHeroSlide(p => (p + 1) % HERO_SLIDES.length), 4500)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (announcements.length <= 1) return
    const t = setInterval(() => setAnnSlide(p => (p + 1) % announcements.length), 5000)
    return () => clearInterval(t)
  }, [announcements.length])

  // ── Auto-sync selected barangay schedule when online ──────────────────────────
  useEffect(() => {
    if (!showSchedulePopup || selectedBarangay === 'all' || !isOnline) return

    // Already cached → use it, no fetch needed
    if (barangayScheduleCache[selectedBarangay]) return

    // Production: api.get(`/api/public/schedule/?zone=${encodeURIComponent(selectedBarangay)}`)
    // For now: filter from the already-loaded schedule and persist to cache
    const filtered = schedule.filter(s =>
      s.zone?.toLowerCase().includes(selectedBarangay.toLowerCase().split(' ')[0])
    )

    const updated = {
      ...barangayScheduleCache,
      [selectedBarangay]: filtered.length > 0 ? filtered : [],
    }
    setBarangayScheduleCache(updated)
    try { localStorage.setItem('ww_brgy_schedules', JSON.stringify(updated)) } catch { /* silent */ }
  }, [showSchedulePopup, selectedBarangay, isOnline, schedule]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Close popups on Escape ─────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') {
        setShowSchedulePopup(false)
        setShowCalendarPopup(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // ── Handlers ──────────────────────────────────────────────────────────────────
  const handleSyncNow = useCallback(() => syncNow(), [syncNow])
  const handleSubmitReport = useCallback(async (fields) => addReport(fields), [addReport])

  // ── Derived ───────────────────────────────────────────────────────────────────
  const nextCollection = schedule.find(s => s.isNext) || schedule[0]
  const currentAnn = announcements[annSlide] || announcements[0]
  const currentHero = HERO_SLIDES[heroSlide]

  // Schedule shown in popup
  const scheduleForSelected =
    selectedBarangay === 'all'
      ? schedule
      : (barangayScheduleCache[selectedBarangay] ??
         schedule.filter(s =>
           s.zone?.toLowerCase().includes(selectedBarangay.toLowerCase().split(' ')[0])
         ))

  // Whether the selected barangay's schedule is from live sync or cache
  const brgyIsLive = isOnline && selectedBarangay !== 'all'
  const brgyIsCached = !isOnline && selectedBarangay !== 'all' && (barangayScheduleCache[selectedBarangay]?.length ?? 0) > 0

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="ld-root">
      <OfflineBanner />
      <Navbar />

      {/* ════════ HERO — with live/cached map background ════════ */}
      <section className="ld-hero ld-hero--dark">
        {/* Non-interactive Leaflet map layer from the full MapView */}
        <HeroMapLayer isOnline={isOnline} />

        {/* Gradient overlay for text readability */}
        <div className="ld-hero__overlay" />

        {/* Offline indicator on map */}
        {!isOnline && (
          <div className="ld-hero__map-badge">
            <span className="ld-hero__map-badge-dot" />
            Cached Map
          </div>
        )}
        {isOnline && (
          <div className="ld-hero__map-badge ld-hero__map-badge--live">
            <span className="ld-hero__map-badge-dot" />
            Live Hotspots
          </div>
        )}

        <div className="ld-hero__inner" key={heroSlide}>
          <div className="ld-eyebrow ld-eyebrow--dark">
            <span className="ld-eyebrow__dot" />
            {currentHero.eyebrow}
          </div>

          <h1 className="ld-hero__heading ld-hero__heading--light">{currentHero.title}</h1>
          <p className="ld-hero__sub ld-hero__sub--light">{currentHero.sub}</p>

          <div className="ld-hero__actions">
            <button
              className="ld-btn ld-btn--hero-primary"
              onClick={() => setShowBuilder(true)}
            >
              <IconFlag /> Mag-report Ngayon
            </button>
            <button
              className="ld-btn ld-btn--hero-outline"
              onClick={() => setShowSchedulePopup(true)}
            >
              <IconCalendar /> Tingnan ang Schedule
            </button>
          </div>

          {/* Hero slide dots */}
          <div className="ld-hero__dots">
            {HERO_SLIDES.map((_, i) => (
              <button
                key={i}
                className={`ld-hero__dot${heroSlide === i ? ' ld-hero__dot--active' : ''}`}
                onClick={() => setHeroSlide(i)}
                aria-label={`Slide ${i + 1}`}
              />
            ))}
          </div>
        </div>

        {/* Floating stat chips */}
        <div className="ld-hero__chips">
          <div className="ld-chip ld-chip--dark">
            <span className="ld-chip__dot ld-chip__dot--green" />
            <div>
              <div className="ld-chip__value">33</div>
              <div className="ld-chip__label">Barangays</div>
            </div>
          </div>
          <div className="ld-chip ld-chip--dark">
            <span className="ld-chip__dot ld-chip__dot--amber" />
            <div>
              <div className="ld-chip__value">{stats.total_reports || 0}</div>
              <div className="ld-chip__label">Total Reports</div>
            </div>
          </div>
          <div className="ld-chip ld-chip--dark">
            <span className="ld-chip__dot ld-chip__dot--blue" />
            <div>
              <div className="ld-chip__value">PWA</div>
              <div className="ld-chip__label">Works Offline</div>
            </div>
          </div>
        </div>

        {/* Pending sync pill */}
        {pendingCount > 0 && (
          <div className="ld-hero__sync-pill">
            ⏳ {pendingCount} report{pendingCount > 1 ? 's' : ''} pending sync
          </div>
        )}
      </section>

      {/* ════════ STATS BAR ════════ */}
      <div className="ld-stats-wrap">
        <div className="ld-stats">
          <div className="ld-stat">
            <div className="ld-stat__value">33</div>
            <div className="ld-stat__label">Barangays Covered</div>
          </div>
          <div className="ld-stat">
            <div className="ld-stat__value">{stats.active_trucks || 0}</div>
            <div className="ld-stat__label">Active Trucks</div>
          </div>
          <div className="ld-stat">
            <div className="ld-stat__value">{stats.hotspots || 0}</div>
            <div className="ld-stat__label">Hotspots Detected</div>
          </div>
          <div className="ld-stat">
            <div className="ld-stat__value">{stats.resolved_reports || 0}</div>
            <div className="ld-stat__label">Issues Resolved</div>
          </div>
        </div>
      </div>

      {/* ════════ FEATURE CARDS ════════ */}
      <div className="ld-features-wrap">
        <div className="ld-features-inner">
          <h2 className="ld-section-title" style={{ marginBottom: 20 }}>
            Ano ang magagawa mo?
          </h2>
          <div className="ld-features">
            <button className="ld-feature" onClick={() => navigate('/map')}>
              <div className="ld-feature__icon ld-feature__icon--green"><IconMap /></div>
              <div className="ld-feature__title">GIS Waste Map</div>
              <p className="ld-feature__desc">Tingnan kung saan ang pinaka-maraming basura sa interactive na mapa ng Lucena City.</p>
              <span className="ld-feature__arrow">↗</span>
            </button>
            <button className="ld-feature" onClick={() => setShowSchedulePopup(true)}>
              <div className="ld-feature__icon ld-feature__icon--amber"><IconTruck /></div>
              <div className="ld-feature__title">Collection Schedule</div>
              <p className="ld-feature__desc">Alamin kung kailan darating ang garbage truck sa inyong barangay.</p>
              <span className="ld-feature__arrow">↗</span>
            </button>
            <button className="ld-feature" onClick={() => setShowBuilder(true)}>
              <div className="ld-feature__icon ld-feature__icon--blue"><IconPhone /></div>
              <div className="ld-feature__title">Citizen Portal</div>
              <p className="ld-feature__desc">Mag-submit ng report kahit walang internet. I-sync pagbalik ng signal.</p>
              <span className="ld-feature__arrow">↗</span>
            </button>
          </div>
        </div>
      </div>

      {/* ════════ COMBO SECTION: SCHEDULE + REPORTS ════════ */}
      <div className="ld-combo-wrap">
        <div className="ld-combo-inner">
          <div className="ld-combo-grid">

            {/* ── LEFT: Collection Schedule ── */}
            <div className="ld-combo-col">
              <div className="ld-section-head">
                <div>
                  <div className="ld-eyebrow">
                    <span className="ld-eyebrow__dot" /> Inyong Zone
                  </div>
                  <h2 className="ld-section-title">Collection Schedule</h2>
                </div>
                <button
                  className="ld-btn ld-btn--outline-green ld-btn--sm"
                  onClick={() => setShowSchedulePopup(true)}
                >
                  View Schedule →
                </button>
              </div>

              {/* Next collection badge */}
              <div className="ld-next-badge">
                <div className="ld-next-badge__icon"><IconCalendar /></div>
                <div style={{ flex: 1 }}>
                  <div className="ld-next-badge__label">Susunod na Koleksyon</div>
                  <div className="ld-next-badge__row">
                    <span className="ld-next-badge__day">{nextCollection?.day || 'Lunes'}</span>
                    <span className="ld-next-badge__pill">
                      {nextCollection?.time?.split('–')[0]?.trim() || '6:00 AM'}
                    </span>
                    <span className="ld-next-badge__pill">{nextCollection?.zone || 'Brgy. Isabang'}</span>
                  </div>
                </div>
              </div>

              {/* Compact schedule list (first 4 items) */}
              <div className="ld-schedule-list">
                <div className="ld-schedule-head">
                  <span className="ld-schedule-head-title">Lingguhang Iskedyul</span>
                  {!isOnline && <span className="ld-cached">CACHED</span>}
                </div>
                {schedule.slice(0, 4).map((s, i) => (
                  <div key={i} className={`ld-schedule-item${s.isNext ? ' ld-schedule-item--next' : ''}`}>
                    <div className={`ld-sched-icon ${s.status === 'upcoming' ? 'ld-sched-icon--check' : 'ld-sched-icon--cross'}`}>
                      {s.status === 'upcoming' ? <IconCheck /> : <IconX />}
                    </div>
                    <div>
                      <div className="ld-sched-day">{s.day}</div>
                      <div className="ld-sched-zone">{s.zone}</div>
                    </div>
                    <div className="ld-sched-time">{s.time}</div>
                  </div>
                ))}
              </div>

              {/* Action buttons */}
              <div className="ld-combo-actions">
                <button
                  className="ld-btn ld-btn--outline ld-btn--sm"
                  onClick={() => setShowCalendarPopup(true)}
                >
                  <IconCalendar /> Event Calendar
                </button>
                <button
                  className="ld-btn ld-btn--outline-green ld-btn--sm"
                  onClick={() => setShowSchedulePopup(true)}
                >
                  Full Schedule →
                </button>
              </div>
            </div>

            {/* ── RIGHT: Report Queue ── */}
            <div className="ld-combo-col">
              <div className="ld-section-head">
                <div>
                  <div className="ld-eyebrow">
                    <span className="ld-eyebrow__dot" /> Inyong mga Report
                  </div>
                  <h2 className="ld-section-title">Mga Naipadala</h2>
                </div>
                <button
                  className="ld-btn ld-btn--primary ld-btn--sm"
                  onClick={() => setShowBuilder(true)}
                >
                  + Bagong Report
                </button>
              </div>
              <OfflineReportQueue
                reports={reports}
                isSyncing={isSyncing || reportsSyncing}
                isOnline={isOnline}
                lastSync={lastSyncAt}
                pendingCount={pendingCount}
                failedCount={failedCount}
                onSyncNow={handleSyncNow}
                onRetry={retryReport}
                onNewReport={() => setShowBuilder(true)}
              />
            </div>

          </div>
        </div>
      </div>

      {/* ════════ ANNOUNCEMENTS ════════ */}
      <div className="ld-ann-wrap">
        <div className="ld-ann-inner">
          <div className="ld-section-head">
            <div>
              <div className="ld-eyebrow">
                <span className="ld-eyebrow__dot" /> Balita
                {isStale && !isRefreshing && (
                  <span className="ld-eyebrow__tag ld-eyebrow__tag--amber">CACHED</span>
                )}
                {isRefreshing && (
                  <span className="ld-eyebrow__tag ld-eyebrow__tag--blue">Nag-a-update…</span>
                )}
              </div>
              <h2 className="ld-section-title">Mga Anunsyo</h2>
            </div>
            <button
              className="ld-btn ld-btn--outline-green ld-btn--sm"
              onClick={() => navigate('/announcements')}
            >
              Lahat ng Balita →
            </button>
          </div>

          <div className="ld-ann-card">
            <div className="ld-ann-img-wrap">
              <img key={annSlide} src={currentAnn?.image} alt={currentAnn?.title} className="ld-ann-img" />
            </div>
            <div className="ld-ann-content">
              <span className="ld-ann-category">📣 Anunsyo</span>
              <h3 className="ld-ann-title">{currentAnn?.title}</h3>
              <p className="ld-ann-body">{currentAnn?.body}</p>
              <button
                className="ld-btn ld-btn--primary ld-btn--sm"
                onClick={() => navigate(`/announcements/${currentAnn?.id}`)}
              >
                Basahin pa →
              </button>
            </div>
            {announcements.length > 1 && (
              <>
                <button className="ld-ann-nav ld-ann-nav--prev" onClick={() => setAnnSlide(p => (p - 1 + announcements.length) % announcements.length)} aria-label="Previous">‹</button>
                <button className="ld-ann-nav ld-ann-nav--next" onClick={() => setAnnSlide(p => (p + 1) % announcements.length)} aria-label="Next">›</button>
              </>
            )}
          </div>

          {announcements.length > 1 && (
            <div className="ld-ann-dots">
              {announcements.map((_, i) => (
                <button key={i} className={`ld-ann-dot${annSlide === i ? ' ld-ann-dot--active' : ''}`} onClick={() => setAnnSlide(i)} aria-label={`Announcement ${i + 1}`} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ════════ MID CTA ════════ */}
      <div className="ld-cta ld-cta--mid">
        <div className="ld-cta__inner">
          <div className="ld-cta__track">
            <span>I-track</span> · <span>Subaybayan</span> · <span>Mag-report</span>
          </div>
          <p className="ld-cta__quote">"Isang App para sa Lahat ng Waste Management"</p>
          <p className="ld-cta__sub">
            Ang kumpletong platform ng solid waste management para sa mga mamamayan, field teams, at administrasyon ng Lucena City.
          </p>
          <button className="ld-btn ld-btn--primary" onClick={() => navigate('/about')}>
            Alamin Kung Paano Gumagana →
          </button>
        </div>
      </div>

      {/* ════════ FOOTER ════════ */}
      <footer className="ld-footer">
        <div className="ld-footer__inner">
          <div>
            <div className="ld-footer__brand">
              <span className="logo">
                <img src="../../../Logo.svg" alt="logo-svg" />
              </span>
            </div>
            <p className="ld-footer__tagline">
              Smart waste management para sa mas malinis na Lucena City — powered by GIS, ML & PWA.
            </p>
          </div>
          <div className="ld-footer__col">
            <h4 className="ld-footer__col-title">Platform</h4>
            <a href="#">About</a>
            <a href="#">FAQ</a>
            <a href="#">Guidelines</a>
            <a href="#">Para sa Negosyo</a>
          </div>
          <div className="ld-footer__col">
            <h4 className="ld-footer__col-title">Mapa</h4>
            <a href="#" onClick={e => { e.preventDefault(); navigate('/map') }}>Hotspots</a>
            <a href="#">Truck Radar</a>
            <a href="#">Live View</a>
            <a href="#">Statistics</a>
          </div>
          <div className="ld-footer__col">
            <h4 className="ld-footer__col-title">Makipag-ugnayan</h4>
            <a href="tel:042-710-4311">(042) 710 4311</a>
            <a href="mailto:cenro@lucenacity.gov.ph">cenro@lucenacity.gov.ph</a>
            <a href="#">City Hall, Lucena</a>
          </div>
        </div>
        <div className="ld-footer__bottom">
          <p className="ld-footer__copy">© 2026 BS Information Technology — CSTC · Para sa thesis lamang · Lucena City</p>
          <p className="ld-footer__contact">WasteWatch · Lucena City CENRO</p>
        </div>
      </footer>

      <BottomNav />

      {/* ════════ REPORT BUILDER SHEET ════════ */}
      <OfflineReportBuilder
        isOpen={showBuilder}
        onClose={() => setShowBuilder(false)}
        onSubmit={handleSubmitReport}
      />

      {/* ════════ SCHEDULE POPUP ════════ */}
      {showSchedulePopup && (
        <>
          <div className="ld-modal-bd" onClick={() => setShowSchedulePopup(false)} />
          <div className="ld-sched-modal" role="dialog" aria-modal aria-label="Collection Schedule">

            {/* Handle */}
            <div className="ld-modal-handle" />

            {/* Header */}
            <div className="ld-sched-modal__header">
              <div>
                <div className="ld-eyebrow" style={{ marginBottom: 6 }}>
                  <span className="ld-eyebrow__dot" /> Collection Schedule
                </div>
                <h2 className="ld-sched-modal__title">Iskedyul ng Koleksyon</h2>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {!isOnline && <span className="ld-cached">CACHED</span>}
                <button className="ld-modal-close" onClick={() => setShowSchedulePopup(false)} aria-label="Close">✕</button>
              </div>
            </div>

            {/* Barangay selector strip */}
            <div className="ld-brgy-strip">
              <button
                className={`ld-brgy-chip${selectedBarangay === 'all' ? ' ld-brgy-chip--active' : ''}`}
                onClick={() => setSelectedBarangay('all')}
              >
                🏙️ All Zones
              </button>
              {LUCENA_BARANGAYS.map(b => (
                <button
                  key={b}
                  className={`ld-brgy-chip${selectedBarangay === b ? ' ld-brgy-chip--active' : ''}`}
                  onClick={() => setSelectedBarangay(b)}
                >
                  {b}
                </button>
              ))}
            </div>

            {/* Sync status for selected barangay */}
            {selectedBarangay !== 'all' && (
              <div className="ld-brgy-sync-row">
                <span className={`ld-brgy-sync-dot${brgyIsLive ? ' ld-brgy-sync-dot--live' : brgyIsCached ? ' ld-brgy-sync-dot--cached' : ''}`} />
                <span className="ld-brgy-sync-label">
                  {brgyIsLive
                    ? `Live data — synced for ${selectedBarangay}`
                    : brgyIsCached
                      ? `Cached schedule for ${selectedBarangay}`
                      : isOnline
                        ? `Loading schedule for ${selectedBarangay}…`
                        : `Offline — no cached data for ${selectedBarangay}`
                  }
                </span>
              </div>
            )}

            {/* Schedule list (scrollable) */}
            <div className="ld-sched-modal__list">
              {scheduleForSelected.length === 0 ? (
                <div className="ld-sched-modal__empty">
                  <span style={{ fontSize: 32 }}>📅</span>
                  <p>Walang schedule para sa <strong>{selectedBarangay}</strong>.</p>
                  {!isOnline && <p className="ld-sched-modal__empty-hint">Kumonekta sa internet para ma-load ang schedule.</p>}
                </div>
              ) : (
                scheduleForSelected.map((s, i) => (
                  <div key={i} className={`ld-schedule-item${s.isNext ? ' ld-schedule-item--next' : ''}`}>
                    <div className={`ld-sched-icon ${s.status === 'upcoming' ? 'ld-sched-icon--check' : 'ld-sched-icon--cross'}`}>
                      {s.status === 'upcoming' ? <IconCheck /> : <IconX />}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div className="ld-sched-day">{s.day}</div>
                      <div className="ld-sched-zone">{s.zone}</div>
                    </div>
                    <div className="ld-sched-time">{s.time}</div>
                  </div>
                ))
              )}
            </div>

            {/* Footer actions */}
            <div className="ld-sched-modal__footer">
              <button
                className="ld-btn ld-btn--outline ld-btn--sm"
                onClick={() => { setShowSchedulePopup(false); setShowCalendarPopup(true) }}
              >
                <IconCalendar /> Event Calendar
              </button>
              <button
                className="ld-btn ld-btn--primary ld-btn--sm"
                onClick={() => { setShowSchedulePopup(false); navigate('/schedule') }}
              >
                Full Schedule →
              </button>
            </div>

          </div>
        </>
      )}

      {/* ════════ CALENDAR POPUP ════════ */}
      {showCalendarPopup && (
        <>
          <div className="ld-modal-bd" onClick={() => setShowCalendarPopup(false)} />
          <div className="ld-cal-modal" role="dialog" aria-modal aria-label="Event Calendar">

            {/* Handle */}
            <div className="ld-modal-handle" />

            {/* Header */}
            <div className="ld-sched-modal__header">
              <div>
                <div className="ld-eyebrow" style={{ marginBottom: 6 }}>
                  <span className="ld-eyebrow__dot" /> Waste Impact Forecast
                </div>
                <h2 className="ld-sched-modal__title">Event Calendar</h2>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {!isOnline && <span className="ld-cached">CACHED</span>}
                <button className="ld-modal-close" onClick={() => setShowCalendarPopup(false)} aria-label="Close">✕</button>
              </div>
            </div>

            {/* Calendar body */}
            <div className="ld-cal-modal__body">
              <OfflineEventCalendar />
            </div>

            {/* Footer */}
            <div className="ld-sched-modal__footer">
              <button
                className="ld-btn ld-btn--outline ld-btn--sm"
                onClick={() => { setShowCalendarPopup(false); setShowSchedulePopup(true) }}
              >
                ← View Schedule
              </button>
              <button
                className="ld-btn ld-btn--primary ld-btn--sm"
                onClick={() => { setShowCalendarPopup(false); navigate('/events') }}
              >
                Full Calendar →
              </button>
            </div>

          </div>
        </>
      )}

    </div>
  )
}
