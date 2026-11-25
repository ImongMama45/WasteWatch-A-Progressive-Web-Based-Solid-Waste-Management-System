import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../../context/AuthContext'
import { getDumpsites, unwrapList } from '../../../api/dumpsiteApi'
import { getApiErrorMessage } from '../../../utils/notificationHelpers'

const STORAGE_KEY = 'ww_dumpsite_selected_site_id'

export function useFacilityScope() {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const isAdmin = Boolean(user?.role === 'admin' || user?.is_staff)

  const [sites, setSites] = useState([])
  const [siteId, setSiteIdState] = useState(() => {
    const fromUrl = searchParams.get('site_id')
    if (fromUrl) return Number(fromUrl) || fromUrl
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY)
      return saved ? (Number(saved) || saved) : null
    } catch {
      return null
    }
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const setSiteId = useCallback((nextId) => {
    const resolved = nextId ? (Number(nextId) || nextId) : null
    setSiteIdState(resolved)
    try {
      if (resolved) sessionStorage.setItem(STORAGE_KEY, String(resolved))
      else sessionStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore storage errors
    }
    if (isAdmin && resolved) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        next.set('site_id', String(resolved))
        return next
      }, { replace: true })
    }
  }, [isAdmin, setSearchParams])

  const reloadSites = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const raw = await getDumpsites({ paginate: false })
      const list = unwrapList(raw)
      setSites(list)

      if (list.length === 0) {
        setSiteIdState(null)
        setError(
          isAdmin
            ? 'No dumpsite facilities exist yet. Create a facility in Admin Dumpsites first.'
            : 'No dumpsite facility is assigned to your operator account. Contact an administrator.'
        )
      } else if (isAdmin) {
        setSiteIdState((prev) => {
          const urlId = searchParams.get('site_id')
          const candidate = urlId || prev
          const matched = list.find((s) => String(s.id) === String(candidate))
          const chosen = matched ? matched.id : list[0].id
          try {
            sessionStorage.setItem(STORAGE_KEY, String(chosen))
          } catch {
            // ignore
          }
          return chosen
        })
      } else {
        const assigned = list[0].id
        setSiteIdState(assigned)
        try {
          sessionStorage.setItem(STORAGE_KEY, String(assigned))
        } catch {
          // ignore
        }
      }
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to load dumpsite facilities.'))
    } finally {
      setLoading(false)
    }
  }, [isAdmin, searchParams])

  useEffect(() => {
    reloadSites()
  }, [reloadSites])

  const activeSite = sites.find((s) => String(s.id) === String(siteId)) || null

  return {
    sites,
    siteId,
    setSiteId,
    activeSite,
    isAdmin,
    loading,
    error,
    reloadSites,
  }
}
