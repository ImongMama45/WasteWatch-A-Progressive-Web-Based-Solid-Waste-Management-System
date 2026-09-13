/**
 * Keeps driver GPS tracking + backend sync alive for the whole active shift,
 * even when ShiftRouteModule is not mounted (dashboard, log, hotspots, etc.).
 */
import { createContext, useContext, useEffect, useState } from 'react'
import useGpsTracking from '../hooks/useGpsTracking'
import useShiftTimer from '../hooks/useShiftTimer'
import api from '../api/client'

const DriverGpsContext = createContext(null)

export function DriverGpsProvider({ children }) {
  const { shiftActive } = useShiftTimer()
  const [backendShiftActive, setBackendShiftActive] = useState(false)

  useEffect(() => {
    let alive = true
    const refresh = () => {
      api.get('/api/driver/shift/status/')
        .then((res) => {
          if (!alive) return
          setBackendShiftActive(Boolean(res.data?.shift_active))
        })
        .catch(() => {
          if (alive) setBackendShiftActive(false)
        })
    }
    refresh()
    const intv = setInterval(refresh, 30_000)
    return () => {
      alive = false
      clearInterval(intv)
    }
  }, [])

  const trackingActive = shiftActive || backendShiftActive
  const gps = useGpsTracking({
    // GPS watch is ALWAYS active for drivers — it is a non-negotiable baseline
    // requirement for all driver workflow modules.  Backend sync is still
    // gated on an active shift to avoid spamming the API during idle time.
    enabled: true,
    syncEnabled: trackingActive,
    intervalMs: 5_000,
  })

  return (
    <DriverGpsContext.Provider value={{ ...gps, shiftActive: trackingActive }}>
      {children}
    </DriverGpsContext.Provider>
  )
}

export function useDriverGps() {
  const ctx = useContext(DriverGpsContext)
  if (!ctx) {
    throw new Error('useDriverGps must be used within DriverGpsProvider')
  }
  return ctx
}

export function useOptionalDriverGps() {
  return useContext(DriverGpsContext)
}
