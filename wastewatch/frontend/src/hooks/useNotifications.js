/**
 * hooks/useNotifications.js
 * --------------------------
 * Shared hook consumed by Navbar, DashboardLayout, and NotificationCenter.
 * Polls /api/notifications/unread/ every 30s while online.
 * Exposes markRead(ids?) to POST /api/notifications/read/.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import api from '../api/client'
import { useAuth } from '../context/AuthContext'

const POLL_INTERVAL_MS = 30_000

export function useNotifications() {
    const { user } = useAuth()
    const [notifications, setNotifications] = useState([])
    const [unreadCount, setUnreadCount] = useState(0)
    const [loading, setLoading] = useState(true)
    const timerRef = useRef(null)

    const fetchUnread = useCallback(async () => {
        if (!user) return
        try {
            const res = await api.get('/api/notifications/unread/')
            setUnreadCount(res.data.count ?? 0)
            setNotifications(res.data.results ?? [])
        } catch {
            // silent — don't crash navbar on network error
        } finally {
            setLoading(false)
        }
    }, [user])

    // Full list fetch (used by NotificationCenter)
    const fetchAll = useCallback(async () => {
        if (!user) return []
        try {
            const res = await api.get('/api/notifications/')
            return res.data
        } catch {
            return []
        }
    }, [])

    const markRead = useCallback(async (ids) => {
        try {
            const body = ids ? { ids } : {}
            await api.post('/api/notifications/read/', body)
            // Optimistic update
            if (ids) {
                setNotifications(prev => prev.filter(n => !ids.includes(n.id)))
                setUnreadCount(prev => Math.max(0, prev - ids.length))
            } else {
                setNotifications([])
                setUnreadCount(0)
            }
        } catch {
            // re-fetch to stay in sync on failure
            fetchUnread()
        }
    }, [fetchUnread])

    useEffect(() => {
        fetchUnread()
        timerRef.current = setInterval(fetchUnread, POLL_INTERVAL_MS)
        return () => clearInterval(timerRef.current)
    }, [fetchUnread])

    return { notifications, unreadCount, loading, fetchUnread, fetchAll, markRead }
}