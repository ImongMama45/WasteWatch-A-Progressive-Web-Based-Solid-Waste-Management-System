/**
 * useShiftTimer.js
 * -----------------
 * Tracks driver shift start/end times and elapsed duration.
 * Persists to localStorage so a page refresh doesn't lose the timer.
 *
 * Keys storage by user ID to prevent cross-driver session bleed
 * when the same browser/tab is reused for different driver logins.
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
import { useAuth } from '../context/AuthContext'

const BASE_KEY = 'ww_shift_start'

function storageKey(userId) {
  return userId ? `${BASE_KEY}_${userId}` : BASE_KEY
}

function readStored(key) {
  try {
    const v = localStorage.getItem(key)
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

// Clear all ww_* session storage keys (route state, stop statuses, etc.)
// Called when a new user logs in to prevent bleed from the previous driver.
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

export default function useShiftTimer() {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const key = storageKey(userId)

  // Read the shift for THIS user only
  const [startTime, setStartTime] = useState(() => readStored(key))
  const [elapsedMs, setElapsedMs] = useState(0)
  const intervalRef = useRef(null)
  const prevUserIdRef = useRef(userId)

  // When the user switches (different driver logs in), reset timer
  // and clear all ww_* sessionStorage route data.
  useEffect(() => {
    if (prevUserIdRef.current !== userId) {
      // New user detected — clear stale session data
      clearDriverSessionData()
      // Re-read shift start for the new user
      const newStart = readStored(storageKey(userId))
      setStartTime(newStart)
      prevUserIdRef.current = userId
    }
  }, [userId])

  // If userId changes mid-render (e.g. after login), reload from correct key
  useEffect(() => {
    const stored = readStored(key)
    setStartTime(stored)
  }, [key])

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
    try { localStorage.setItem(storageKey(userId), now.toISOString()) } catch { }
  }, [userId])

  const endShift = useCallback(() => {
    const endTime = new Date()
    const durationMs = startTime ? endTime - startTime : 0
    setStartTime(null)
    setElapsedMs(0)
    try { localStorage.removeItem(storageKey(userId)) } catch { }
    return { startTime, endTime, durationMs }
  }, [startTime, userId])

  return {
    shiftActive,
    startTime,
    elapsedMs,
    formattedTime: msToHMS(elapsedMs),
    startShift,
    endShift,
  }
}
