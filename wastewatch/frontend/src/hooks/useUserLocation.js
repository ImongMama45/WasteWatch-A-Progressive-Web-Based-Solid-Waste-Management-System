/**
 * High-accuracy browser GPS for map "You are here" markers.
 * Does not sync to the backend — use DriverGpsContext for driver truck tracking.
 */
import { useEffect, useRef, useState } from 'react'

const GEO_OPTIONS = {
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 20_000,
}

export default function useUserLocation({ enabled = true } = {}) {
  const [position, setPosition] = useState(null)
  const [accuracy, setAccuracy] = useState(null)
  const [error, setError] = useState(null)
  const [isTracking, setIsTracking] = useState(false)
  const watchId = useRef(null)

  useEffect(() => {
    if (!enabled) {
      if (watchId.current != null) {
        navigator.geolocation.clearWatch(watchId.current)
        watchId.current = null
      }
      setIsTracking(false)
      return
    }

    if (!navigator.geolocation) {
      setError('Geolocation is not supported on this device.')
      return
    }

    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude: lat, longitude: lng, accuracy: acc } = pos.coords
        setPosition({ lat, lng })
        setAccuracy(acc != null ? Math.round(acc) : null)
        setError(null)
        setIsTracking(true)
      },
      (err) => {
        const messages = {
          1: 'Location permission denied. Enable GPS to see your exact position.',
          2: 'Location unavailable. Check your device GPS.',
          3: 'Location request timed out. Retrying…',
        }
        setError(messages[err.code] || 'Unable to read your location.')
        setIsTracking(false)
      },
      GEO_OPTIONS,
    )

    return () => {
      if (watchId.current != null) {
        navigator.geolocation.clearWatch(watchId.current)
        watchId.current = null
      }
    }
  }, [enabled])

  return { position, accuracy, error, isTracking }
}
