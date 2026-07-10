/**
 * useShiftTimer.js
 * -----------------
 * Tracks driver shift start/end times and elapsed duration.
 * Backend is the ONLY source of truth for shift state — no localStorage,
 * no client-persisted timestamps. On mount (and whenever the logged-in
 * user changes) this fetches GET /api/driver/shift/active/ and derives
 * elapsedMs from the server's `started_at` vs Date.now(), so the timer
 * is correct after a refresh, a device switch, or a dropped connection.
 *
 * startShift()/endShift() are async and THROW on failure — callers must
 * await them and only treat the shift as changed after a successful
 * response. Local state is never optimistically flipped.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import api from '../api/client'

function pad(n) { return String(n).padStart(2, '0') }

function msToHMS(ms) {
  const totalSecs = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(totalSecs / 3600)
  const m = Math.floor((totalSecs % 3600) / 60)
  const s = totalSecs % 60
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

// Route/navigation session data only — shift state no longer lives here.
export function clearDriverSessionData() {
  try {
    const keysToRemove = []
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i)
      if (k && k.startsWith('ww_')) keysToRemove.push(k)
    }
    keysToRemove.forEach(k => sessionStorage.removeItem(k))
  } catch { }
}

const EMPTY_STATE = {
  shiftActive: false,
  startTime: null,
  shiftId: null,
  scheduleId: null,
  truckId: null,
  opStatus: null,
}

export default function useShiftTimer() {
  const { user } = useAuth()
  const userId = user?.id ?? null

  const [state, setState] = useState(EMPTY_STATE)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const intervalRef = useRef(null)
  const prevUserIdRef = useRef(userId)
  const stateRef = useRef(state)
  useEffect(() => { stateRef.current = state }, [state])

  const applyShiftPayload = useCallback((shift) => {
    if (!shift || shift.is_active === false) {
      setState(EMPTY_STATE)
      return
    }
    setState({
      shiftActive: true,
      startTime: shift.started_at ? new Date(shift.started_at) : null,
      shiftId: shift.id ?? null,
      scheduleId: shift.schedule_id ?? shift.schedule ?? null,
      truckId: shift.truck_id ?? shift.truck ?? null,
      opStatus: shift.op_status ?? null,
    })
  }, [])

  const refresh = useCallback(async () => {
    if (!userId) {
      setState(EMPTY_STATE)
      setLoading(false)
      return
    }
    try {
      setError(null)
      const res = await api.get('/api/driver/shift/active/')
      if (res.data?.active) {
        applyShiftPayload(res.data.shift)
      } else {
        setState(EMPTY_STATE)
      }
    } catch (err) {
      console.error('[useShiftTimer] Failed to fetch active shift:', err)
      setError(err)
      // Fail closed: never show "Active Shift" if the backend can't confirm it.
      setState(EMPTY_STATE)
    } finally {
      setLoading(false)
    }
  }, [userId, applyShiftPayload])

  useEffect(() => {
    if (prevUserIdRef.current !== userId) {
      clearDriverSessionData()
      prevUserIdRef.current = userId
    }
    setLoading(true)
    refresh()
  }, [userId, refresh])

  // Tick every second while active, always derived from the server timestamp.
  useEffect(() => {
    if (!state.shiftActive || !state.startTime) {
      setElapsedMs(0)
      return
    }
    function tick() {
      setElapsedMs(Date.now() - state.startTime.getTime())
    }
    tick()
    intervalRef.current = setInterval(tick, 1000)
    return () => clearInterval(intervalRef.current)
  }, [state.shiftActive, state.startTime])

  /**
   * startShift({ scheduleId, latitude, longitude, dutyType })
   * Resolves with the backend shift payload on success.
   * Rejects (throws) on failure — including 409 when the driver already
   * has an active shift on a DIFFERENT schedule. Callers should inspect
   * err.response?.status === 409 and err.response?.data?.active_schedule_id.
   */
  const startShift = useCallback(async ({ scheduleId = null, latitude = null, longitude = null, dutyType = 'normal' } = {}) => {
    const res = await api.post('/api/driver/shift/start/', {
      schedule_id: scheduleId,
      latitude,
      longitude,
      duty_type: dutyType,
    })
    applyShiftPayload(res.data)
    return res.data
  }, [applyShiftPayload])

  /**
   * endShift({ scheduleId, missedStopOrders })
   * Local state is cleared ONLY after the backend confirms with 200 OK.
   * If the request fails, state is left untouched and the error propagates
   * to the caller.
   */
  const endShift = useCallback(async ({ scheduleId = null, missedStopOrders = [] } = {}) => {
    const res = await api.post('/api/driver/shift/end/', {
      schedule_id: scheduleId ?? stateRef.current.scheduleId,
      missed_stop_orders: missedStopOrders,
    })
    setState(EMPTY_STATE)
    setElapsedMs(0)
    return res.data
  }, [])

  return {
    shiftActive: state.shiftActive,
    startTime: state.startTime,
    shiftId: state.shiftId,
    scheduleId: state.scheduleId,
    truckId: state.truckId,
    opStatus: state.opStatus,
    elapsedMs,
    formattedTime: msToHMS(elapsedMs),
    loading,
    error,
    startShift,
    endShift,
    refresh,
  }
}
