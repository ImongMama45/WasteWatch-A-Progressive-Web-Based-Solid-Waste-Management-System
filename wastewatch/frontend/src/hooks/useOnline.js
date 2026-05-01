/**
 * hooks/useOnline.js
 * -------------------
 * Reactively tracks navigator.onLine.
 * Components re-render automatically when connectivity changes.
 *
 * Usage:
 *   const isOnline = useOnline()
 */

import { useState, useEffect } from 'react'

export function useOnline() {
  const [isOnline, setIsOnline] = useState(navigator.onLine)

  useEffect(() => {
    const onOnline  = () => setIsOnline(true)
    const onOffline = () => setIsOnline(false)

    window.addEventListener('online',  onOnline)
    window.addEventListener('offline', onOffline)

    return () => {
      window.removeEventListener('online',  onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  return isOnline
}
