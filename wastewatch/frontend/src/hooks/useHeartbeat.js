import { useEffect, useRef } from 'react'
import api from '../api/client'

const INTERVAL_MS = 2 * 60 * 1000  // 2 minutes

export function useHeartbeat() {
  const timerRef = useRef(null)

  useEffect(() => {
    // Fire immediately on mount so presence registers on first load
    api.post('/api/accounts/heartbeat/').catch(() => {})

    timerRef.current = setInterval(() => {
      api.post('/api/accounts/heartbeat/').catch(() => {})
    }, INTERVAL_MS)

    return () => clearInterval(timerRef.current)
  }, [])
}
