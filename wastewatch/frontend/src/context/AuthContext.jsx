/**
 * context/AuthContext.jsx
 * -----------------------
 * Provides the logged-in user to any component in the tree.
 * Wrap your entire app with <AuthProvider> so that useAuth()
 * works everywhere.
 *
 * Usage in a component:
 *   const { user, login, logout, loading } = useAuth()
 */

import { createContext, useContext, useState, useEffect } from 'react'
import api from '../api/client'

// Create the context (empty by default)
const AuthContext = createContext(null)

// ── Provider component ────────────────────────────────────────────────────────
export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null)
  const [loading, setLoading] = useState(true) // true while we check session

  // On first load, try to fetch the current user from Django
  // (If the session cookie is valid, Django returns the user object)
  useEffect(() => {
    api.get('/api/auth/me/')
      .then(res => setUser(res.data))
      .catch(() => setUser(null))   // Not logged in — that's fine
      .finally(() => setLoading(false))
  }, [])

  // ── Login: POST email + password, store returned user ──────────────────────
  async function login(email, password) {
    const res = await api.post('/api/auth/login/', { email, password })
    setUser(res.data.user)
    return res.data
  }

  // ── Logout: call Django to destroy session, clear local state ──────────────
  async function logout() {
    await api.post('/api/auth/logout/')
    setUser(null)
  }

  // ── Register: POST new user data ───────────────────────────────────────────
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

// ── Custom hook for easy access ───────────────────────────────────────────────
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
