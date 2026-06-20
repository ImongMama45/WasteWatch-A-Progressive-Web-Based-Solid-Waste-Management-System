import re

file_path = r"d:\Coding\Waste Watch\wastewatch\frontend\src\pages\driver\components\EndShiftModule.jsx"
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add imports
import_str = "import { buildStopValidationSnapshot, isMissedStopStatus, isCompletedStopStatus, normalizeStopStatus } from '../../../utils/pickupStatusSync'\n"
content = content.replace("import CalibrationCelebrationModule from './CalibrationCelebrationModule'", "import CalibrationCelebrationModule from './CalibrationCelebrationModule'\n" + import_str)

# 2. Add RouteCompletionMiniMap component just before EndShiftModule
minimap_code = """
function RouteCompletionMiniMap({ schedule, stopStatuses }) {
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

    // Stop markers
    wps.slice(1).forEach((wp, i) => {
      const idx = i + 1
      const status = normalizeStopStatus(stopStatuses.get(idx))
      const isCollected = isCompletedStopStatus(status)
      const isDisputed = status === 'COLLECTION_DISPUTED'
      const bg = isCollected ? '#16a34a' : isDisputed ? '#f59e0b' : '#ef4444'
      const label = isCollected ? '✓' : isDisputed ? '!' : '×'
      L.marker([Number(wp.lat), Number(wp.lng)], {
        icon: L.divIcon({
          html: `<div style="width:20px;height:20px;border-radius:50%;background:${bg};color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:900;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3)">${label}</div>`,
          className: '',
          iconSize: [20, 20],
          iconAnchor: [10, 10],
        })
      }).addTo(map)
    })

    return () => { map.remove(); mapRef.current = null }
  }, [schedule, stopStatuses])

  return (
    <div style={{ pointerEvents: 'none', borderRadius: 12, overflow: 'hidden', height: 180, border: '1px solid #e2e8f0', marginBottom: 16 }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  )
}

export default function EndShiftModule({ onAdvance, shift }) {
"""
content = content.replace("export default function EndShiftModule({ onAdvance, shift }) {", minimap_code)

# 3. Add schedule and stopStatuses state
states_code = """
  const [phase, setPhase] = useState('loading')
  const [calibrationData, setCalibrationData] = useState(null)
  
  const [schedule, setSchedule] = useState(null)
  const [stopStatuses, setStopStatuses] = useState(new Map())
"""
content = content.replace("const [phase, setPhase] = useState('loading')\n  const [calibrationData, setCalibrationData] = useState(null)", states_code)

# 4. Modify schedule fetch to also fetch validations
old_fetch = """    api.get('/api/driver/collection-schedules/')
      .then(res => {
        const match = res.data.find(s => String(s.driver) === String(user.id))
        if (match?.waypoints?.length > 0) {
          setBaseLocation(match.waypoints[0])
          setBaseName(match.waypoints[0]?.label || 'Home Base')
        }
        if (match?.dumpsite_detail) {
          setDumpSiteLocation(match.dumpsite_detail)
          setDumpSiteName(match.dumpsite_detail?.name || 'Dump Site')
          setPhase('dump_site')
          api.patch(`/api/driver/shift/${shift.id}/update-status/`, { status: 'end_shift' }).catch(() => { })
        } else {
          setCalibrationData(match)
          setPhase('calibration_complete')
          api.patch(`/api/driver/shift/${shift.id}/update-status/`, { status: 'end_shift' }).catch(() => { })
        }
      })
      .catch((err) => {
        console.error(err)
        setPhase('returning')
      })"""

new_fetch = """    api.get('/api/driver/collection-schedules/')
      .then(async res => {
        const match = res.data.find(s => String(s.driver) === String(user.id))
        if (match) {
          setSchedule(match)
          try {
            const valRes = await api.get(`/api/watcher/stop-validations/?schedule_id=${encodeURIComponent(match.id)}`)
            const snapshot = buildStopValidationSnapshot(valRes.data?.results || valRes.data || [])
            const statusMap = new Map()
            snapshot.statusMap.forEach((status, key) => {
              const stopOrder = Number(String(key).split(':')[1])
              if (!Number.isNaN(stopOrder)) statusMap.set(stopOrder, status)
            })
            setStopStatuses(statusMap)
          } catch (e) { console.error('Failed to fetch validations snapshot:', e) }
        }
        
        if (match?.waypoints?.length > 0) {
          setBaseLocation(match.waypoints[0])
          setBaseName(match.waypoints[0]?.label || 'Home Base')
        }
        if (match?.dumpsite_detail) {
          setDumpSiteLocation(match.dumpsite_detail)
          setDumpSiteName(match.dumpsite_detail?.name || 'Dump Site')
          setPhase('dump_site')
          api.patch(`/api/driver/shift/${shift.id}/update-status/`, { status: 'end_shift' }).catch(() => { })
        } else {
          setCalibrationData(match)
          setPhase('calibration_complete')
          api.patch(`/api/driver/shift/${shift.id}/update-status/`, { status: 'end_shift' }).catch(() => { })
        }
      })
      .catch((err) => {
        console.error(err)
        setPhase('returning')
      })"""
content = content.replace(old_fetch, new_fetch)

# 5. Modify handleEarlySubmit and handleDone payload to include missedStopOrders
derived_state = """
  // Compute missed stops
  const missedStopOrders = schedule?.waypoints ? schedule.waypoints.slice(1).map((_, i) => i + 1).filter(idx => isMissedStopStatus(stopStatuses.get(idx))) : []
  
  function handleEarlySubmit() {
"""
content = content.replace("function handleEarlySubmit() {", derived_state)

content = content.replace("reason: earlyEndReason,", "reason: earlyEndReason,\n      missed_stop_orders: missedStopOrders,\n      schedule_id: schedule?.id,")
content = content.replace("duration_ms: Date.now() - new Date(startTime).getTime()", "duration_ms: Date.now() - new Date(startTime).getTime(),\n        missed_stop_orders: missedStopOrders,\n        schedule_id: schedule?.id")

# 6. Add mini-map to early termination screen
early_term = """            <textarea
              placeholder="Provide more details..."
              value={earlyEndNote}"""
new_early_term = """            {missedStopOrders.length > 0 && (
              <div style={{ padding: '10px 14px', borderRadius: 10, marginBottom: 12, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#ef4444' }}>⚠️ {missedStopOrders.length} stop{missedStopOrders.length > 1 ? 's' : ''} will be marked as missed and offered to nearby drivers.</span>
              </div>
            )}
            {schedule?.waypoints && <RouteCompletionMiniMap schedule={schedule} stopStatuses={stopStatuses} />}
            <textarea
              placeholder="Provide more details..."
              value={earlyEndNote}"""
content = content.replace(early_term, new_early_term)

# 7. Add mini-map to CalibrationCelebrationModule (Phase 3c / Route Complete)
content = content.replace("      <CalibrationCelebrationModule\n        calibrationData={calibrationData}\n        onContinue={() => setPhase('returning')}", "      <CalibrationCelebrationModule\n        calibrationData={calibrationData}\n        schedule={schedule}\n        stopStatuses={stopStatuses}\n        currentStopIndex={1}\n        onContinue={() => setPhase('returning')}")

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("EndShiftModule.jsx patched successfully.")
