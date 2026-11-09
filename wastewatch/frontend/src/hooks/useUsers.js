/**
 * hooks/useUsers.js
 * -----------------
 * Fetches users for administration and assignment.
 */

import { useState, useEffect, useCallback } from 'react'
import api from '../api/client'

function normalizeUsersPayload(data) {
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.results)) return data.results
  return []
}

export function useUsers(defaultParams = null) {
  const [users, setUsers] = useState([])
  const [pagination, setPagination] = useState({ count: 0, total_pages: 1, current_page: 1, page_size: 10, summary: null })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const refresh = useCallback(async (customParams) => {
    setLoading(true)
    try {
      const p = { t: Date.now(), ...(customParams || defaultParams || { paginate: 'false' }) }
      const res = await api.get('/api/accounts/users/', { params: p })
      setUsers(normalizeUsersPayload(res.data))
      if (res.data && typeof res.data === 'object' && 'count' in res.data) {
        setPagination({
          count: res.data.count || 0,
          total_pages: res.data.total_pages || 1,
          current_page: res.data.current_page || 1,
          page_size: res.data.page_size || 10,
          summary: res.data.summary || null
        })
      }
      setError(null)
    } catch (err) {
      setError('Failed to fetch users')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [defaultParams])

  useEffect(() => {
    refresh()
  }, [refresh])

  const drivers = users.filter(u => u.role === 'driver')
  // Crew members are citizens tagged with employee_type = 'crew_member'
  const crew = users.filter(u => u.employee_type === 'crew_member')
  const crewPool = crew   // alias used by TruckManagement

  return { users, pagination, drivers, crew, crewPool, loading, error, refresh }
}
