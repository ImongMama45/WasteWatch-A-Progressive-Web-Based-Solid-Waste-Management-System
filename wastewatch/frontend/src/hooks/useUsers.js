/**
 * hooks/useUsers.js
 * -----------------
 * Fetches users for administration and assignment.
 */

import { useState, useEffect, useCallback } from 'react'
import api from '../api/client'

export function useUsers() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get('/api/auth/users/') // Assuming we add this to accounts
      setUsers(res.data)
      setError(null)
    } catch (err) {
      setError('Failed to fetch users')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const drivers = users.filter(u => u.role === 'driver')
  const crew = users.filter(u => u.role === 'citizen') // Or a specific crew role if added

  return { users, drivers, crew, loading, error, refresh }
}
