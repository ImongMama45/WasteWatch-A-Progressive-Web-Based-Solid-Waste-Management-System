import { useEffect, useRef } from 'react'
import api from '../api/client'

/**
 * Polls /api/driver/shift/missed-stops/ every `intervalMs` milliseconds.
 * Only calls `onNewStops` when genuinely NEW stops appear (tracks seen
 * missed_stop ids in a ref so repeating polls never re-fire).
 *
 * Also calls `onStopResolved` when a stop that was previously seen is no
 * longer PENDING (resolved by another extended driver), so the UI can
 * remove floating markers for claimed stops.
 *
 * Props:
 *   enabled       {boolean}  — Only polls when true (i.e. isExtendedMode)
 *   driverLat     {number}   — Current driver GPS lat for proximity sort
 *   driverLng     {number}   — Current driver GPS lng for proximity sort
 *   onNewStops    {fn}       — Called with array of new MissedStop records
 *   onStopResolved {fn}      — Called with id of a stop that is no longer PENDING
 *   intervalMs    {number}   — Poll interval in ms (default 8s)
 */
export default function useReassignedStops({
  enabled,
  driverLat,
  driverLng,
  onNewStops,
  onStopResolved,
  intervalMs = 8000,
}) {
  // Persist seen IDs across re-renders without causing extra renders
  const seenIds = useRef(new Set())
  // Track the last seen status of each id so we can detect removals
  const pendingIds = useRef(new Set())

  useEffect(() => {
    if (!enabled) return

    const poll = async () => {
      try {
        const params = {}
        if (driverLat != null && driverLng != null) {
          params.lat = driverLat
          params.lng = driverLng
        }
        const res = await api.get('/api/driver/shift/missed-stops/', { params })
        const stops = res.data ?? []

        // IDs currently PENDING from server
        const serverPendingIds = new Set(stops.map(s => s.id))

        // Detect stops that were seen before but are now gone (resolved/claimed)
        if (onStopResolved) {
          for (const id of pendingIds.current) {
            if (!serverPendingIds.has(id)) {
              pendingIds.current.delete(id)
              onStopResolved(id)
            }
          }
        }

        if (!stops.length) return

        // Filter to only stops we haven't announced yet
        const newStops = stops.filter(s => !seenIds.current.has(s.id))

        if (newStops.length === 0) return

        // Mark them all as seen & pending before calling back
        newStops.forEach(s => {
          seenIds.current.add(s.id)
          pendingIds.current.add(s.id)
        })

        onNewStops(newStops)
      } catch {
        // Silently ignore network errors — next poll will retry
      }
    }

    poll()
    const interval = setInterval(poll, intervalMs)
    return () => clearInterval(interval)
  }, [enabled, driverLat, driverLng]) // eslint-disable-line react-hooks/exhaustive-deps
}
