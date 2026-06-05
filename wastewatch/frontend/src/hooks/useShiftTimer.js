/**
 * useShiftTimer.js
 * -----------------
 * Tracks driver shift start/end times and elapsed duration.
 * Persists to localStorage so a page refresh doesn't lose the timer.
 *
 * Returns:
 *   shiftActive   – boolean
 *   startTime     – Date | null
 *   elapsedMs     – number (milliseconds since start)
 *   formattedTime – "HH:MM:SS" string
 *   startShift()  – begin duty
 *   endShift()    – end duty → returns { startTime, endTime, durationMs }
 */

import { useState, useEffect, useRef, useCallback } from 'react'

const STORAGE_KEY = 'ww_shift_start'

function readStored() {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v ? new Date(v) : null
  } catch { return null }
}

function pad(n) { return String(n).padStart(2, '0') }

function msToHMS(ms) {
  const totalSecs = Math.floor(ms / 1000)
  const h = Math.floor(totalSecs / 3600)
  const m = Math.floor((totalSecs % 3600) / 60)
  const s = totalSecs % 60
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

export default function useShiftTimer() {
  const [startTime, setStartTime] = useState(readStored)
  const [elapsedMs, setElapsedMs] = useState(0)
  const intervalRef = useRef(null)

  const shiftActive = startTime !== null

  // Tick every second while shift is active
  useEffect(() => {
    if (!shiftActive) { setElapsedMs(0); return }

    function tick() {
      setElapsedMs(Date.now() - startTime.getTime())
    }
    tick()
    intervalRef.current = setInterval(tick, 1000)
    return () => clearInterval(intervalRef.current)
  }, [startTime, shiftActive])

  const startShift = useCallback((fromTimestamp = null) => {
    const now = fromTimestamp ? new Date(fromTimestamp) : new Date()
    setStartTime(now)
    try { localStorage.setItem(STORAGE_KEY, now.toISOString()) } catch { }
  }, [])

  const endShift = useCallback(() => {
    const endTime = new Date()
    const durationMs = startTime ? endTime - startTime : 0
    setStartTime(null)
    setElapsedMs(0)
    try { localStorage.removeItem(STORAGE_KEY) } catch { }
    return { startTime, endTime, durationMs }
  }, [startTime])

  return {
    shiftActive,
    startTime,
    elapsedMs,
    formattedTime: msToHMS(elapsedMs),
    startShift,
    endShift,
  }
}
