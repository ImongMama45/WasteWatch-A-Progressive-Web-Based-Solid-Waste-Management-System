/**
 * useGpsTracking.js
 * ------------------
 * Continuously tracks the driver's GPS position using the browser
 * Geolocation API and syncs it to the backend on a configurable interval.
 *
 * Usage:
 *   const { position, error, accuracy, isTracking, lastSyncedAt, syncFailed } = useGpsTracking({
 *     intervalMs: 10000,   // POST to backend every 10 s (default)
 *     enabled: true,       // set false to pause (e.g. shift not started)
 *   })
 *
 * Returns:
 *   position     – { lat, lng } | null
 *   accuracy     – metres | null
 *   error        – error message string | null
 *   isTracking   – boolean (true once first fix arrives)
 *   lastSyncedAt – Date | null (last successful backend sync)
 *   syncFailed   – boolean (true after 3+ consecutive backend failures)
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import api from '../api/client'
import useShiftTimer from '../hooks/useShiftTimer' // ← ADD THIS

const DEFAULT_INTERVAL_MS = 10_000   // send to backend every 10 s
const SYNC_FAIL_THRESHOLD = 3       // warn after this many consecutive failures
const GEO_OPTIONS = {
  enableHighAccuracy: true,
  maximumAge: 5_000,   // accept cached position up to 5 s old
  timeout: 15_000,
}

export default function useGpsTracking({ intervalMs = DEFAULT_INTERVAL_MS, enabled = true } = {}) {
  const [position, setPosition] = useState(null)   // { lat, lng }
  const [accuracy, setAccuracy] = useState(null)   // metres
  const [error, setError] = useState(null)   // string | null
  const [isTracking, setIsTracking] = useState(false)
  const [lastSyncedAt, setLastSyncedAt] = useState(null)   // Date | null
  const [syncFailed, setSyncFailed] = useState(false)  // true after 3 consecutive fails

  const lastSentAt = useRef(0)   // timestamp of last API POST attempt
  const failCountRef = useRef(0)   // consecutive backend failure count
  const watchId = useRef(null)

  // ── Send position to backend (throttled) ───────────────────────────────────
  const syncToBackend = useCallback((lat, lng, acc) => {
    const now = Date.now()
    if (now - lastSentAt.current < intervalMs) return   // throttle

    lastSentAt.current = now
    // Round coordinates and accuracy to prevent DRF DecimalField precision validation failures.
    const roundedLat = Math.round(lat * 1e6) / 1e6
    const roundedLng = Math.round(lng * 1e6) / 1e6
    const roundedAcc = acc != null ? Math.round(acc * 100) / 100 : null
    api.post('/api/driver/truck-locations/', { latitude: roundedLat, longitude: roundedLng, accuracy: roundedAcc })
      .then(() => {
        failCountRef.current = 0
        setSyncFailed(false)
        setLastSyncedAt(new Date())
      })
      .catch(err => {
        console.error('Truck location sync failed:', err.response?.data || err)

        failCountRef.current += 1

        if (failCountRef.current >= SYNC_FAIL_THRESHOLD) {
          setSyncFailed(true)
        }
      })
  }, [intervalMs])

  // ── Start / stop watchPosition ─────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) {
      // Clean up if tracking was previously active
      if (watchId.current !== null) {
        navigator.geolocation.clearWatch(watchId.current)
        watchId.current = null
      }
      setIsTracking(false)
      return
    }

    if (!navigator.geolocation) {
      setError('Geolocation is not supported by this device.')
      return
    }

    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude: lat, longitude: lng, accuracy: acc } = pos.coords
        setPosition({ lat, lng })
        setAccuracy(Math.round(acc))
        setError(null)
        setIsTracking(true)
        syncToBackend(lat, lng, acc)
      },
      (err) => {
        const messages = {
          1: 'Location permission denied. Enable GPS in your browser settings.',
          2: 'Location unavailable. Check your device GPS.',
          3: 'Location request timed out. Retrying…',
        }
        setError(messages[err.code] || 'Unknown geolocation error.')
      },
      GEO_OPTIONS,
    )

    return () => {
      if (watchId.current !== null) {
        navigator.geolocation.clearWatch(watchId.current)
        watchId.current = null
      }
    }
  }, [enabled, syncToBackend])

  return { position, accuracy, error, isTracking, lastSyncedAt, syncFailed }
}

