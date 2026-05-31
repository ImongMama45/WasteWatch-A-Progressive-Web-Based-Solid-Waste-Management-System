/**
 * context/AuthContext.jsx
 * -----------------------
 * PWA-aware auth context.
 * Changes from previous version:
 *   • Fetches /api/auth/barangays/ on mount and exposes `barangays` array.
 *   • `barangays` is cached in localStorage (ww_barangays) for offline use.
 *   • `register()` now passes the full payload including `barangay` (ID).
 */

import { createContext, useContext, useState, useEffect } from 'react'
import api from '../api/client'

const AuthContext = createContext(null)

// ── Persistence helpers ───────────────────────────────────────────────────────

function saveUserCache(user) {
  try {
    if (user) localStorage.setItem('ww_user', JSON.stringify(user))
    else localStorage.removeItem('ww_user')
  } catch { }
}

function readUserCache() {
  try {
    const raw = localStorage.getItem('ww_user')
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function saveBrgyCache(list) {
  try { localStorage.setItem('ww_barangays', JSON.stringify(list)) } catch { }
}

function readBrgyCache() {
  try {
    const raw = localStorage.getItem('ww_barangays')
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function AuthProvider({ children }) {
  const [user,      setUser]      = useState(readUserCache)
  const [loading,   setLoading]   = useState(true)
  const [barangays, setBarangays] = useState(readBrgyCache)

  // ── Session check ─────────────────────────────────────────────────────────
  // Replace just this useEffect in AuthProvider:
  useEffect(() => {
    api.get('/api/auth/me/')
      .then(res => {
        setUser(res.data)
        saveUserCache(res.data)
      })
      .catch(err => {
        if (err.response?.status === 401) {
          // Server says not logged in — clear stale cache
          setUser(null)
          saveUserCache(null)
        }
        // Network error (offline) → keep cached user
      })
      .finally(() => setLoading(false))
  }, [])

  // ── Barangay list (once, cached) ──────────────────────────────────────────
  useEffect(() => {
    api.get('/api/auth/barangays/')
      .then(res => {
        setBarangays(res.data)
        saveBrgyCache(res.data)
      })
      .catch(() => {
        // Offline — readBrgyCache already initialised state
      })
  }, [])

  // ── Auth actions ──────────────────────────────────────────────────────────

  async function login(email, password) {
    const res = await api.post('/api/auth/login/', { email, password })
    setUser(res.data.user)
    saveUserCache(res.data.user)
    return res.data
  }

  async function logout() {
    try { await api.post('/api/auth/logout/') } catch { }
    setUser(null)
    saveUserCache(null)
  }

  /**
   * register({ full_name, email, password, password2, barangay })
   * barangay is the required numeric PK from the barangays list.
   */
  async function register(data) {
    const res = await api.post('/api/auth/register/', data)
    return res.data
  }

  return (
    <AuthContext.Provider value={{ user, loading, barangays, login, logout, register }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
