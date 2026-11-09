/**
 * pages/dashboard/PublicDashboard.jsx
 * ------------------------------------
 * WasteWatch Public Landing Page & Citizen Dashboard
 * 
 * Features:
 *  - English typography & copy throughout
 *  - Interactive Hero with live Leaflet / cached offline SVG vector map snapshot
 *  - Offline-first: IndexedDB report queue, cached schedules & cached announcements
 *  - Public capabilities bento grid (GIS Map, Schedules, Citizen Reporting, Waste Forecast)
 *  - Quick system metrics strip
 *  - Citizen Workspace: Next collection spotlight, weekly schedule preview, offline report queue
 *  - Municipal Impact & Top 3 Cleanest Barangays Leaderboard
 *  - Frequently Asked Questions knowledge section for anonymous visitors
 *  - Interactive popups for Barangay Collection Schedules, Event Calendar, and Location Preview
 *  - Quick Report camera/form flow integration
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  MapPin,
  Truck,
  Calendar,
  Flag,
  Check,
  X,
  AlertTriangle,
  Clock,
  Award,
  ArrowRight,
  ChevronRight,
  ChevronLeft,
  RefreshCw,
  ShieldCheck,
  Layers,
  HelpCircle,
  Camera,
  ExternalLink,
  BarChart3,
  CheckCircle2,
  Bell,
  Sparkles,
  Info
} from 'lucide-react'

import Navbar from '../../components/Navbar'
import BottomNav from '../../components/BottomNav'
import api from '../../api/client'
import OfflineBanner from '../../components/OfflineBanner'
import OfflineReportQueue from '../../components/OfflineReportQueue'
import OfflineEventCalendar from '../../components/OfflineEventCalendar'
import QuickReport from '../../components/QuickReport'
import { SidebarWidgetSkeleton, CalendarSkeleton, MapSkeleton } from '../../components/ui/Skeleton'

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

// ─── Hero Slide Configurations (English) ─────────────────────────────────────

const HERO_SLIDES = [
  {
    eyebrow: 'Lucena City · CENRO Sanitation',
    title: (
      <>
        Cleaner Lucena, <em>One Report at a Time</em>
      </>
    ),
    sub: 'Report uncollected waste in your barangay, track municipal truck routes in real time, and join the civic effort for a cleaner, greener Lucena City.',
  },
  {
    eyebrow: 'Citizen Civic Portal',
    title: (
      <>
        Report Waste Problems. <em>Fast, Simple & Offline.</em>
      </>
    ),
    sub: 'Capture geotagged photos and issue details even without mobile data. Your submission queues safely and syncs immediately when signal returns.',
  },
  {
    eyebrow: 'Smart Collection Schedules',
    title: (
      <>
        Know Exactly When <em>Trucks Will Arrive</em>
      </>
    ),
    sub: 'Never miss a garbage pickup. Look up verified collection timetables, designated zones, and truck routes across all 33 Lucena City barangays.',
  },
]

const LUCENA_BARANGAYS = [
  'Bocohan', 'Cotta', 'Dalahican', 'Domoit', 'Gulang-Gulang',
  'Ibabang Dupay', 'Ibabang Iyam', 'Ibabang Talim', 'Ilayang Dupay', 'Ilayang Iyam',
  'Isabang', 'Labor', 'Maranggal', 'Market View', 'Mayao Castillo',
  'Mayao Kanluran', 'Mayao Parada', 'Mayao Silangan', 'Novaliches', 'Palale',
  'Ransohan', 'Salinas', 'San Antonio', 'San Fernando', 'San Isidro',
  'San Jose', 'San Lucas', 'San Pablo', 'San Pedro', 'Santa Lucia',
  'Santo Niño', 'Talao-Talao', 'Tayabas Drive',
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
  { id: 'ibabang_dupay', poly: [[13.944, 121.604], [13.950, 121.606], [13.952, 121.618], [13.948, 121.624], [13.942, 121.621], [13.940, 121.610]] },
  { id: 'gulang_gulang', poly: [[13.950, 121.600], [13.958, 121.602], [13.962, 121.614], [13.956, 121.618], [13.950, 121.614], [13.948, 121.606]] },
  { id: 'cotta', poly: [[13.930, 121.604], [13.938, 121.606], [13.940, 121.614], [13.935, 121.618], [13.928, 121.615], [13.926, 121.607]] },
  { id: 'isabang', poly: [[13.924, 121.596], [13.932, 121.598], [13.934, 121.608], [13.928, 121.612], [13.921, 121.608], [13.920, 121.600]] },
  { id: 'dalahican', poly: [[13.912, 121.610], [13.920, 121.612], [13.922, 121.622], [13.916, 121.628], [13.908, 121.622], [13.907, 121.614]] },
  { id: 'ilayang_dupay', poly: [[13.935, 121.618], [13.942, 121.620], [13.945, 121.632], [13.938, 121.636], [13.932, 121.630], [13.930, 121.622]] },
  { id: 'bocohan', poly: [[13.920, 121.622], [13.928, 121.625], [13.930, 121.635], [13.923, 121.638], [13.916, 121.632], [13.915, 121.624]] },
  { id: 'domoit', poly: [[13.926, 121.586], [13.934, 121.590], [13.935, 121.598], [13.928, 121.600], [13.922, 121.596], [13.921, 121.588]] },
  { id: 'ibabang_iyam', poly: [[13.938, 121.586], [13.946, 121.590], [13.948, 121.600], [13.942, 121.604], [13.934, 121.598], [13.932, 121.590]] },
  { id: 'ransohan', poly: [[13.956, 121.590], [13.964, 121.593], [13.967, 121.604], [13.960, 121.607], [13.953, 121.602], [13.951, 121.594]] },
  { id: 'ilayang_iyam', poly: [[13.948, 121.594], [13.956, 121.596], [13.958, 121.606], [13.952, 121.610], [13.944, 121.606], [13.942, 121.597]] },
  { id: 'labor', poly: [[13.960, 121.610], [13.966, 121.613], [13.968, 121.624], [13.962, 121.627], [13.956, 121.622], [13.954, 121.614]] },
  { id: 'san_jose', poly: [[13.968, 121.596], [13.975, 121.600], [13.975, 121.610], [13.969, 121.614], [13.963, 121.608], [13.962, 121.599]] },
]

const SEV_CLR = { high: '#ff3b30', medium: '#ff9f0a', low: '#34c759', critical: '#bf5af2' }
const HERO_MAP_GEO_CACHE = 'ww_hero_map_geojson'
const HERO_MAP_SYNC_CACHE = 'ww_hero_map_sync'

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
      {isOnline && !leafletReady && (
        <div className="ld-hero__map-fallback">
          <MapSkeleton height="100%" dark label="Loading map..." showControls={false} style={{ opacity: 0.4 }} />
        </div>
      )}
    </div>
  )
}

// ─── Main PublicDashboard Component ──────────────────────────────────────────

export default function PublicDashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const isOnline = useOnline()

  // ── Data Hooks ──────────────────────────────────────────────────────────────
  const { announcements, isStale, isRefreshing } = useOfflineAnnouncements()
  const { stats } = usePublicStats()
  const { schedule, isRefreshing: scheduleRefreshing } = usePublicSchedule()

  const {
    reports, addReport, retryReport,
    isSyncing: reportsSyncing, pendingCount, failedCount,
  } = useOfflineReports()

  const { syncNow, isSyncing, lastSyncAt } = useOfflineSyncManager()

  // ── UI State ────────────────────────────────────────────────────────────────
  const [heroSlide, setHeroSlide] = useState(0)
  const [annSlide, setAnnSlide] = useState(0)
  const [leaderboard, setLeaderboard] = useState([])
  const [leaderboardLoading, setLeaderboardLoading] = useState(() => isOnline)

  // Popup state
  const [showSchedulePopup, setShowSchedulePopup] = useState(false)
  const [showCalendarPopup, setShowCalendarPopup] = useState(false)
  const [selectedBarangay, setSelectedBarangay] = useState('all')
  const [showReportMap, setShowReportMap] = useState(null)

  // Per-barangay schedule cache: { [barangayName]: scheduleItems[] }
  const [barangayScheduleCache, setBarangayScheduleCache] = useState(() => {
    try { return JSON.parse(localStorage.getItem('ww_brgy_schedules') || '{}') }
    catch { return {} }
  })

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const formatScheduleDays = useCallback((dayStr) => {
    if (!dayStr) return 'Daily Collection'
    const days = dayStr.split(',').map(d => d.trim().toLowerCase())
    if (days.length >= 7) return 'Daily (Mon – Sun)'
    if (days.length === 5 && !days.includes('sat') && !days.includes('sun')) return 'Weekdays (Mon – Fri)'
    if (days.length === 2 && days.includes('sat') && days.includes('sun')) return 'Weekends (Sat & Sun)'
    return dayStr
  }, [])

  const cleanZoneName = useCallback((zoneStr) => {
    if (!zoneStr) return 'all'
    const first = zoneStr.split(',')[0].trim()
    return first.replace(/^Brgy\.\s*/i, '').trim()
  }, [])

  // ── Auto-play ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setHeroSlide(p => (p + 1) % HERO_SLIDES.length), 5000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (isOnline) {
      setLeaderboardLoading(true)
      api.get('/api/watcher/reports/leaderboard/')
        .then(res => setLeaderboard(res.data || []))
        .catch(err => console.error('Failed to fetch leaderboard', err))
        .finally(() => setLeaderboardLoading(false))
    } else {
      setLeaderboardLoading(false)
    }
  }, [isOnline])

  useEffect(() => {
    if (announcements.length <= 1) return
    const t = setInterval(() => setAnnSlide(p => (p + 1) % announcements.length), 5000)
    return () => clearInterval(t)
  }, [announcements.length])

  // ── Auto-sync selected barangay schedule when online ──────────────────────────
  useEffect(() => {
    if (!showSchedulePopup || selectedBarangay === 'all' || !isOnline) return

    if (barangayScheduleCache[selectedBarangay]) return

    const filtered = schedule.filter(s =>
      s.zone?.toLowerCase().includes(selectedBarangay.toLowerCase().split(' ')[0])
    )

    const updated = {
      ...barangayScheduleCache,
      [selectedBarangay]: filtered.length > 0 ? filtered : [],
    }
    setBarangayScheduleCache(updated)
    try { localStorage.setItem('ww_brgy_schedules', JSON.stringify(updated)) } catch { /* silent */ }
  }, [showSchedulePopup, selectedBarangay, isOnline, schedule])

  // ── Close popups on Escape key ───────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') {
        setShowSchedulePopup(false)
        setShowCalendarPopup(false)
        setShowReportMap(null)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // ── Handlers ────────────────────────────────────────────────────────────────
  const handleSyncNow = useCallback(() => syncNow(), [syncNow])

  const handleOpenReport = useCallback(() => {
    window.dispatchEvent(new Event('open-quick-report'))
  }, [])

  const handleReportClick = useCallback((report) => {
    if (!report.location?.lat || !report.location?.lng) return
    setShowReportMap(report)
  }, [])

  const handleCreateDemoReport = useCallback(async () => {
    try {
      await addReport({
        issue_type: 'overflow',
        description: 'Uncollected curbside waste accumulation near intersection',
        severity: 'medium',
        location: { lat: 13.9370, lng: 121.6155 },
        address: 'Brgy. Isabang, Lucena City',
      })
    } catch (err) {
      console.error('Failed to create demo report:', err)
    }
  }, [addReport])

  // ── Derived Values ──────────────────────────────────────────────────────────
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

  const brgyIsLive = isOnline && selectedBarangay !== 'all'
  const brgyIsCached = !isOnline && selectedBarangay !== 'all' && (barangayScheduleCache[selectedBarangay]?.length ?? 0) > 0

  return (
    <div className="ld-root">
      <style>{`
        .ld-workspace-col {
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 16px;
          background: var(--surface-2);
          padding: 24px;
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        .ld-workspace-col:hover {
          transform: translateY(-3px);
          box-shadow: 0 12px 32px rgba(0,0,0,0.12);
        }
        .ld-hero__chips {
          display: flex;
          flex-direction: column;
          gap: 12px;
          position: absolute;
          right: 36px;
          top: 50%;
          transform: translateY(-50%);
          z-index: 2;
        }
        @media (max-width: 980px) {
          .ld-hero__chips {
            display: none;
          }
        }
      `}</style>

      <OfflineBanner />
      <Navbar />

      {/* ════════ HERO SECTION (PRESERVED & ENHANCED) ════════ */}
      <section className="ld-hero ld-hero--dark">
        <HeroMapLayer isOnline={isOnline} />
        <div className="ld-hero__overlay" />

        {!isOnline && (
          <div className="ld-hero__map-badge">
            <span className="ld-hero__map-badge-dot" />
            Cached Offline Map
          </div>
        )}
        {isOnline && (
          <div className="ld-hero__map-badge ld-hero__map-badge--live">
            <span className="ld-hero__map-badge-dot" />
            Live Hotspots Active
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
            <button className="ld-btn ld-btn--hero-primary" onClick={handleOpenReport}>
              <Flag size={18} /> Report an Issue
            </button>
            <button className="ld-btn ld-btn--hero-outline" onClick={() => setShowSchedulePopup(true)}>
              <Calendar size={18} /> View Collection Schedule
            </button>
          </div>

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

        {/* Floating Quick Chips for Desktop */}
        <div className="ld-hero__chips">
          <div className="ld-chip ld-chip--dark">
            <div className="ld-chip__dot ld-chip__dot--green" />
            <div>
              <div className="ld-chip__value">33</div>
              <div className="ld-chip__label">Barangays Monitored</div>
            </div>
          </div>
          <div className="ld-chip ld-chip--dark">
            <div className="ld-chip__dot ld-chip__dot--amber" />
            <div>
              <div className="ld-chip__value">{stats.active_trucks || 0}</div>
              <div className="ld-chip__label">Active Route Trucks</div>
            </div>
          </div>
          <div className="ld-chip ld-chip--dark">
            <div className="ld-chip__dot ld-chip__dot--blue" />
            <div>
              <div className="ld-chip__value">PWA</div>
              <div className="ld-chip__label">100% Offline Capable</div>
            </div>
          </div>
        </div>

        {pendingCount > 0 && (
          <div className="ld-hero__sync-pill" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Clock size={15} /> {pendingCount} report{pendingCount > 1 ? 's' : ''} queued for sync
          </div>
        )}
      </section>

      {/* ════════ QUICK METRICS PULSE STRIP ════════ */}
      <div className="ld-stats-wrap">
        <div className="ld-stats">
          <div className="ld-stat">
            <div className="ld-stat__value">33</div>
            <div className="ld-stat__label">Barangays Covered</div>
          </div>
          <div className="ld-stat">
            <div className="ld-stat__value">{stats.active_trucks || 0}</div>
            <div className="ld-stat__label">Active Collection Trucks</div>
          </div>
          <div className="ld-stat">
            <div className="ld-stat__value">{stats.hotspots || 0}</div>
            <div className="ld-stat__label">Monitored Waste Hotspots</div>
          </div>
          <div className="ld-stat">
            <div className="ld-stat__value">{stats.resolved_reports || 0}</div>
            <div className="ld-stat__label">Resolved Reports</div>
          </div>
        </div>
      </div>

      {/* ════════ CORE CAPABILITIES (BENTO CARDS) ════════ */}
      <div className="ld-features-wrap">
        <div className="ld-features-inner">
          <div className="ld-section-head">
            <div>
              <div className="ld-eyebrow">
                <span className="ld-eyebrow__dot" /> Platform Capabilities
              </div>
              <h2 className="ld-section-title">
                What You Can Do on WasteWatch
              </h2>
            </div>
          </div>

          <div className="ld-features">
            <button className="ld-feature" onClick={() => navigate('/public-map')}>
              <div className="ld-feature__icon ld-feature__icon--green">
                <MapPin size={22} />
              </div>
              <div className="ld-feature__title">GIS Waste Hotspot Map</div>
              <p className="ld-feature__desc">
                Explore real-time waste density clusters, verified reports, and active collection coverage across Lucena City.
              </p>
              <span className="ld-feature__arrow"><ArrowRight size={18} /></span>
            </button>

            <button className="ld-feature" onClick={() => setShowSchedulePopup(true)}>
              <div className="ld-feature__icon ld-feature__icon--amber">
                <Truck size={22} />
              </div>
              <div className="ld-feature__title">Collection Schedules</div>
              <p className="ld-feature__desc">
                Look up designated collection timetables, operating hours, and live truck radar for your specific barangay.
              </p>
              <span className="ld-feature__arrow"><ArrowRight size={18} /></span>
            </button>

            <button className="ld-feature" onClick={handleOpenReport}>
              <div className="ld-feature__icon ld-feature__icon--blue">
                <Camera size={22} />
              </div>
              <div className="ld-feature__title">Citizen Reporting Portal</div>
              <p className="ld-feature__desc">
                Submit waste reports with GPS coordinates and photos even without internet. Data syncs automatically once reconnected.
              </p>
              <span className="ld-feature__arrow"><ArrowRight size={18} /></span>
            </button>

            <button className="ld-feature" onClick={() => setShowCalendarPopup(true)}>
              <div className="ld-feature__icon ld-feature__icon--green">
                <Calendar size={22} />
              </div>
              <div className="ld-feature__title">Impact Forecast & Events</div>
              <p className="ld-feature__desc">
                Anticipate waste surges during city fiestas, market days, and cleanups with predictive environmental forecasts.
              </p>
              <span className="ld-feature__arrow"><ArrowRight size={18} /></span>
            </button>
          </div>
        </div>
      </div>

      {/* ════════ OFFICIAL ANNOUNCEMENTS & BULLETINS ════════ */}
      <div className="ld-ann-wrap">
        <div className="ld-ann-inner">
          <div className="ld-section-head">
            <div>
              <div className="ld-eyebrow">
                <span className="ld-eyebrow__dot" /> Official Bulletins
                {isStale && !isRefreshing && <span className="ld-eyebrow__tag ld-eyebrow__tag--amber">CACHED</span>}
                {isRefreshing && <span className="ld-eyebrow__tag ld-eyebrow__tag--blue">Updating…</span>}
              </div>
              <h2 className="ld-section-title">City Advisories & News</h2>
            </div>
            <button className="ld-btn ld-btn--outline-green ld-btn--sm" onClick={() => navigate('/announcements')}>
              All Advisories <ArrowRight size={14} />
            </button>
          </div>

          <div className="ld-ann-card">
            <div className="ld-ann-img-wrap">
              <img
                key={annSlide}
                src={currentAnn?.image_url || currentAnn?.image || '/cgso-real.jpg'}
                alt={currentAnn?.title || 'Announcement'}
                className="ld-ann-img"
              />
            </div>
            <div className="ld-ann-content">
              <span className="ld-ann-category" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Bell size={13} /> Public Advisory
              </span>
              <h3 className="ld-ann-title">{currentAnn?.title || 'Lucena City Waste Management Update'}</h3>
              <p className="ld-ann-body">
                {currentAnn?.description || currentAnn?.body || 'Stay informed with real-time sanitation advisories, clean-up drives, and community schedules.'}
              </p>
              <button className="ld-btn ld-btn--primary ld-btn--sm" onClick={() => navigate('/announcements')}>
                Read Full Bulletin <ArrowRight size={14} />
              </button>
            </div>
            {announcements.length > 1 && (
              <>
                <button
                  className="ld-ann-nav ld-ann-nav--prev"
                  onClick={() => setAnnSlide(p => (p - 1 + announcements.length) % announcements.length)}
                  aria-label="Previous Announcement"
                >
                  <ChevronLeft size={20} />
                </button>
                <button
                  className="ld-ann-nav ld-ann-nav--next"
                  onClick={() => setAnnSlide(p => (p + 1) % announcements.length)}
                  aria-label="Next Announcement"
                >
                  <ChevronRight size={20} />
                </button>
              </>
            )}
          </div>

          {announcements.length > 1 && (
            <div className="ld-ann-dots">
              {announcements.map((_, i) => (
                <button
                  key={i}
                  className={`ld-ann-dot${annSlide === i ? ' ld-ann-dot--active' : ''}`}
                  onClick={() => setAnnSlide(i)}
                  aria-label={`Announcement ${i + 1}`}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ════════ CITIZEN WORKSPACE (SCHEDULE + REPORT QUEUE) ════════ */}
      <div className="ld-combo-wrap">
        <div className="ld-combo-inner">
          <div className="ld-section-head" style={{ marginBottom: 28 }}>
            <div>
              <div className="ld-eyebrow">
                <span className="ld-eyebrow__dot" /> Interactive Hub
              </div>
              <h2 className="ld-section-title">Citizen Workspace & Tracking</h2>
            </div>
          </div>

          <div className="ld-combo-grid">
            {/* ── LEFT: Collection Schedule ── */}
            <div className="ld-combo-col ld-workspace-col">
              <div className="ld-section-head">
                <div>
                  <h3 className="ld-section-title" style={{ fontSize: '1.25rem' }}>Collection Schedule</h3>
                </div>
                <button className="ld-btn ld-btn--outline-green ld-btn--sm" onClick={() => setShowSchedulePopup(true)}>
                  View Timetable <ArrowRight size={14} />
                </button>
              </div>

              {/* Next Collection Spotlight */}
              <div
                className="ld-next-badge"
                style={{ cursor: 'pointer', transition: 'transform 0.18s ease, box-shadow 0.18s ease' }}
                onClick={() => {
                  setSelectedBarangay(cleanZoneName(nextCollection?.zone))
                  setShowSchedulePopup(true)
                }}
                title="Click to view live radar & full timetable for this zone"
              >
                <div className="ld-next-badge__icon">
                  <Truck size={24} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginBottom: 2 }}>
                    <div className="ld-next-badge__label">Next Scheduled Collection</div>
                    <span style={{ fontSize: '11px', color: 'var(--ld-green, #2e7d32)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                      Live Radar <ArrowRight size={12} />
                    </span>
                  </div>
                  <div className="ld-next-badge__row">
                    <span className="ld-next-badge__day">{formatScheduleDays(nextCollection?.day) || 'Daily (Mon – Sun)'}</span>
                    <span className="ld-next-badge__pill">{nextCollection?.time?.split('–')[0]?.trim() || '6:00 AM'}</span>
                    <span className="ld-next-badge__pill">{nextCollection?.zone || 'Brgy. Isabang'}</span>
                    {nextCollection?.isNext && (
                      <span className="ld-next-badge__pill" style={{ background: '#e8f5e9', color: '#2e7d32', borderColor: '#a5d6a7', fontWeight: 700 }}>
                        Active Today
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Weekly Preview List */}
              <div className="ld-schedule-list">
                <div className="ld-schedule-head">
                  <span className="ld-schedule-head-title">Weekly Schedule Overview</span>
                  {!isOnline && <span className="ld-cached">CACHED</span>}
                </div>
                {schedule.length === 0 && scheduleRefreshing ? (
                  <div style={{ padding: '12px 0' }}>
                    <SidebarWidgetSkeleton rows={3} />
                  </div>
                ) : (
                  <div className="ww-stagger">
                    {schedule.slice(0, 5).map((s, i) => (
                      <div
                        key={i}
                        className={`ld-schedule-item${s.isNext ? ' ld-schedule-item--next' : ''}`}
                        style={{ cursor: 'pointer', transition: 'background 0.15s ease' }}
                        onClick={() => {
                          setSelectedBarangay(cleanZoneName(s.zone))
                          setShowSchedulePopup(true)
                        }}
                        title={`Click to inspect ${s.zone || 'schedule'} details & radar`}
                      >
                        <div
                          className="ld-sched-icon"
                          style={{
                            background: s.isNext ? 'var(--ld-green-lt, #e8f5e9)' : '#f1f5f9',
                            color: s.isNext ? 'var(--ld-green, #2e7d32)' : '#64748b'
                          }}
                        >
                          {s.isNext ? <Truck size={16} /> : <Clock size={16} />}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="ld-sched-day" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span>{formatScheduleDays(s.day)}</span>
                            {s.isNext ? (
                              <span style={{ fontSize: '10px', background: '#dcfce7', color: '#15803d', padding: '1px 6px', borderRadius: 100, fontWeight: 700 }}>
                                Today
                              </span>
                            ) : (
                              <span style={{ fontSize: '10px', background: '#f1f5f9', color: '#64748b', padding: '1px 6px', borderRadius: 100, fontWeight: 600 }}>
                                Scheduled
                              </span>
                            )}
                          </div>
                          <div className="ld-sched-zone">{s.zone}</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                          <div className="ld-sched-time">{s.time}</div>
                          <ChevronRight size={15} style={{ color: '#94a3b8' }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="ld-combo-actions">
                <button className="ld-btn ld-btn--outline ld-btn--sm" onClick={() => setShowCalendarPopup(true)}>
                  <Calendar size={15} /> Event Impact Calendar
                </button>
                <button className="ld-btn ld-btn--outline ld-btn--sm" onClick={() => navigate('/schedule')}>
                  Full City Schedule <ArrowRight size={14} />
                </button>
              </div>
            </div>

            {/* ── RIGHT: Report Queue ── */}
            <div className="ld-combo-col ld-workspace-col">
              <div className="ld-section-head">
                <div>
                  <h3 className="ld-section-title" style={{ fontSize: '1.25rem' }}>Report Activity & Queue</h3>
                </div>
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
                onNewReport={handleOpenReport}
                onReportClick={handleReportClick}
                onDemoReport={handleCreateDemoReport}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ════════ CITY OVERVIEW & IMPACT (LEADERBOARD) ════════ */}
      <div
        className="ld-stats-wrap"
        style={{
          marginTop: 20,
          background: `url('/cgso-real.jpg') center/cover no-repeat`
        }}
      >
        <div style={{
          paddingTop: 80,
          paddingBottom: 40,
          background: `
            linear-gradient(
              to bottom, 
              rgba(13, 31, 15, 0.88), 
              rgba(46, 125, 50, 0.90)
            )
          `,
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)'
        }}>
          <div style={{ maxWidth: 1000, margin: '0 auto', padding: '0 24px', textAlign: 'center', marginBottom: 44 }}>
            <div className="ld-eyebrow ld-eyebrow--dark" style={{ justifyContent: 'center' }}>
              <span className="ld-eyebrow__dot" /> Municipal Impact
            </div>
            <h2 className="ld-section-title" style={{ color: 'white', textShadow: '0 2px 10px rgba(0,0,0,0.5)', marginBottom: 14 }}>
              Our Collective City Impact
            </h2>
            <p style={{ color: 'rgba(255,255,255,0.78)', fontSize: '1.05rem', maxWidth: 680, margin: '0 auto', lineHeight: 1.6 }}>
              Real-time overview of solid waste management operations across Lucena City. Driven by active citizen participation and rapid municipal response.
            </p>
          </div>

          <div className="ld-stats">
            <div className="ld-stat">
              <div className="ld-stat__value">33</div>
              <div className="ld-stat__label" style={{ marginBottom: 6 }}>Barangays Covered</div>
              <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.55)', lineHeight: 1.3 }}>Full municipal coverage across Lucena City</div>
            </div>
            <div className="ld-stat">
              <div className="ld-stat__value">{stats.active_trucks || 0}</div>
              <div className="ld-stat__label" style={{ marginBottom: 6 }}>Active Collection Trucks</div>
              <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.55)', lineHeight: 1.3 }}>Sanitation vehicles currently on route</div>
            </div>
            <div className="ld-stat">
              <div className="ld-stat__value">{stats.hotspots || 0}</div>
              <div className="ld-stat__label" style={{ marginBottom: 6 }}>Hotspots Detected</div>
              <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.55)', lineHeight: 1.3 }}>High-priority waste clusters monitored</div>
            </div>
            <div className="ld-stat">
              <div className="ld-stat__value">{stats.resolved_reports || 0}</div>
              <div className="ld-stat__label" style={{ marginBottom: 6 }}>Issues Resolved</div>
              <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.55)', lineHeight: 1.3 }}>Reports verified, collected, and cleared</div>
            </div>
          </div>

          {/* Cleanest Barangay Leaderboard */}
          <div style={{
            maxWidth: 720,
            margin: '50px auto 0',
            background: 'rgba(13,31,15,0.55)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            borderRadius: 20,
            padding: 32,
            border: '1px solid rgba(255,255,255,0.15)',
            boxShadow: '0 20px 40px rgba(0,0,0,0.25)'
          }}>
            <h3 style={{
              color: 'white',
              marginTop: 0,
              marginBottom: 8,
              fontSize: '1.4rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10
            }}>
              <Award size={24} color="#fbbf24" />
              Top 3 Cleanest Barangays
            </h3>
            <p style={{
              color: 'rgba(255,255,255,0.7)',
              textAlign: 'center',
              fontSize: '0.9rem',
              marginTop: 0,
              marginBottom: 24,
              lineHeight: 1.5
            }}>
              Ranked (PTS) based on resolution speed, completion rate, and verified cleanups. Higher points reflect proactive barangay sanitation and community engagement.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {leaderboard.length > 0 ? (
                <div className="ww-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {leaderboard.slice(0, 3).map((item, idx) => (
                    <div
                      key={idx}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        background: 'rgba(0,0,0,0.28)',
                        padding: '16px 20px',
                        borderRadius: 12,
                        transition: 'transform 0.2s',
                        border: '1px solid rgba(255,255,255,0.08)'
                      }}
                      className="ld-leaderboard-item"
                    >
                      <div style={{
                        fontSize: '1.6rem',
                        fontWeight: 800,
                        color: idx === 0 ? '#fbbf24' : idx === 1 ? '#94a3b8' : '#cd7f32',
                        marginRight: 20,
                        minWidth: 32,
                        textAlign: 'center'
                      }}>
                        #{item.rank || idx + 1}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ color: 'white', fontWeight: 700, fontSize: '1.15rem', marginBottom: 3 }}>
                          {item.barangay}
                        </div>
                        <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: '0.88rem', display: 'flex', gap: 10 }}>
                          <span>{item.resolved} resolved</span>
                          <span style={{ color: 'rgba(255,255,255,0.3)' }}>•</span>
                          <span>{item.rate}% success rate</span>
                        </div>
                      </div>
                      <div style={{ color: '#81c784', fontWeight: 800, fontSize: '1.35rem', textAlign: 'right' }}>
                        {item.score} <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)', display: 'block', fontWeight: 600, marginTop: -3 }}>PTS</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : isOnline && leaderboardLoading ? (
                <SidebarWidgetSkeleton rows={3} dark />
              ) : (
                <div style={{ color: 'rgba(255,255,255,0.65)', textAlign: 'center', padding: '30px 0', fontSize: '0.95rem' }}>
                  {!isOnline ? 'Connect to the internet to load real-time leaderboard rankings.' : 'No leaderboard rankings available yet.'}
                </div>
              )}
            </div>
          </div>

          {/* ════════ MID CTA ════════ */}
          <div className="ld-cta ld-cta--mid" style={{
            background: 'rgba(13,31,15,0.3)',
            marginTop: 70,
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
            borderTop: '1px solid rgba(255,255,255,0.08)'
          }}>
            <div className="ld-cta__inner">
              <div className="ld-cta__track">
                <span>Track</span> · <span>Verify</span> · <span>Report</span>
              </div>
              <p className="ld-cta__quote">"A Unified Platform for Municipal Waste Management"</p>
              <p className="ld-cta__sub">
                An integrated civic and municipal solution empowering citizens, sanitation workers, and city administration for a cleaner, greener Lucena City.
              </p>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
                <button className="ld-btn ld-btn--primary" onClick={() => navigate('/about')}>
                  Learn How It Works <ArrowRight size={16} />
                </button>
                <button className="ld-btn ld-btn--hero-outline" onClick={() => navigate('/public-map')}>
                  <MapPin size={16} /> Open GIS Map
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ════════ FREQUENTLY ASKED QUESTIONS (ANONYMOUS KNOWLEDGE HUB) ════════ */}
      <div className="ld-faq-wrap">
        <div className="ld-faq-inner">
          <div className="ld-section-head">
            <div>
              <div className="ld-eyebrow">
                <span className="ld-eyebrow__dot" /> Citizen Guide
              </div>
              <h2 className="ld-section-title">
                Frequently Asked Questions
              </h2>
            </div>
          </div>

          <div className="ld-faq-grid">
            <div className="ld-faq-card">
              <div className="ld-faq-q">
                <div className="ld-faq-q-icon"><Camera size={16} /></div>
                <span>How do I submit a report without internet access?</span>
              </div>
              <p className="ld-faq-a">
                WasteWatch is built with Progressive Web App (PWA) offline technology. You can take a photo and log the waste location even in areas with no mobile signal. Your report is saved locally in your browser's IndexedDB and will automatically sync once your connection is restored.
              </p>
            </div>

            <div className="ld-faq-card">
              <div className="ld-faq-q">
                <div className="ld-faq-q-icon"><Truck size={16} /></div>
                <span>When does garbage collection happen in my barangay?</span>
              </div>
              <p className="ld-faq-a">
                Click "View Collection Schedule" or select your barangay from the schedule list above. We display scheduled pickup days, designated time slots, and live truck radar across all 33 Lucena City barangays.
              </p>
            </div>

            <div className="ld-faq-card">
              <div className="ld-faq-q">
                <div className="ld-faq-q-icon"><ShieldCheck size={16} /></div>
                <span>What happens after I submit a waste report?</span>
              </div>
              <p className="ld-faq-a">
                Your report is routed to CENRO and assigned to local Barangay Officials for verification. A sanitation crew or collection truck is dispatched to clear the hotspot, and the status is updated on the public map.
              </p>
            </div>

            <div className="ld-faq-card">
              <div className="ld-faq-q">
                <div className="ld-faq-q-icon"><HelpCircle size={16} /></div>
                <span>Do I need to create an account to use WasteWatch?</span>
              </div>
              <p className="ld-faq-a">
                No account is required! Anonymous visitors can check collection schedules, view city advisories, browse the public GIS map, and submit waste reports immediately. Creating an account unlocks personal notification history and official role features.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ════════ PROFESSIONAL FOOTER ════════ */}
      <footer className="ld-footer">
        <div className="ld-footer__inner">
          <div>
            <div className="ld-footer__brand">
              <span className="logo">
                <img src="/Logo.svg" alt="WasteWatch Logo" />
              </span>
            </div>
            <p className="ld-footer__tagline">
              Smart waste management for a cleaner, greener Lucena City — powered by GIS mapping, machine learning forecasting, and offline PWA architecture.
            </p>
          </div>
          <div className="ld-footer__col">
            <h4 className="ld-footer__col-title">Platform</h4>
            <a href="#" onClick={e => { e.preventDefault(); navigate('/about') }}>About WasteWatch</a>
            <a href="#" onClick={e => { e.preventDefault(); navigate('/public-map') }}>Public GIS Map</a>
            <a href="#" onClick={e => { e.preventDefault(); setShowSchedulePopup(true) }}>Collection Schedules</a>
            <a href="#" onClick={e => { e.preventDefault(); navigate('/announcements') }}>City Advisories</a>
          </div>
          <div className="ld-footer__col">
            <h4 className="ld-footer__col-title">Citizen Tools</h4>
            <a href="#" onClick={e => { e.preventDefault(); handleOpenReport() }}>Report an Issue</a>
            <a href="#" onClick={e => { e.preventDefault(); setShowCalendarPopup(true) }}>Waste Impact Calendar</a>
            <a href="#" onClick={e => { e.preventDefault(); navigate('/login') }}>Officer Portal Login</a>
            <a href="#" onClick={e => { e.preventDefault(); navigate('/about') }}>Segregation Guidelines</a>
          </div>
          <div className="ld-footer__col">
            <h4 className="ld-footer__col-title">Contact CENRO</h4>
            <a href="tel:042-710-4311">(042) 710 4311</a>
            <a href="mailto:cenro@lucenacity.gov.ph">cenro@lucenacity.gov.ph</a>
            <a href="#">Lucena City Hall, Lucena City</a>
            <a href="#">CENRO Solid Waste Section</a>
          </div>
        </div>
        <div className="ld-footer__bottom">
          <p className="ld-footer__copy">
            © 2026 BS Information Technology — Dalubhasaan ng Lungsod ng Lucena (DLL) · Public Service & Thesis Project · Lucena City, Philippines
          </p>
          <p className="ld-footer__contact">
            WasteWatch · Lucena City CENRO
          </p>
        </div>
      </footer>

      <BottomNav />

      {/* ════════ SCHEDULE POPUP (ENGLISH) ════════ */}
      {showSchedulePopup && (
        <>
          <div className="ld-modal-bd" onClick={() => setShowSchedulePopup(false)} />
          <div className="ld-sched-modal" role="dialog" aria-modal aria-label="Collection Schedule">
            <div className="ld-modal-handle" />

            {/* Header */}
            <div className="ld-sched-modal__header">
              <div>
                <div className="ld-eyebrow" style={{ marginBottom: 6 }}>
                  <span className="ld-eyebrow__dot" /> Collection Timetable
                </div>
                <h2 className="ld-sched-modal__title">Barangay Collection Schedule</h2>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {!isOnline && <span className="ld-cached">CACHED</span>}
                <button
                  className="ld-modal-close"
                  onClick={() => setShowSchedulePopup(false)}
                  aria-label="Close"
                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Barangay selector strip */}
            <div className="ld-brgy-strip">
              <button
                className={`ld-brgy-chip${selectedBarangay === 'all' ? ' ld-brgy-chip--active' : ''}`}
                onClick={() => setSelectedBarangay('all')}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <MapPin size={13} /> All Zones
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

            {/* Live Truck Status Indicator */}
            {selectedBarangay !== 'all' && (
              <div style={{
                margin: '16px 20px 0',
                background: 'var(--ld-surface-2)',
                border: '1px solid var(--ld-line)',
                borderRadius: 12,
                padding: '14px 16px',
                display: 'flex',
                alignItems: 'center',
                gap: 14
              }}>
                <div style={{
                  position: 'relative',
                  width: 44,
                  height: 44,
                  borderRadius: '50%',
                  background: 'rgba(46, 125, 50, 0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--ld-green)'
                }}>
                  <Truck size={22} />
                  {brgyIsLive && scheduleForSelected.some(s => s.isNext) && (
                    <span style={{
                      position: 'absolute',
                      top: -2,
                      right: -2,
                      width: 12,
                      height: 12,
                      borderRadius: '50%',
                      background: '#4caf50',
                      animation: 'ldPulse 1.5s infinite',
                      border: '2px solid var(--ld-surface-2)'
                    }} />
                  )}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--ld-text)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    Live Truck Radar
                    {!isOnline && <span className="ld-brgy-sync-dot ld-brgy-sync-dot--cached" style={{ animation: 'none' }} />}
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--ld-text-3)', marginTop: 2, lineHeight: 1.3 }}>
                    {brgyIsLive ? (
                      scheduleForSelected.some(s => s.isNext)
                        ? <span style={{ color: 'var(--ld-green)', fontWeight: 600 }}>Collection truck is currently operating in this zone.</span>
                        : 'No active collection trucks operating right now.'
                    ) : brgyIsCached ? (
                      'Live radar paused (Offline cached mode)'
                    ) : 'Connect to the internet for live radar updates.'}
                  </div>
                </div>
              </div>
            )}

            {/* Schedule list */}
            <div className="ld-sched-modal__list">
              {schedule.length === 0 && scheduleRefreshing ? (
                <div style={{ padding: 16 }}>
                  <CalendarSkeleton />
                </div>
              ) : scheduleForSelected.length === 0 ? (
                <div className="ld-sched-modal__empty">
                  <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12, color: 'var(--text-muted)' }}>
                    <Calendar size={32} />
                  </div>
                  <p>No collection schedule found for <strong>{selectedBarangay}</strong>.</p>
                  {!isOnline && <p className="ld-sched-modal__empty-hint">Connect to the internet to load updated schedules.</p>}
                </div>
              ) : (
                <div className="ww-stagger">
                  {scheduleForSelected.map((s, i) => (
                    <div
                      key={i}
                      className={`ld-schedule-item${s.isNext ? ' ld-schedule-item--next' : ''}`}
                      style={{ cursor: 'pointer', transition: 'background 0.15s ease' }}
                      onClick={() => {
                        if (selectedBarangay === 'all') {
                          setSelectedBarangay(cleanZoneName(s.zone))
                        }
                      }}
                    >
                      <div
                        className="ld-sched-icon"
                        style={{
                          background: s.isNext ? 'var(--ld-green-lt, #e8f5e9)' : '#f1f5f9',
                          color: s.isNext ? 'var(--ld-green, #2e7d32)' : '#64748b'
                        }}
                      >
                        {s.isNext ? <Truck size={16} /> : <Clock size={16} />}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div className="ld-sched-day" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span>{formatScheduleDays(s.day)}</span>
                          {s.isNext ? (
                            <span style={{ fontSize: '10px', background: '#dcfce7', color: '#15803d', padding: '1px 6px', borderRadius: 100, fontWeight: 700 }}>
                              Today
                            </span>
                          ) : (
                            <span style={{ fontSize: '10px', background: '#f1f5f9', color: '#64748b', padding: '1px 6px', borderRadius: 100, fontWeight: 600 }}>
                              Scheduled
                            </span>
                          )}
                        </div>
                        <div className="ld-sched-zone">{s.zone}</div>
                      </div>
                      <div className="ld-sched-time">{s.time}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer actions */}
            <div className="ld-sched-modal__footer">
              <button
                className="ld-btn ld-btn--outline ld-btn--sm"
                onClick={() => { setShowSchedulePopup(false); setShowCalendarPopup(true) }}
              >
                <Calendar size={14} /> Event Calendar
              </button>
              <button
                className="ld-btn ld-btn--primary ld-btn--sm"
                onClick={() => { setShowSchedulePopup(false); navigate('/schedule') }}
              >
                Full City Schedule <ArrowRight size={14} />
              </button>
            </div>
          </div>
        </>
      )}

      {/* ════════ CALENDAR POPUP (ENGLISH) ════════ */}
      {showCalendarPopup && (
        <>
          <div className="ld-modal-bd" onClick={() => setShowCalendarPopup(false)} />
          <div className="ld-cal-modal" role="dialog" aria-modal aria-label="Event Calendar">
            <div className="ld-modal-handle" />

            <div className="ld-sched-modal__header">
              <div>
                <div className="ld-eyebrow" style={{ marginBottom: 6 }}>
                  <span className="ld-eyebrow__dot" /> Waste Impact Forecast
                </div>
                <h2 className="ld-sched-modal__title">Municipal Event Calendar</h2>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {!isOnline && <span className="ld-cached">CACHED</span>}
                <button
                  className="ld-modal-close"
                  onClick={() => setShowCalendarPopup(false)}
                  aria-label="Close"
                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="ld-cal-modal__body">
              <OfflineEventCalendar
                onSelectBarangay={(brgy) => {
                  const clean = cleanZoneName(brgy)
                  setSelectedBarangay(clean)
                  setShowCalendarPopup(false)
                  setShowSchedulePopup(true)
                }}
              />
            </div>

            <div className="ld-sched-modal__footer">
              <button
                className="ld-btn ld-btn--outline ld-btn--sm"
                onClick={() => { setShowCalendarPopup(false); setShowSchedulePopup(true) }}
              >
                ← View Schedule
              </button>
              <button
                className="ld-btn ld-btn--primary ld-btn--sm"
                onClick={() => { setShowCalendarPopup(false); navigate('/public-map') }}
              >
                Explore Public Map <ArrowRight size={14} />
              </button>
            </div>
          </div>
        </>
      )}

      {/* ════════ REPORT MAP PREVIEW MODAL ════════ */}
      {showReportMap && (
        <>
          <div className="ld-modal-bd" onClick={() => setShowReportMap(null)} />
          <div className="ld-sched-modal" role="dialog" aria-modal style={{ paddingBottom: 20 }}>
            <div className="ld-modal-handle" />
            <div className="ld-sched-modal__header" style={{ marginBottom: 12 }}>
              <div>
                <div className="ld-eyebrow" style={{ marginBottom: 6 }}>
                  <span className="ld-eyebrow__dot" /> Report Location Preview
                </div>
                <h2 className="ld-sched-modal__title">
                  {(showReportMap.issue_type || 'Waste').charAt(0).toUpperCase() + (showReportMap.issue_type || 'waste').slice(1)} Incident
                </h2>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  className="ld-modal-close"
                  onClick={() => setShowReportMap(null)}
                  aria-label="Close"
                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div style={{ padding: '0 20px', marginBottom: 16 }}>
              <div style={{ fontSize: 13, color: 'var(--ld-text-3)', marginBottom: 12 }}>
                Static offline map preview of your reported incident coordinates.
              </div>

              <div style={{ width: '100%', height: 220, borderRadius: 12, overflow: 'hidden', background: '#0f172a', position: 'relative' }}>
                <HeroOfflineMapSnapshot
                  hotspots={[{ ...showReportMap, lat: showReportMap.location.lat, lng: showReportMap.location.lng }]}
                  isOnline={isOnline}
                />
              </div>
            </div>

            <div className="ld-sched-modal__footer">
              <button className="ld-btn ld-btn--primary" style={{ width: '100%', justifyContent: 'center' }} onClick={() => setShowReportMap(null)}>
                Close Preview
              </button>
            </div>
          </div>
        </>
      )}

      {/* ════════ FLOATING QUICK REPORT BUTTON ════════ */}
      <QuickReport />
    </div>
  )
}
