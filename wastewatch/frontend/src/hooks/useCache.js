/**
 * hooks/useCache.js
 * ------------------
 * Read/write a JSON value to localStorage.
 * Use this to persist API responses so they're available offline.
 *
 * Usage:
 *   const [data, setData] = useCache('announcements', [])
 *   // setData(freshApiResponse) — also saves to localStorage
 *   // data — returns localStorage value if API is unavailable
 */

import { useState } from 'react'

export function useCache(key, defaultValue = null) {
  function read() {
    try {
      const raw = localStorage.getItem(`ww_${key}`)
      return raw ? JSON.parse(raw) : defaultValue
    } catch {
      return defaultValue
    }
  }

  const [value, setValue] = useState(read)

  function write(newValue) {
    try {
      localStorage.setItem(`ww_${key}`, JSON.stringify(newValue))
    } catch {
      // Storage quota exceeded — fail silently
    }
    setValue(newValue)
  }

  return [value, write]
}
