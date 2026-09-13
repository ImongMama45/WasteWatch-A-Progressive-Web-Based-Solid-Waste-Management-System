import re

file_path = r"d:\Coding\Waste Watch\wastewatch\frontend\src\pages\driver\components\ShiftRouteModule.jsx"
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Imports
if "import useReassignedStops" not in content:
    content = content.replace("import { useState, useEffect, useRef, useCallback, useMemo } from 'react'", "import { useState, useEffect, useRef, useCallback, useMemo } from 'react'\nimport useReassignedStops from '../../../hooks/useReassignedStops'")

# 2. Local Waypoints State
local_wp_code = """
  const [localWaypoints, setLocalWaypoints] = useState([])
  
  useEffect(() => {
    if (schedule?.waypoints) setLocalWaypoints(schedule.waypoints)
  }, [schedule])

  const [newStopsCount, setNewStopsCount] = useState(0)
  
  useReassignedStops({
    enabled: isExtendedMode,
    onNewStops: (newStops, allStops) => {
      setLocalWaypoints(prev => {
        // Find current GPS or last waypoint
        const currentPos = gpsPos || prev[currentStopIndex]
        
        // Very basic insert logic: just append them to the end of the route
        // In a real system, you would nearest-neighbor sort them.
        const merged = [...prev]
        const existingIds = new Set(prev.map(p => p.stopOrder || p.stop_order || p.id))
        const trulyNew = newStops.filter(n => !existingIds.has(n.stopOrder || n.stop_order || n.id))
        if (trulyNew.length === 0) return prev
        
        merged.push(...trulyNew)
        setNewStopsCount(prevCount => prevCount + trulyNew.length)
        setOrsFetchKey(k => k + 1)
        return merged
      })
    }
  })

  const waypoints = localWaypoints
"""
content = content.replace("const waypoints = schedule?.waypoints || []", local_wp_code)

# 3. Notification Banner
banner_code = """
        <div style={{ position: 'relative', flex: 1 }}>
          {newStopsCount > 0 && (
            <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 1000, background: '#3b82f6', color: '#fff', padding: '8px 16px', borderRadius: 20, fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 4px 12px rgba(59,130,246,0.4)', cursor: 'pointer' }} onClick={() => setNewStopsCount(0)}>
              📦 {newStopsCount} new stop{newStopsCount > 1 ? 's' : ''} assigned! Tap to dismiss.
            </div>
          )}
          <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
"""
content = content.replace("<div style={{ position: 'relative', flex: 1 }}>\n          <div ref={mapRef} style={{ width: '100%', height: '100%' }} />", banner_code)

# 4. Pass completedCount to StopCompletedOverlay
completed_count_logic = """
        <StopCompletedOverlay
          task={currentTarget}
          totalStops={waypoints.length - 1}
          completedCount={[...stopStatuses.values()].filter(s => isCompletedStopStatus(s)).length}
"""
content = content.replace("""        <StopCompletedOverlay
          task={currentTarget}
          totalStops={waypoints.length - 1}""", completed_count_logic)

# 5. Handle early end - mark remaining as DRIVER_MISSED
mark_missed_code = """
  function handleEndShift() {
    setStopStatuses(prev => {
      const next = new Map(prev)
      getRoutableIndices().filter(idx => idx >= currentStopIndex).forEach(idx => {
        if (!isCompletedStopStatus(next.get(idx))) {
          next.set(idx, 'DRIVER_MISSED')
          repaintMarker(idx, 'DRIVER_MISSED')
        }
      })
      return next
    })
    onAdvance('end_shift')
  }
"""
content = content.replace("""  function handleEndShift() {
    onAdvance('end_shift')
  }""", mark_missed_code)


with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("ShiftRouteModule patched.")
