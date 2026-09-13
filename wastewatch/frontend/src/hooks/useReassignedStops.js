import { useEffect, useRef } from 'react'
import api from '../api/client'

/**
 * Polls /api/driver/stops/reassigned/ every `intervalMs` milliseconds.
 * Only calls `onNewStops` when genuinely NEW stops appear (tracks seen
 * pickup_status_ids in a ref so repeating polls never re-fire).
 *
 * The backend now returns only DRIVER_MISSED stops for extended-mode drivers,
 * so non-extended drivers always receive an empty list and the hook is silent.
 */
export default function useReassignedStops({ enabled, scheduleId, onNewStops, intervalMs = 8000 }) {
  // Persist seen IDs across re-renders without causing extra renders
  const seenIds = useRef(new Set())

  useEffect(() => {
    if (!enabled || !scheduleId) return

    const poll = async () => {
      try {
        const res = await api.get('/api/driver/stops/reassigned/')
        const stops = res.data?.stops ?? []
        if (!stops.length) return

        // Filter to only stops we haven't announced yet
        const newStops = stops.filter(wp => {
          // Use pickup_status_id as the stable dedup key; fall back to stop_order
          const id = wp.pickup_status_id ?? wp.stop_order ?? wp.stopOrder ?? wp.id
          return id != null && !seenIds.current.has(id)
        })

        if (newStops.length === 0) return

        // Mark them all as seen before calling back so rapid re-polls can't
        // double-fire while the component is still processing
        newStops.forEach(wp => {
          const id = wp.pickup_status_id ?? wp.stop_order ?? wp.stopOrder ?? wp.id
          seenIds.current.add(id)
        })

        onNewStops(newStops)
      } catch {
        // Silently ignore network errors — next poll will retry
      }
    }

    poll()
    const interval = setInterval(poll, intervalMs)
    return () => clearInterval(interval)
  }, [enabled, scheduleId]) // eslint-disable-line react-hooks/exhaustive-deps
}
