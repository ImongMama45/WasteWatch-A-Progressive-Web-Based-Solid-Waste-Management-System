/**
 * src/context/calendarAuthBridge.js
 * ---------------------------------
 * Pure JavaScript module defining AuthContext and useAuth hook.
 * Separated to permit Node.js ESM test runners to import useAuth without JSX errors,
 * while preventing filesystem case collision with AuthContext.jsx on Windows.
 *
 * STRICT ICONOGRAPHY: No emojis.
 */

import { createContext, useContext } from 'react'

export const AuthContext = createContext(null)

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

