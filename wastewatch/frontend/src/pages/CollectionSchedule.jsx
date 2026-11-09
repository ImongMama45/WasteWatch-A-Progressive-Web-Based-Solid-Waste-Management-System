/**
 * CollectionSchedule.jsx — Waste Collection Schedule & Interactive Map Overview
 * -------------------------------------------------------------------------------
 * Route: /schedule
 *
 * Side-by-side layout:
 *  - Left: Meta Business Suite Schedule Management
 *    • Monthly Collection Calendar with collection indicators and day filtering
 *    • Today's Active Collection hero card with schedule window, assigned driver,
 *      truck plate, and destination dumpsite
 *    • Weekly Collection Routes cards with driver, truck, dumpsite, and expandable stops
 *  - Right: Sticky Interactive Barangay Territory Map Overview
 *    • Esri World Dark Gray Base (Clean, high-contrast, NO API keys, NO watermarks!)
 *    • All Lucena barangays rendered in rich forest green polygons (#1e7e34)
 *    • Selected/active barangay dynamically highlighted in warm golden amber (#d97706)
 *    • Dual-ring centroid bullseye pin matching territory reference image
 *    • City Overview vs. Focus Barangay view mode toggle
 *    • Comprehensive Active Barangay Detail Panel with Driver, Truck, and Schedule info
 *  - Two-way interaction:
 *    • Clicking a route or dropdown highlights and centers that barangay
 *    • Clicking a barangay polygon on the map filters and focuses the schedule
 *  - STRICT ICONOGRAPHY: ZERO emojis in UI or code; SVG icons only.
 */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import Navbar from '../components/Navbar'
import BottomNav from '../components/BottomNav'
import api from '../api/client'
import { loadLeaflet } from '../api/leaflet'
import { CalendarSkeleton, SidebarWidgetSkeleton, FeedCardSkeleton, MapSkeleton } from '../components/ui/Skeleton'
import { useCalendarEntries } from '../hooks/useCalendarEntries'
import { formatToManilaDateString } from '../api/calendarService'

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]

const LUCENA_CENTER = [13.9373, 121.617]

// Parse the backend "days" string (e.g. "Mon, Wed, Fri") into day-of-week numbers
function parseDayNums(daysStr = '') {
  const MAP = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }
  return String(daysStr)
    .split(/[\s,]+/)
    .map(d => MAP[d.toLowerCase().slice(0, 3)])
    .filter(n => n != null && !isNaN(n))
}

function fmt12(timeStr) {
  if (!timeStr) return '—'
  const [hStr, mStr] = timeStr.split(':')
  const h = parseInt(hStr, 10), m = mStr || '00'
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return `${h12}:${m} ${ampm}`
}

