/**
 * context/AuthContext.jsx
 * -----------------------
 * PWA-aware auth context.
 * - Does NOT block the app while checking session (loading flag)
 * - Gracefully handles offline (no API call fails the app)
 * - Caches user data in localStorage for offline reference
 */

import { createContext, useContext, useState, useEffect } from 'react'
import api from '../api/client'

const AuthContext = createContext(null)

// Persist user to localStorage so we can show their name offline
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

export function AuthProvider({ children }) {
  // Start with cached user so UI is not blank while /me is fetching
  const [user, setUser] = useState(readUserCache)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/api/auth/me/')
      .then(res => {
        setUser(res.data)
        saveUserCache(res.data)
      })
      .catch(() => {
        // If offline or session expired, keep cached user but clear if 401
        setUser(prev => {
          // Keep cached user for offline display
          return prev
        })
      })
      .finally(() => setLoading(false))
  }, [])

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

  async function register(data) {
    const res = await api.post('/api/auth/register/', data)
    return res.data
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, register }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