function formatDisplayDate(dateStr) {
  if (!dateStr) return ''
  const [y, m, d] = dateStr.split('-').map(Number)
  const dateObj = new Date(y, m - 1, d)
  return dateObj.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function buildCalendar(month, year) {
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  return cells
}

function normalizeBarangayName(name = '') {
  return String(name)
    .toLowerCase()
    .replace(/^barangay\s+/i, '')
    .replace(/\s*\(pob\.?\)/i, '')
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isBarangayMatch(nameA = '', nameB = '') {
  if (!nameA || !nameB) return false
  const a = normalizeBarangayName(nameA)
  const b = normalizeBarangayName(nameB)
  if (!a || !b) return false
  if (a === b) return true
  const isNumA = /^\d+$/.test(a)
  const isNumB = /^\d+$/.test(b)
  if (isNumA || isNumB) {
    return a === b
  }
  return a.includes(b) || b.includes(a)
}

function collectCoordinates(geometry) {
  const points = []
  const walk = value => {
    if (!Array.isArray(value)) return
    if (typeof value[0] === 'number' && typeof value[1] === 'number') {
      points.push([value[1], value[0]])
      return
    }
    value.forEach(walk)
  }
  walk(geometry?.coordinates)
  return points
}

function getPolygonCentroid(feature) {
  const points = collectCoordinates(feature?.geometry)
  if (!points.length) return LUCENA_CENTER
  const sum = points.reduce((acc, [lat, lng]) => [acc[0] + lat, acc[1] + lng], [0, 0])
  return [sum[0] / points.length, sum[1] / points.length]
}

// ─── SVG ICONS (STRICTLY NO EMOJIS) ───────────────────────────────────────────

const SvgCalendar = ({ size = 16, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
)

const SvgClock = ({ size = 15, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
)

const SvgMapPin = ({ size = 15, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
)

const SvgTruck = ({ size = 16, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="3" width="15" height="13" rx="1" />
    <path d="M16 8h4l3 5v3h-7V8z" />
    <circle cx="5.5" cy="18.5" r="2.5" />
    <circle cx="18.5" cy="18.5" r="2.5" />
  </svg>
)

const SvgUser = ({ size = 15, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
)

const SvgDumpsite = ({ size = 15, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 3l4 8 5-5 5 15H2L8 3z" />
  </svg>
)

const SvgSearch = ({ size = 14, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
)

const SvgRefresh = ({ size = 14, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
  </svg>
)

const SvgChevronDown = ({ size = 14, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
)

const SvgChevronLeft = ({ size = 14, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6" />
  </svg>
)

const SvgChevronRight = ({ size = 14, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
)

const SvgCheck = ({ size = 14, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
)

const SvgCompass = ({ size = 14, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
  </svg>
)

const SvgMaximize = ({ size = 14, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 3 21 3 21 9" />
    <polyline points="9 21 3 21 3 15" />
    <line x1="21" y1="3" x2="14" y2="10" />
    <line x1="3" y1="21" x2="10" y2="14" />
  </svg>
)

const SvgInfo = ({ size = 14, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>
)

// ─── COMPONENT ────────────────────────────────────────────────────────────────

export default function CollectionSchedule() {
  const { user, barangays } = useAuth()
  const userBarangay = user?.barangay_name || user?.barangay?.name || ''

  // ── Schedules Data (Operational endpoint) ──
  const [schedules, setSchedules] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expandedId, setExpandedId] = useState(null)

  // ── Filters & Selection ──
  // Default to userBarangay if it has routes, or 'Isabang'
  const [selectedBarangay, setSelectedBarangay] = useState(userBarangay || 'Isabang')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedDow, setSelectedDow] = useState(null) // null = all days, 0-6 = specific day
  const [selectedDateStr, setSelectedDateStr] = useState(null) // 'YYYY-MM-DD' or null

  // ── Calendar Month/Year ──
  const today = new Date()
  const [calMonth, setCalMonth] = useState(today.getMonth())
  const [calYear, setCalYear] = useState(today.getFullYear())

  // Resolve integer barangayId for Calendar Service API
  const selectedBrgyObj = useMemo(() => {
    if (!selectedBarangay || !Array.isArray(barangays)) return null
    return barangays.find(b => isBarangayMatch(b.name, selectedBarangay)) || null
  }, [selectedBarangay, barangays])

  const selectedBarangayId = selectedBrgyObj?.id ?? null

  // Calculate calendar month date boundaries in Asia/Manila format (at most 31 days)
  const { startOfMonthStr, endOfMonthStr } = useMemo(() => {
    const startD = new Date(calYear, calMonth, 1)
    const endD = new Date(calYear, calMonth + 1, 0)
    return {
      startOfMonthStr: formatToManilaDateString(startD),
      endOfMonthStr: formatToManilaDateString(endD),
    }
  }, [calMonth, calYear])

  // Unified Calendar Service: date-based collection schedule occurrences
  const {
    entries: calendarOccurrences,
    loading: calendarLoading,
    error: calendarError,
    refresh: refreshCalendar,
    isRefreshing: calendarRefreshing,
    isFromCache: isCalendarFromCache,
    isStale: isCalendarStale,
    isCapacityError: isCalendarCapacityError,
    isNetworkError: isCalendarNetworkError,
  } = useCalendarEntries({
    startDate: startOfMonthStr,
    endDate: endOfMonthStr,
    barangayId: selectedBarangayId,
    source: 'collection_schedule',
    paginate: false,
    autoFetch: true,
  })

  // Group occurrences by occurrence date string ('YYYY-MM-DD')
  const occurrencesByDate = useMemo(() => {
    const map = new Map()
    if (!Array.isArray(calendarOccurrences)) return map

    for (const entry of calendarOccurrences) {
      if (!entry) continue
      const dateStr = (entry.start_datetime || entry.start || '').slice(0, 10)
      if (!dateStr) continue

      if (!map.has(dateStr)) {
        map.set(dateStr, [])
      }
      map.get(dateStr).push(entry)
    }
    return map
  }, [calendarOccurrences])

  const activeDateOccurrences = useMemo(() => {
    if (!selectedDateStr) return []
    return occurrencesByDate.get(selectedDateStr) || []
  }, [selectedDateStr, occurrencesByDate])

  const todayDateStr = useMemo(() => formatToManilaDateString(today), [today])
  const todayOccurrences = useMemo(() => occurrencesByDate.get(todayDateStr) || [], [todayDateStr, occurrencesByDate])
  const todayOccurrence = todayOccurrences[0] || null

  const handleDayClick = useCallback((day, dow, cellDateStr) => {
    if (selectedDateStr === cellDateStr) {
      setSelectedDateStr(null)
      setSelectedDow(null)
    } else {
      setSelectedDateStr(cellDateStr)
      setSelectedDow(dow)
    }
  }, [selectedDateStr])

  // ── Map State & Refs ──
  const mapContainerRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const geoLayerRef = useRef(null)
  const centroidMarkerRef = useRef(null)
  const [geoData, setGeoData] = useState(null)
  const [mapLoaded, setMapLoaded] = useState(false)
  const [mapViewMode, setMapViewMode] = useState('overview') // 'overview' | 'focus'

  // ── 1. Fetch Sanitized Public Schedules ──
  useEffect(() => {
    setLoading(true)
    api.get('/api/public/schedule/')
      .then(res => {
        const raw = Array.isArray(res.data)
          ? res.data
          : Array.isArray(res.data?.results)
          ? res.data.results
          : []
        setSchedules(raw)

        // If user's barangay has routes, keep it; otherwise if user has no routes, default to first route's barangay
        if (raw.length > 0) {
          const hasUserRoute = userBarangay && raw.some(r => isBarangayMatch(`${r.area || ''} ${r.barangay_names || ''}`, userBarangay))
          if (!hasUserRoute) {
            const firstArea = raw[0].barangay_names || raw[0].area || ''
            const firstClean = firstArea.split(',')[0].trim()
            if (firstClean) setSelectedBarangay(firstClean)
          }
        }
      })
      .catch(() => setError('Could not load schedules. Please check connection and try again.'))
      .finally(() => setLoading(false))
  }, [userBarangay])

  // ── 2. Fetch GeoJSON Boundaries ──
  useEffect(() => {
    fetch('/data/lucena_barangays.geojson')
      .then(r => r.json())
      .then(data => setGeoData(data))
      .catch(err => console.error('Failed to load lucena_barangays.geojson:', err))
  }, [])

  // ── 3. Initialize Leaflet Map (Safe React 18 Lifecycle) ──
  useEffect(() => {
    let isMounted = true

    loadLeaflet().then(L => {
      if (!isMounted || !mapContainerRef.current) return

      // Clean up previous instance or stale leaflet DOM flag
      if (mapInstanceRef.current) {
        try {
          mapInstanceRef.current.stop()
          mapInstanceRef.current.remove()
        } catch { /* ignore */ }
        mapInstanceRef.current = null
      }

      if (mapContainerRef.current._leaflet_id) {
        delete mapContainerRef.current._leaflet_id
      }

      const map = L.map(mapContainerRef.current, {
        center: LUCENA_CENTER,
        zoom: 12.4,
        zoomSnap: 0.1,
        zoomControl: true,
        attributionControl: false,
      })

      // Clean dark canvas tile layer without API keys or watermarks (Esri World Dark Gray)
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 16,
      }).addTo(map)

      mapInstanceRef.current = map
      setMapLoaded(true)

      setTimeout(() => {
        if (isMounted && mapInstanceRef.current) {
          mapInstanceRef.current.invalidateSize()
        }
      }, 250)
    })

    return () => {
      isMounted = false
      if (mapInstanceRef.current) {
        try {
          mapInstanceRef.current.stop()
          mapInstanceRef.current.remove()
        } catch { /* ignore */ }
        mapInstanceRef.current = null
      }
      if (mapContainerRef.current && mapContainerRef.current._leaflet_id) {
        delete mapContainerRef.current._leaflet_id
      }
      geoLayerRef.current = null
      centroidMarkerRef.current = null
      setMapLoaded(false)
    }
  }, [])

  // ── 4. Render GeoJSON Polygons & Centroid Marker ──
  const updateMapLayers = useCallback(() => {
    const map = mapInstanceRef.current
    if (!map || !window.L || !geoData) return
    const L = window.L

    // Stop any in-flight animations before layer manipulation
    try {
      map.stop()
    } catch { /* ignore */ }

    // Remove existing layers
    if (geoLayerRef.current) {
      try {
        map.removeLayer(geoLayerRef.current)
      } catch { /* ignore */ }
      geoLayerRef.current = null
    }
    if (centroidMarkerRef.current) {
      try {
        map.removeLayer(centroidMarkerRef.current)
      } catch { /* ignore */ }
      centroidMarkerRef.current = null
    }

    let selectedFeature = null
    let selectedLayerBounds = null

    const geoLayer = L.geoJSON(geoData, {
      style: feature => {
        const fName = feature.properties?.brgy_name || feature.properties?.name || ''
        const isMatch = isBarangayMatch(fName, selectedBarangay)

        if (isMatch) {
          selectedFeature = feature
          return {
            fillColor: '#d97706', // warm amber/orange matching user's image
            fillOpacity: 0.90,
            color: '#b45309',
            weight: 2.5,
          }
        }

        // Standard Lucena City barangays in green matching reference image
        return {
          fillColor: '#1e7e34', // solid forest green
          fillOpacity: 0.82,
          color: '#0f3d18',
          weight: 1.5,
        }
      },
      onEachFeature: (feature, layer) => {
        const bName = feature.properties?.brgy_name || feature.properties?.name || 'Barangay'
        layer.bindTooltip(`<strong>${bName}</strong>`, {
          direction: 'center',
          className: 'sched-map-tooltip',
          permanent: false,
        })

        layer.on('click', () => {
          setSelectedBarangay(bName)
        })

        layer.on('mouseover', () => {
          const isMatch = isBarangayMatch(bName, selectedBarangay)
          if (!isMatch) {
            layer.setStyle({ fillOpacity: 0.95, weight: 2.2, color: '#4ade80' })
          }
        })

        layer.on('mouseout', () => {
          const isMatch = isBarangayMatch(bName, selectedBarangay)
          if (!isMatch) {
            layer.setStyle({ fillOpacity: 0.82, weight: 1.5, color: '#0f3d18' })
          }
        })
      },
    }).addTo(map)

    geoLayerRef.current = geoLayer

    // If an active barangay polygon was found, add centroid marker
    if (selectedFeature) {
      const centroid = getPolygonCentroid(selectedFeature)

      // Dual-ring bullseye centroid marker matching the user's reference image
      const centroidIcon = L.divIcon({
        className: 'sched-centroid-icon',
        html: `
          <div style="position:relative;width:32px;height:32px;display:flex;align-items:center;justify-content:center;">
            <!-- Outer pulsing glow halo -->
            <div style="
              position: absolute; inset: 0; border-radius: 50%;
              background: rgba(245, 158, 11, 0.25);
              border: 2px solid rgba(255, 255, 255, 0.7);
              animation: schedCentroidPulse 2.2s infinite ease-out;
            "></div>
            <!-- Middle white rim ring -->
            <div style="
              position: absolute; width: 22px; height: 22px; border-radius: 50%;
              background: rgba(217, 119, 6, 0.35);
              border: 2px solid #ffffff;
              box-shadow: 0 0 8px rgba(245, 158, 11, 0.8);
            "></div>
            <!-- Inner solid orange core -->
            <div style="
              width: 12px; height: 12px; border-radius: 50%;
              background: #ea580c;
              border: 2px solid #ffffff;
              box-shadow: 0 2px 5px rgba(0,0,0,0.5);
              position: relative; z-index: 2;
            "></div>
          </div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      })

      centroidMarkerRef.current = L.marker(centroid, {
        icon: centroidIcon,
        interactive: false,
      }).addTo(map)

      // Calculate bounds of matching layer
      geoLayer.eachLayer(l => {
        const lName = l.feature?.properties?.brgy_name || l.feature?.properties?.name || ''
        if (isBarangayMatch(lName, selectedBarangay)) {
          selectedLayerBounds = l.getBounds()
        }
      })

      try {
        if (mapViewMode === 'focus' && selectedLayerBounds) {
          map.fitBounds(selectedLayerBounds, { padding: [40, 40], maxZoom: 14, animate: false })
        } else {
          // Overview mode: Keep full Lucena City in view with slight smooth pan toward centroid
          map.setView(centroid, 12.4, { animate: false })
        }
      } catch { /* ignore animation errors */ }
    } else {
      try {
        map.fitBounds(geoLayer.getBounds(), { padding: [16, 16], animate: false })
      } catch { /* ignore */ }
    }
  }, [geoData, selectedBarangay, mapViewMode])

  useEffect(() => {
    if (mapLoaded && geoData) {
      updateMapLayers()
    }
  }, [mapLoaded, geoData, updateMapLayers])

  // Reset Map View to citywide overview
  const handleResetToCityOverview = () => {
    setMapViewMode('overview')
    if (mapInstanceRef.current && geoLayerRef.current) {
      try {
        mapInstanceRef.current.stop()
        mapInstanceRef.current.fitBounds(geoLayerRef.current.getBounds(), { padding: [20, 20], animate: false })
      } catch { /* ignore */ }
    }
  }

  // Focus directly into selected barangay
  const handleFocusSelectedBarangay = () => {
    setMapViewMode('focus')
    if (mapInstanceRef.current && geoLayerRef.current) {
      let bBounds = null
      geoLayerRef.current.eachLayer(l => {
        const lName = l.feature?.properties?.brgy_name || l.feature?.properties?.name || ''
        if (isBarangayMatch(lName, selectedBarangay)) {
          bBounds = l.getBounds()
        }
      })
      if (bBounds) {
        try {
          mapInstanceRef.current.stop()
          mapInstanceRef.current.fitBounds(bBounds, { padding: [40, 40], maxZoom: 14, animate: false })
        } catch { /* ignore */ }
      }
    }
  }

  // ── Schedules Filtering ──
  const todayDow = today.getDay() // 0-6
  const todayFull = DAYS_FULL[todayDow]

  // All schedules relevant to the selected barangay (for the territory detail card)
  const activeBarangaySchedules = useMemo(() => {
    if (!selectedBarangay) return []
    return schedules.filter(s => {
      const areaStr = `${s.area || ''} ${s.barangay_names || ''}`
      return isBarangayMatch(areaStr, selectedBarangay)
    })
  }, [schedules, selectedBarangay])

  // Filtered list of schedules:
  // If selectedBarangay has matches, show them.
  // If selectedBarangay has NO matches, show all schedules so user is never stuck on 0 routes!
  const hasSpecificBarangayRoutes = activeBarangaySchedules.length > 0

  const filteredSchedules = useMemo(() => {
    return schedules.filter(s => {
      // 1. Barangay filter (only apply if the selected barangay actually has routes)
      if (selectedBarangay && hasSpecificBarangayRoutes) {
        const areaStr = `${s.area || ''} ${s.barangay_names || ''} ${s.zone || ''}`
        if (!isBarangayMatch(areaStr, selectedBarangay)) return false
      }

      // 2. Date or Day of week filter (if selected from calendar)
      // CRITICAL DATE-INTEGRITY RECONCILIATION:
      // When a specific calendar date is selected, we MUST NOT fall back to recurring weekday matching.
      // The Calendar Service occurrence list is authoritative for date-specific scheduled collections.
      if (selectedDateStr) {
        const dateOccs = occurrencesByDate.get(selectedDateStr) || []
        if (dateOccs.length === 0) {
          return false
        }
        const hasMatchingOcc = dateOccs.some(occ => occ.source_id === s.id)
        if (!hasMatchingOcc) return false
      } else if (selectedDow !== null) {
        // Fallback only applies when a user clicked a day-of-week button directly without a specific calendar date
        const nums = parseDayNums(s.days || '')
        const daysLower = (s.days || '').toLowerCase()
        const targetDayShort = DAYS_SHORT[selectedDow].toLowerCase()
        if (!nums.includes(selectedDow) && !daysLower.includes(targetDayShort)) return false
      }

      // 3. Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const matchArea = (s.area || '').toLowerCase().includes(q)
        const matchBrgy = (s.barangay_names || '').toLowerCase().includes(q)
        const matchStops = Array.isArray(s.stops) && s.stops.some(st => (st.label || '').toLowerCase().includes(q))
        if (!matchArea && !matchBrgy && !matchStops) return false
      }

      return true
    })
  }, [schedules, selectedBarangay, hasSpecificBarangayRoutes, selectedDateStr, selectedDow, occurrencesByDate, searchQuery])

  // CRITICAL DATE-INTEGRITY RECONCILIATION:
  // Today's active collection hero card must be derived strictly from confirmed Calendar Service occurrences for today.
  // It must NEVER invent an active collection from a template's recurring days string.
  const todaySchedule = useMemo(() => {
    if (!todayOccurrence) return null

    const matched = schedules.find(s => s.id === todayOccurrence.source_id)
    if (matched) return matched

    return {
      id: todayOccurrence.source_id,
      area: todayOccurrence.location || todayOccurrence.title,
      barangay_names: todayOccurrence.location,
      days: todayOccurrence.metadata?.frequency || 'Today',
      start_time: todayOccurrence.start_datetime ? todayOccurrence.start_datetime.slice(11, 19) : null,
      end_time: todayOccurrence.end_datetime ? todayOccurrence.end_datetime.slice(11, 19) : null,
      total_stops: todayOccurrence.metadata?.total_stops || 0,
      stops: [],
      lifecycle_status: todayOccurrence.metadata?.schedule_lifecycle || 'PENDING',
    }
  }, [todayOccurrence, schedules])

  // Unique collection days across visible schedules
  const collectionDayNums = useMemo(() => {
    return [...new Set(schedules.flatMap(s => parseDayNums(s.days || '')))]
  }, [schedules])

  const calendarCells = useMemo(() => buildCalendar(calMonth, calYear), [calMonth, calYear])

  // Extract unique barangay options from schedules and GeoJSON
  const barangayOptions = useMemo(() => {
    const set = new Set()
    schedules.forEach(s => {
      if (s.barangay_names) {
        s.barangay_names.split(',').forEach(b => set.add(b.trim()))
      }
      if (s.area) set.add(s.area.trim())
    })
    if (geoData?.features) {
      geoData.features.forEach(f => {
        const n = f.properties?.brgy_name || f.properties?.name
        if (n) set.add(n)
      })
    }
    return Array.from(set).filter(Boolean).sort()
  }, [schedules, geoData])

  return (
    <div style={{ background: '#f0f2f5', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Navbar />

      <style>{`
        @keyframes schedFade {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes schedCentroidPulse {
          0%   { transform: scale(0.9); opacity: 0.9; }
          70%  { transform: scale(2.2); opacity: 0; }
          100% { transform: scale(2.4); opacity: 0; }
        }

        .sched-root-container {
          max-width: 1420px;
          margin: 0 auto;
          padding: 24px 28px 48px;
          width: 100%;
          box-sizing: border-box;
        }

        /* ── Meta Business Suite Cards ── */
        .sched-card {
          background: #ffffff;
          border: 1px solid #e4e6eb;
          border-radius: 8px;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
          overflow: hidden;
          margin-bottom: 18px;
          transition: box-shadow 0.15s ease, border-color 0.15s ease;
        }

        .sched-card-header {
          padding: 14px 18px;
          border-bottom: 1px solid #e4e6eb;
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: #ffffff;
          flex-wrap: wrap;
          gap: 10px;
        }

        .sched-title {
          font-size: 15px;
          font-weight: 700;
          color: #1c1e21;
          margin: 0;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .sched-subtitle {
          font-size: 12px;
          color: #65676b;
          margin: 2px 0 0 0;
        }

        /* ── Split Layout Grid ── */
        .sched-split-layout {
          display: grid;
          grid-template-columns: 1fr 470px;
          gap: 22px;
          align-items: start;
        }

        @media (max-width: 1140px) {
          .sched-split-layout {
            grid-template-columns: 1fr 410px;
          }
        }

        @media (max-width: 960px) {
          .sched-split-layout {
            grid-template-columns: 1fr;
          }
        }

        /* ── Action Buttons ── */
        .sched-btn-primary {
          background: #16a34a;
          color: #ffffff;
          border: 1px solid #15803d;
          font-size: 12px;
          font-weight: 700;
          padding: 7px 14px;
          border-radius: 6px;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          cursor: pointer;
          transition: background 0.15s, transform 0.1s;
        }
        .sched-btn-primary:hover { background: #15803d; }
        .sched-btn-primary:active { transform: scale(0.98); }

        .sched-btn-secondary {
          background: #ffffff;
          color: #1c1e21;
          border: 1px solid #ccd0d5;
          font-size: 12px;
          font-weight: 600;
          padding: 6px 12px;
          border-radius: 6px;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          cursor: pointer;
          transition: background 0.15s, border-color 0.15s;
        }
        .sched-btn-secondary:hover { background: #f2f3f5; border-color: #bec3c9; }

        .sched-btn-toggle {
          background: #f0f2f5;
          border: 1px solid #e4e6eb;
          color: #4b5563;
          font-size: 11px;
          font-weight: 700;
          padding: 5px 10px;
          border-radius: 6px;
          display: inline-flex;
          align-items: center;
          gap: 5px;
          cursor: pointer;
          transition: all 0.12s ease;
        }
        .sched-btn-toggle.active {
          background: #16a34a;
          color: #ffffff;
          border-color: #15803d;
        }

        /* ── Day Badges & Pills ── */
        .sched-pill {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 3px 8px;
          border-radius: 4px;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }

        /* ── Route Card ── */
        .sched-route-card {
          border: 1px solid #e4e6eb;
          border-radius: 8px;
          background: #ffffff;
          padding: 16px 18px;
          margin-bottom: 12px;
          transition: all 0.15s ease;
          cursor: pointer;
          position: relative;
        }
        .sched-route-card:hover {
          border-color: #16a34a;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.06);
          background: #fafbfc;
        }
        .sched-route-card.selected {
          border-color: #16a34a;
          border-left: 4px solid #16a34a;
          background: #f8fafc;
        }

        /* ── Detail Chips inside Route Card ── */
        .sched-detail-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          border-radius: 6px;
          background: #f0f2f5;
          color: #4b5563;
          font-size: 12px;
          font-weight: 600;
          border: 1px solid #e4e6eb;
        }

        /* ── Map Tooltip ── */
        .sched-map-tooltip {
          background: rgba(15, 23, 42, 0.94) !important;
          color: #ffffff !important;
          border: 1px solid rgba(245, 158, 11, 0.5) !important;
          border-radius: 6px !important;
          font-size: 11px !important;
          font-weight: 700 !important;
          padding: 4px 10px !important;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3) !important;
        }
        .sched-map-tooltip::before {
          border-top-color: rgba(15, 23, 42, 0.94) !important;
        }

        /* ── Sticky Sidebar Map ── */
        .sched-sticky-map {
          position: sticky;
          top: 80px;
        }
      `}</style>

      <div className="sched-root-container">

        {/* ══════════════════════════════════════════════════════════════
            1. PAGE HEADER (Meta Business Suite Style with Territory Bar)
        ══════════════════════════════════════════════════════════════ */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
          <div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span className="sched-pill" style={{ background: '#e7f5eb', color: '#15803d', border: '1px solid #bbf7d0' }}>
                OFFICIAL SCHEDULE
              </span>
              <span className="sched-pill" style={{ background: '#ffffff', color: '#4b5563', border: '1px solid #e4e6eb' }}>
                <SvgMapPin size={11} /> Lucena City SWMO
              </span>
            </div>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1c1e21', margin: '0 0 4px', letterSpacing: '-0.02em' }}>
              Collection Schedule &amp; Territory Overview
            </h1>
            <p style={{ fontSize: 13, color: '#65676b', margin: 0 }}>
              Live solid waste collection schedule, assigned drivers, and interactive territory map.
            </p>
          </div>

          {/* Quick Territory Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: '#ffffff', padding: '6px 10px', borderRadius: 8, border: '1px solid #e4e6eb', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#4b5563', display: 'flex', alignItems: 'center', gap: 5 }}>
              <SvgMapPin size={14} color="#16a34a" /> Viewing Territory:
            </span>

            <div style={{ position: 'relative' }}>
              <select
                value={selectedBarangay}
                onChange={e => setSelectedBarangay(e.target.value)}
                style={{
                  background: '#f8fafc',
                  border: '1px solid #ccd0d5',
                  borderRadius: 6,
                  padding: '6px 30px 6px 10px',
                  fontSize: 12,
                  fontWeight: 700,
                  color: '#1c1e21',
                  cursor: 'pointer',
                  appearance: 'none',
                  outline: 'none',
                  minWidth: 160,
                }}
              >
                <option value="">All Lucena City</option>
                {barangayOptions.map(b => (
                  <option key={b} value={b}>
                    {b} {userBarangay && b.toLowerCase() === userBarangay.toLowerCase() ? '(My Area)' : ''}
                  </option>
                ))}
              </select>
              <div style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#65676b' }}>
                <SvgChevronDown size={13} />
              </div>
            </div>

            {selectedBarangay && (
              <button
                className="sched-btn-secondary"
                onClick={() => setSelectedBarangay('')}
                style={{ padding: '5px 8px', fontSize: 11 }}
                title="View All Lucena City"
              >
                Show All
              </button>
            )}
          </div>
        </div>

        {/* ══════════════════════════════════════════════════════════════
            2. SPLIT LAYOUT: SCHEDULE DETAILS (LEFT) + MAP (RIGHT)
        ══════════════════════════════════════════════════════════════ */}
        <div className="sched-split-layout">

          {/* ────────────────────────────────────────────────────────────
              LEFT COLUMN: CALENDAR, TODAY'S PICKUP, WEEKLY ROUTES
          ──────────────────────────────────────────────────────────── */}
          <div>

            {/* ── CARD A: MONTHLY COLLECTION CALENDAR ── */}
            {loading ? (
              <div style={{ marginBottom: 18 }}>
                <CalendarSkeleton />
              </div>
            ) : (
            <div className="sched-card ww-fade-in">
              <div className="sched-card-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button
                    onClick={() => {
                      if (calMonth === 0) {
                        setCalMonth(11)
                        setCalYear(y => y - 1)
                      } else setCalMonth(m => m - 1)
                    }}
                    style={{ background: '#f0f2f5', border: '1px solid #e4e6eb', borderRadius: 6, width: 28, height: 28, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    title="Previous month"
                  >
                    <SvgChevronLeft size={14} color="#1c1e21" />
                  </button>
                  <span style={{ fontWeight: 700, fontSize: 14, color: '#1c1e21' }}>
                    {MONTHS[calMonth]} {calYear}
                  </span>
                  <button
                    onClick={() => {
                      if (calMonth === 11) {
                        setCalMonth(0)
                        setCalYear(y => y + 1)
                      } else setCalMonth(m => m + 1)
                    }}
                    style={{ background: '#f0f2f5', border: '1px solid #e4e6eb', borderRadius: 6, width: 28, height: 28, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    title="Next month"
                  >
                    <SvgChevronRight size={14} color="#1c1e21" />
                  </button>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 11, color: '#65676b', flexWrap: 'wrap' }}>
                  {isCalendarStale && (
                    <span className="sched-pill" style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' }}>
                      Offline Cache
                    </span>
                  )}
                  <button
                    onClick={refreshCalendar}
                    disabled={calendarRefreshing}
                    style={{
                      background: '#f0f2f5',
                      border: '1px solid #e4e6eb',
                      borderRadius: 6,
                      width: 26,
                      height: 26,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                    title="Refresh calendar entries"
                  >
                    <SvgRefresh size={12} color={calendarRefreshing ? '#16a34a' : '#1c1e21'} />
                  </button>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#e7f5eb', border: '2px solid #16a34a' }} />
                    <span>Today</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <div style={{ width: 10, height: 10, borderRadius: 2, background: '#f0fdf4', border: '1px solid #bbf7d0' }} />
                    <span>Collection Day</span>
                  </div>
                  {(selectedDow !== null || selectedDateStr !== null) && (
                    <button
                      onClick={() => { setSelectedDow(null); setSelectedDateStr(null); }}
                      style={{ background: 'none', border: 'none', color: '#16a34a', fontWeight: 700, cursor: 'pointer', fontSize: 11, padding: 0 }}
                    >
                      Show All Days
                    </button>
                  )}
                </div>
              </div>

              <div style={{ padding: '14px 18px' }}>
                {isCalendarCapacityError && (
                  <div style={{ background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 6, padding: '8px 12px', marginBottom: 12, fontSize: 12, color: '#92400e', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <SvgInfo size={14} color="#d97706" />
                    <span>Calendar capacity limit reached. Showing active operational routes below.</span>
                  </div>
                )}
                {isCalendarNetworkError && !isCalendarFromCache && (
                  <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '8px 12px', marginBottom: 12, fontSize: 12, color: '#991b1b', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Could not load live calendar occurrences. Check your network connection.</span>
                    <button className="sched-btn-secondary" onClick={refreshCalendar} style={{ fontSize: 11, padding: '3px 8px' }}>
                      Retry
                    </button>
                  </div>
                )}

                {/* Calendar Days Header */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 6 }}>
                  {DAYS_SHORT.map((d, idx) => (
                    <div
                      key={d}
                      onClick={() => {
                        setSelectedDateStr(null)
                        setSelectedDow(selectedDow === idx ? null : idx)
                      }}
                      style={{
                        textAlign: 'center',
                        fontSize: 10,
                        fontWeight: 800,
                        color: selectedDow === idx && !selectedDateStr ? '#16a34a' : '#65676b',
                        padding: '4px 0',
                        cursor: 'pointer',
                        borderRadius: 4,
                        background: selectedDow === idx && !selectedDateStr ? '#e7f5eb' : 'transparent',
                        textTransform: 'uppercase',
                        letterSpacing: '.04em',
                      }}
                      title={`Filter by ${d}`}
                    >
                      {d}
                    </div>
                  ))}
                </div>

                {/* Calendar Date Cells */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
                  {calendarCells.map((day, idx) => {
                    if (!day) return <div key={`e${idx}`} />
                    const cellDate = new Date(calYear, calMonth, day)
                    const dow = cellDate.getDay()
                    const isToday = day === today.getDate() && calMonth === today.getMonth() && calYear === today.getFullYear()
                    const cellDateStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                    const dayOccurrences = occurrencesByDate.get(cellDateStr) || []
                    const hasOccurrences = dayOccurrences.length > 0
                    const hasPickup = hasOccurrences || (calendarLoading && occurrencesByDate.size === 0 && collectionDayNums.includes(dow))
                    const isSelectedDate = selectedDateStr === cellDateStr
                    const isDowFiltered = !selectedDateStr && selectedDow !== null && selectedDow === dow

                    const isVerifiedCollected = dayOccurrences.some(o => o.status === 'verified_collected')
                    const isInProgress = dayOccurrences.some(o => o.status === 'in_progress')

                    return (
                      <div
                        key={cellDateStr}
                        onClick={() => handleDayClick(day, dow, cellDateStr)}
                        style={{
                          textAlign: 'center',
                          padding: '7px 2px',
                          borderRadius: 6,
                          fontSize: 12,
                          fontWeight: isSelectedDate ? 800 : isToday ? 800 : hasPickup ? 700 : 500,
                          cursor: 'pointer',
                          background: isSelectedDate
                            ? '#15803d'
                            : isToday
                            ? '#e7f5eb'
                            : isDowFiltered
                            ? '#fef3c7'
                            : hasPickup
                            ? '#f0fdf4'
                            : 'transparent',
                          color: isSelectedDate
                            ? '#ffffff'
                            : isToday
                            ? '#15803d'
                            : isDowFiltered
                            ? '#b45309'
                            : hasPickup
                            ? '#15803d'
                            : '#1c1e21',
                          border: isSelectedDate
                            ? '1px solid #14532d'
                            : isToday
                            ? '2px solid #16a34a'
                            : isDowFiltered
                            ? '1px solid #fde68a'
                            : hasPickup
                            ? '1px solid #bbf7d0'
                            : '1px solid transparent',
                          transition: 'all 0.12s ease',
                          position: 'relative',
                        }}
                        title={hasOccurrences ? `${dayOccurrences.length} collection occurrence(s) on ${cellDateStr}` : undefined}
                      >
                        {day}
                        {hasPickup && (
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2, margin: '2px auto 0' }}>
                            <div
                              style={{
                                width: 5,
                                height: 5,
                                borderRadius: '50%',
                                background: isSelectedDate
                                  ? '#ffffff'
                                  : isInProgress
                                  ? '#d97706'
                                  : isVerifiedCollected
                                  ? '#15803d'
                                  : '#16a34a',
                              }}
                            />
                            {dayOccurrences.length > 1 && (
                              <span style={{ fontSize: 9, fontWeight: 800, color: isSelectedDate ? '#ffffff' : '#65676b', lineHeight: 1 }}>
                                {dayOccurrences.length}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* Date Occurrences Inspection Panel */}
                {selectedDateStr && (
                  <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #e4e6eb' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <SvgCalendar size={14} color="#16a34a" />
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#1c1e21' }}>
                          Collection for {formatDisplayDate(selectedDateStr)}
                        </span>
                        <span className="sched-pill" style={{ background: '#f0f2f5', color: '#4b5563', border: '1px solid #e4e6eb' }}>
                          {activeDateOccurrences.length} {activeDateOccurrences.length === 1 ? 'Occurrence' : 'Occurrences'}
                        </span>
                      </div>
                      <button
                        className="sched-btn-secondary"
                        onClick={() => { setSelectedDateStr(null); setSelectedDow(null); }}
                        style={{ fontSize: 11, padding: '3px 8px' }}
                      >
                        Clear Date Filter
                      </button>
                    </div>

                    {activeDateOccurrences.length === 0 ? (
                      <div style={{ fontSize: 12, color: '#65676b', padding: '8px 0' }}>
                        No public collection occurrences recorded for this specific date in {selectedBarangay || 'Lucena City'}.
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {activeDateOccurrences.map(occ => {
                          const startTime = occ.start_datetime ? fmt12(occ.start_datetime.slice(11, 16)) : fmt12(occ.start?.slice(11, 16))
                          const endTime = occ.end_datetime ? fmt12(occ.end_datetime.slice(11, 16)) : fmt12(occ.end?.slice(11, 16))
                          const matchingSchedule = schedules.find(s => s.id === occ.source_id)

                          return (
                            <div
                              key={occ.id}
                              style={{
                                background: '#f8fafc',
                                border: '1px solid #e4e6eb',
                                borderRadius: 6,
                                padding: '10px 12px',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                flexWrap: 'wrap',
                                gap: 8,
                              }}
                            >
                              <div>
                                <div style={{ fontWeight: 700, fontSize: 13, color: '#1c1e21' }}>
                                  {occ.title || `Waste Collection — ${occ.location || 'Lucena'}`}
                                </div>
                                <div style={{ fontSize: 11, color: '#65676b', display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                                  <SvgClock size={12} color="#65676b" />
                                  <span>{startTime} – {endTime}</span>
                                  <span>·</span>
                                  <span>{occ.location || (occ.is_citywide ? 'Citywide' : 'Assigned Area')}</span>
                                  {occ.metadata?.frequency && (
                                    <>
                                      <span>·</span>
                                      <span>{occ.metadata.frequency}</span>
                                    </>
                                  )}
                                </div>
                              </div>

                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span
                                  className="sched-pill"
                                  style={{
                                    background: occ.status === 'verified_collected' ? '#e7f5eb'
                                      : occ.status === 'in_progress' ? '#fef3c7'
                                      : occ.status === 'operationally_completed' ? '#eff6ff'
                                      : '#f0fdf4',
                                    color: occ.status === 'verified_collected' ? '#15803d'
                                      : occ.status === 'in_progress' ? '#b45309'
                                      : occ.status === 'operationally_completed' ? '#1d4ed8'
                                      : '#16a34a',
                                    border: occ.status === 'verified_collected' ? '1px solid #bbf7d0'
                                      : occ.status === 'in_progress' ? '1px solid #fde68a'
                                      : occ.status === 'operationally_completed' ? '1px solid #bfdbfe'
                                      : '1px solid #bbf7d0',
                                  }}
                                >
                                  {occ.status === 'verified_collected' ? 'VERIFIED COLLECTED'
                                    : occ.status === 'in_progress' ? 'IN PROGRESS'
                                    : occ.status === 'operationally_completed' ? 'COMPLETED'
                                    : 'SCHEDULED'}
                                </span>

                                {matchingSchedule && (
                                  <button
                                    className="sched-btn-secondary"
                                    onClick={() => {
                                      setExpandedId(matchingSchedule.id)
                                      const bName = matchingSchedule.barangay_names?.split(',')[0]?.trim() || matchingSchedule.area
                                      if (bName) setSelectedBarangay(bName)
                                      handleFocusSelectedBarangay()
                                    }}
                                    style={{ fontSize: 11, padding: '4px 8px' }}
                                    title="Inspect route details and view on map"
                                  >
                                    <SvgMapPin size={11} color="#16a34a" />
                                    <span>View Route</span>
                                  </button>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
            )}

            {/* ── CARD B: TODAY'S ACTIVE COLLECTION HERO ── */}
            <div className="sched-card" style={{ borderLeft: !loading && todaySchedule ? '4px solid #16a34a' : '1px solid #e4e6eb' }}>
              <div className="sched-card-header">
                <div>
                  <h3 className="sched-title">
                    <SvgTruck size={17} color={!loading && todaySchedule ? '#16a34a' : '#65676b'} />
                    Today's Collection · {todayFull}
                  </h3>
                  <p className="sched-subtitle">
                    {selectedBarangay && hasSpecificBarangayRoutes ? `Area: ${selectedBarangay}` : 'City-wide active collection schedule'}
                  </p>
                </div>

                {!loading && (
                  <span
                    className="sched-pill"
                    style={{
                      background: todayOccurrence?.status === 'verified_collected'
                        ? '#e7f5eb'
                        : todayOccurrence?.status === 'in_progress'
                        ? '#fef3c7'
                        : (todaySchedule || todayOccurrence)
                        ? '#e7f5eb'
                        : '#f0f2f5',
                      color: todayOccurrence?.status === 'verified_collected'
                        ? '#15803d'
                        : todayOccurrence?.status === 'in_progress'
                        ? '#b45309'
                        : (todaySchedule || todayOccurrence)
                        ? '#15803d'
                        : '#65676b',
                      border: todayOccurrence?.status === 'verified_collected'
                        ? '1px solid #bbf7d0'
                        : todayOccurrence?.status === 'in_progress'
                        ? '1px solid #fde68a'
                        : (todaySchedule || todayOccurrence)
                        ? '1px solid #bbf7d0'
                        : '1px solid #e4e6eb',
                    }}
                  >
                    {todayOccurrence?.status === 'verified_collected'
                      ? 'COLLECTION COMPLETED'
                      : todayOccurrence?.status === 'in_progress'
                      ? 'COLLECTION IN PROGRESS'
                      : (todaySchedule || todayOccurrence)
                      ? 'COLLECTION TODAY'
                      : 'NO COLLECTION TODAY'}
                  </span>
                )}
              </div>

              <div style={{ padding: 18 }}>
                {loading ? (
                  <SidebarWidgetSkeleton rows={2} />
                ) : todaySchedule ? (
                  <div className="ww-fade-in">
                    {/* Time & Area Banner */}
                    <div style={{ background: '#f8fafc', border: '1px solid #e4e6eb', borderRadius: 8, padding: '14px 16px', marginBottom: 14 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 800, color: '#16a34a', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 2 }}>
                            Scheduled Window
                          </div>
                          <div style={{ fontSize: 18, fontWeight: 800, color: '#1c1e21', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <SvgClock size={16} color="#16a34a" />
                            {fmt12(todaySchedule.start_time)} – {fmt12(todaySchedule.end_time)}
                          </div>
                          <div style={{ fontSize: 12, color: '#65676b', marginTop: 3 }}>
                            Zone: <strong>{todaySchedule.area || todaySchedule.barangay_names || 'General Area'}</strong>
                          </div>
                        </div>

                        <button
                          className="sched-btn-primary"
                          onClick={() => {
                            const bName = todaySchedule.barangay_names?.split(',')[0]?.trim() || todaySchedule.area
                            if (bName) setSelectedBarangay(bName)
                            handleFocusSelectedBarangay()
                          }}
                        >
                          <SvgMapPin size={14} />
                          <span>Focus on Map</span>
                        </button>
                      </div>
                    </div>

                    {/* Public Operations & Facility Notices */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
                      <div style={{ background: '#ffffff', border: '1px solid #e4e6eb', borderRadius: 6, padding: '10px 12px' }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <SvgUser size={12} color="#16a34a" /> Operations Team
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#1c1e21' }}>
                          Lucena SWMO Crew
                        </div>
                        <div style={{ fontSize: 11, color: '#8a8d91' }}>Municipal Crew</div>
                      </div>

                      <div style={{ background: '#ffffff', border: '1px solid #e4e6eb', borderRadius: 6, padding: '10px 12px' }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <SvgTruck size={12} color="#16a34a" /> Assigned Fleet
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#1c1e21' }}>
                          Compactor Service
                        </div>
                        <div style={{ fontSize: 11, color: '#8a8d91' }}>City Fleet</div>
                      </div>

                      <div style={{ background: '#ffffff', border: '1px solid #e4e6eb', borderRadius: 6, padding: '10px 12px' }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <SvgDumpsite size={12} color="#16a34a" /> Disposal Facility
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#1c1e21', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          Sanitary Landfill
                        </div>
                        <div style={{ fontSize: 11, color: '#8a8d91' }}>Designated Facility</div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ padding: '16px 0', textAlign: 'center', color: '#65676b', fontSize: 13 }}>
                    No waste collection scheduled for today in {selectedBarangay || 'this area'}. Please check the weekly routes below for upcoming pickup days.
                  </div>
                )}
              </div>
            </div>

            {/* ── CARD C: WEEKLY ROUTES LIST ── */}
            <div className="sched-card">
              <div className="sched-card-header">
                <div>
                  <h3 className="sched-title">
                    <SvgCalendar size={16} />
                    Weekly Collection Routes
                    {!loading && (
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#65676b' }}>
                        ({filteredSchedules.length} {filteredSchedules.length === 1 ? 'route' : 'routes'})
                      </span>
                    )}
                  </h3>
                  <p className="sched-subtitle">
                    Select a route to view on the map and see driver &amp; truck assignments
                  </p>
                </div>

                {/* Search in schedule */}
                <div style={{ position: 'relative', width: 200 }}>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Search routes or driver..."
                    style={{
                      width: '100%',
                      padding: '6px 10px 6px 28px',
                      borderRadius: 6,
                      border: '1px solid #ccd0d5',
                      fontSize: 12,
                      outline: 'none',
                      background: '#ffffff',
                    }}
                  />
                  <div style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: '#8a8d91' }}>
                    <SvgSearch size={13} />
                  </div>
                </div>
              </div>

              <div style={{ padding: 18 }}>
                {/* Fallback alert if the selected barangay has no dedicated routes */}
                {selectedBarangay && !hasSpecificBarangayRoutes && schedules.length > 0 && (
                  <div style={{ background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 8, padding: '12px 16px', marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#92400e', fontWeight: 600 }}>
                        <SvgInfo size={16} color="#d97706" />
                        <span>No dedicated compactor route assigned for <strong>{selectedBarangay}</strong>. Showing all active Lucena City routes below:</span>
                      </div>
                      <button
                        className="sched-btn-secondary"
                        onClick={() => setSelectedBarangay('Isabang')}
                        style={{ fontSize: 11, padding: '4px 10px' }}
                      >
                        Inspect Isabang Route
                      </button>
                    </div>
                  </div>
                )}

                {loading ? (
                  <FeedCardSkeleton count={3} compact />
                ) : filteredSchedules.length === 0 ? (
                  <div style={{ padding: '32px 20px', textAlign: 'center', color: '#65676b' }}>
                    <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#f0f2f5', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 10px', color: '#8a8d91' }}>
                      <SvgCalendar size={22} />
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 15, color: '#1c1e21', marginBottom: 4 }}>
                      {selectedDateStr ? 'No collections scheduled for this date' : 'No schedules found'}
                    </div>
                    <div style={{ fontSize: 12, maxWidth: 360, margin: '0 auto 12px' }}>
                      {selectedDateStr
                        ? `The municipal calendar has no scheduled solid waste collections on ${formatDisplayDate(selectedDateStr)} in ${selectedBarangay || 'Lucena City'}.`
                        : 'No routes match the selected filters.'}
                    </div>
                    <button
                      className="sched-btn-secondary"
                      onClick={() => { setSelectedBarangay(''); setSelectedDow(null); setSelectedDateStr(null); setSearchQuery(''); }}
                    >
                      Show All Routes
                    </button>
                  </div>
                ) : (
                  <div className="ww-stagger">
                    {filteredSchedules.map(item => {
                      const dayNums = parseDayNums(item.days || '')
                      const isActiveToday = dayNums.includes(todayDow)
                      const isSelected = selectedBarangay && isBarangayMatch(`${item.area || ''} ${item.barangay_names || ''}`, selectedBarangay)
                      const isExpanded = expandedId === item.id
                      const stopList = Array.isArray(item.stops) ? item.stops : (Array.isArray(item.waypoints) ? item.waypoints : [])
                      const stopCount = item.total_stops || stopList.length
                      const hasStops = stopCount > 0

                      return (
                        <div
                          key={item.id}
                          className={`sched-route-card ${isSelected ? 'selected' : ''}`}
                          onClick={() => {
                            // Focus this barangay on the side map
                            const primaryBrgy = item.barangay_names?.split(',')[0]?.trim() || item.area
                            if (primaryBrgy) setSelectedBarangay(primaryBrgy)
                            setExpandedId(isExpanded ? null : item.id)
                          }}
                        >
                          {/* Route Top Row */}
                          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, marginBottom: 10, flexWrap: 'wrap' }}>
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                <span style={{ fontWeight: 800, fontSize: 16, color: '#1c1e21' }}>
                                  {item.area || item.barangay_names || `Route #${item.id}`}
                                </span>
                                {isActiveToday && (
                                  <span className="sched-pill" style={{ background: '#e7f5eb', color: '#15803d', border: '1px solid #bbf7d0' }}>
                                    TODAY
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: 12, color: '#65676b', display: 'flex', alignItems: 'center', gap: 6 }}>
                                <SvgClock size={13} color="#65676b" />
                                <span>{fmt12(item.start_time)} – {fmt12(item.end_time)}</span>
                                <span>·</span>
                                <span>{item.days || 'Regular Collection'}</span>
                              </div>
                            </div>

                            <button
                              className="sched-btn-secondary"
                              style={{ padding: '5px 10px', fontSize: 11 }}
                              onClick={e => {
                                e.stopPropagation()
                                const bName = item.barangay_names?.split(',')[0]?.trim() || item.area
                                if (bName) setSelectedBarangay(bName)
                                handleFocusSelectedBarangay()
                              }}
                            >
                              <SvgMapPin size={13} color="#16a34a" />
                              <span>View on Map</span>
                            </button>
                          </div>

                          {/* Public Service & Vehicle Details */}
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', paddingTop: 8, borderTop: '1px solid #f0f2f5' }}>
                            <div className="sched-detail-badge" title="Municipal Operations Crew">
                              <SvgUser size={13} color="#16a34a" />
                              <span>Crew: <strong>Lucena SWMO Team</strong></span>
                            </div>

                            <div className="sched-detail-badge" title="Municipal Fleet Service">
                              <SvgTruck size={13} color="#16a34a" />
                              <span>Vehicle: <strong>Compactor Fleet</strong></span>
                            </div>

                            <div className="sched-detail-badge" title="Disposal Facility">
                              <SvgDumpsite size={13} color="#65676b" />
                              <span>Sanitary Landfill</span>
                            </div>

                            {hasStops && (
                              <div className="sched-detail-badge" style={{ background: '#f8fafc', color: '#15803d' }}>
                                <SvgCheck size={12} color="#15803d" />
                                <span>{stopCount} stops</span>
                              </div>
                            )}
                          </div>

                          {/* Expanded Route Stops */}
                          {isExpanded && hasStops && (
                            <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #e4e6eb' }}>
                              <div style={{ fontSize: 11, fontWeight: 800, color: '#65676b', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>
                                Route Stops
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                {stopList.map((wp, i) => {
                                  const label = typeof wp === 'string' ? wp : wp?.label || wp?.address || `Stop ${i + 1}`
                                  const isFirst = i === 0
                                  const isLast = i === stopList.length - 1

                                  return (
                                    <div
                                      key={i}
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 10,
                                        fontSize: 12,
                                        color: '#1c1e21',
                                        padding: '5px 8px',
                                        borderRadius: 4,
                                        background: isFirst || isLast ? '#f0fdf4' : '#f8fafc',
                                      }}
                                    >
                                      <div
                                        style={{
                                          width: 18,
                                          height: 18,
                                          borderRadius: '50%',
                                          background: isFirst ? '#16a34a' : isLast ? '#dc2626' : '#cbd5e1',
                                          color: '#ffffff',
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'center',
                                          fontSize: 10,
                                          fontWeight: 800,
                                          flexShrink: 0,
                                        }}
                                      >
                                        {i + 1}
                                      </div>
                                      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {label}
                                      </div>
                                      {isFirst && <span style={{ fontSize: 10, fontWeight: 800, color: '#16a34a' }}>START</span>}
                                      {isLast && <span style={{ fontSize: 10, fontWeight: 800, color: '#dc2626' }}>END</span>}
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>

          </div>

          {/* ────────────────────────────────────────────────────────────
              RIGHT COLUMN: INTERACTIVE BARANGAY OVERVIEW MAP
          ──────────────────────────────────────────────────────────── */}
          <div className="sched-sticky-map">
            <div className="sched-card">
              <div className="sched-card-header">
                <div>
                  <h3 className="sched-title">
                    <SvgMapPin size={16} color="#f59e0b" />
                    Barangay Territory Map
                  </h3>
                  <p className="sched-subtitle">
                    Viewing: <strong style={{ color: '#d97706' }}>{selectedBarangay || 'Lucena City'}</strong>
                  </p>
                </div>

                {/* View Mode Controls: City Overview vs. Focus Barangay */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button
                    className={`sched-btn-toggle ${mapViewMode === 'overview' ? 'active' : ''}`}
                    onClick={handleResetToCityOverview}
                    title="Citywide Overview (all barangays)"
                  >
                    <SvgCompass size={12} />
                    <span>Overview</span>
                  </button>
                  <button
                    className={`sched-btn-toggle ${mapViewMode === 'focus' ? 'active' : ''}`}
                    onClick={handleFocusSelectedBarangay}
                    title="Zoom in onto selected barangay"
                  >
                    <SvgMaximize size={12} />
                    <span>Focus</span>
                  </button>
                </div>
              </div>

              {/* Map Container (Height 480px) matching the dark territorial reference aesthetic */}
              <div style={{ position: 'relative' }}>
                <div
                  ref={mapContainerRef}
                  style={{
                    height: 480,
                    width: '100%',
                    background: '#1d1f23', // Dark background matching user's image
                  }}
                />
                {!mapLoaded && (
                  <div style={{ position: 'absolute', inset: 0, zIndex: 1005 }}>
                    <MapSkeleton height={480} dark label="Loading route map..." borderRadius={14} />
                  </div>
                )}

                {/* Overlay Badge for Current Selection */}
                <div
                  style={{
                    position: 'absolute',
                    top: 12,
                    left: 12,
                    zIndex: 1000,
                    background: 'rgba(15, 23, 42, 0.90)',
                    backdropFilter: 'blur(4px)',
                    border: '1px solid rgba(245, 158, 11, 0.5)',
                    borderRadius: 6,
                    padding: '6px 12px',
                    color: '#ffffff',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                  }}
                >
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#f59e0b' }} />
                  <div>
                    <div style={{ fontSize: 9, fontWeight: 800, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '.06em' }}>
                      Active Territory
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 800 }}>
                      {selectedBarangay || 'Lucena City'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Active Barangay Details Panel (Below Map) */}
              <div style={{ padding: '16px 18px', background: '#fafbfc', borderTop: '1px solid #e4e6eb' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: '#1c1e21', textTransform: 'uppercase', letterSpacing: '.06em' }}>
                    {selectedBarangay || 'Lucena City'} Assignment Details
                  </div>
                  {activeBarangaySchedules.length > 0 ? (
                    <span className="sched-pill" style={{ background: '#e7f5eb', color: '#15803d', border: '1px solid #bbf7d0' }}>
                      {activeBarangaySchedules.length} {activeBarangaySchedules.length === 1 ? 'ROUTE ACTIVE' : 'ROUTES ACTIVE'}
                    </span>
                  ) : (
                    <span className="sched-pill" style={{ background: '#f0f2f5', color: '#65676b', border: '1px solid #e4e6eb' }}>
                      MUNICIPAL COVERAGE
                    </span>
                  )}
                </div>

                {loading ? (
                  <SidebarWidgetSkeleton rows={2} />
                ) : activeBarangaySchedules.length > 0 ? (
                  <div className="ww-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {activeBarangaySchedules.map(r => (
                      <div
                        key={r.id}
                        style={{
                          background: '#ffffff',
                          border: '1px solid #e4e6eb',
                          borderRadius: 6,
                          padding: '10px 12px',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <span style={{ fontWeight: 700, fontSize: 13, color: '#1c1e21' }}>
                            {r.area || r.barangay_names}
                          </span>
                          <span style={{ fontSize: 11, color: '#65676b', fontWeight: 600 }}>
                            {fmt12(r.start_time)} – {fmt12(r.end_time)}
                          </span>
                        </div>

                        {/* Public Service & Facility Details */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 11, color: '#4b5563' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <SvgUser size={12} color="#16a34a" />
                            <span>Crew: <strong style={{ color: '#1c1e21' }}>Lucena SWMO Team</strong></span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <SvgTruck size={12} color="#16a34a" />
                            <span>Fleet: <strong style={{ color: '#1c1e21' }}>Compactor Service</strong></span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, gridColumn: 'span 2' }}>
                            <SvgCalendar size={12} color="#65676b" />
                            <span>Days: <strong>{r.days || 'Regular pickup'}</strong></span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, gridColumn: 'span 2' }}>
                            <SvgDumpsite size={12} color="#65676b" />
                            <span>Disposal: Lucena Sanitary Landfill</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ background: '#ffffff', border: '1px solid #e4e6eb', borderRadius: 6, padding: '12px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#f59e0b' }} />
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#1c1e21' }}>{selectedBarangay || 'Lucena City'} General Coverage</span>
                    </div>
                    <p style={{ fontSize: 12, color: '#65676b', margin: '0 0 10px 0', lineHeight: 1.4 }}>
                      Standard Lucena City SWMO municipal solid waste collection applies to this territory.
                    </p>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <span className="sched-detail-badge" style={{ fontSize: 11 }}>
                        <SvgCalendar size={12} color="#16a34a" /> General City Schedule
                      </span>
                      <span className="sched-detail-badge" style={{ fontSize: 11 }}>
                        <SvgTruck size={12} color="#16a34a" /> Lucena Municipal Fleet
                      </span>
                    </div>
                  </div>
                )}

                {/* Territory Legend */}
                <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', fontSize: 11, color: '#65676b', marginTop: 14, paddingTop: 12, borderTop: '1px solid #e4e6eb' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 12, height: 12, borderRadius: 2, background: '#d97706', border: '1px solid #b45309' }} />
                    <span>Active Barangay</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 12, height: 12, borderRadius: 2, background: '#1e7e34', border: '1px solid #0f3d18' }} />
                    <span>Lucena City</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#ea580c', border: '2px solid #ffffff' }} />
                    <span>Centroid Pin</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>

      </div>

      <BottomNav />
    </div>
  )
}
