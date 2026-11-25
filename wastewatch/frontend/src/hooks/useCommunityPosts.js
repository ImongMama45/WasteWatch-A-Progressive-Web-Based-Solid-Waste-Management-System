/**
 * hooks/useCommunityPosts.js
 * ---------------------------
 * Data management and optimistic updates for Community posts, likes,
 * comments, and reports.
 *
 * Feed Performance Features:
 * - Server-side pagination with default page_size=10, selectable 10, 20, 30.
 * - Deterministic deduplication on subsequent page loads.
 * - 60s lightweight polling using /api/community/posts/latest-check/.
 * - Visibility-aware: pauses polling when tab is hidden, resumes on visible.
 * - Non-intrusive 'hasNewContent' flag: preserves scroll and reading state.
 * - Exponential backoff on polling network errors.
 * - Request cancellation via AbortController on scope/filter change.
 * Zero emojis.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import axios from 'axios'
import api from '../api/client'

export function useCommunityPosts(selectedBarangayId = null) {
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [totalCount, setTotalCount] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasNewContent, setHasNewContent] = useState(false)

  const isFetchingRef = useRef(false)
  const isPollingRef = useRef(false)
  const activeFetchControllerRef = useRef(null)
  const latestSeenRef = useRef({ id: null, count: 0, timestamp: null })
  const lastCheckTimeRef = useRef(Date.now())
  const backoffDelayRef = useRef(60000)
  const isMountedRef = useRef(true)

  // Fetch posts by page number
  const fetchPage = useCallback(
    async (pageToLoad = 1, size = pageSize, isRefresh = false) => {
      // Abort previous in-flight page load if changing filter/page
      if (pageToLoad === 1) {
        activeFetchControllerRef.current?.abort()
        activeFetchControllerRef.current = new AbortController()
      }

      const signal = activeFetchControllerRef.current?.signal

      if (pageToLoad === 1) {
        if (isRefresh) {
          setRefreshing(true)
        } else {
          setLoading(true)
        }
      } else {
        setLoadingMore(true)
      }
      setError(null)
      isFetchingRef.current = true

      try {
        const params = {
          page: pageToLoad,
          page_size: size,
        }
        if (selectedBarangayId) {
          params.barangay_id = selectedBarangayId
        }

        const res = await api.get('/api/community/posts/', { params, signal })
        if (!isMountedRef.current) return

        const data = res.data
        const rawResults = Array.isArray(data)
          ? data
          : Array.isArray(data?.results)
          ? data.results
          : []
        const total = typeof data?.count === 'number' ? data.count : rawResults.length

        if (pageToLoad === 1) {
          setPosts(rawResults)
          setTotalCount(total)
          setCurrentPage(1)
          setHasMore(Boolean(data?.next))
          setHasNewContent(false)

          // Update latest seen tracking
          if (rawResults.length > 0) {
            latestSeenRef.current = {
              id: rawResults[0].id,
              count: total,
              timestamp: rawResults[0].created_at || null,
            }
          } else {
            latestSeenRef.current = { id: null, count: total, timestamp: null }
          }
        } else {
          // Deduplicate subsequent pages by post ID
          setPosts(prev => {
            const existingIds = new Set(prev.map(p => p.id))
            const freshItems = rawResults.filter(p => !existingIds.has(p.id))
            return [...prev, ...freshItems]
          })
          setTotalCount(total)
          setCurrentPage(pageToLoad)
          setHasMore(Boolean(data?.next))
        }
      } catch (err) {
        if (axios.isCancel(err) || err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED') {
          return
        }
        if (!isMountedRef.current) return
        console.error('Failed to fetch community posts:', err)
        setError(err?.response?.data?.detail || 'Unable to load community discussions. Please try again.')
      } finally {
        if (isMountedRef.current) {
          setLoading(false)
          setRefreshing(false)
          setLoadingMore(false)
        }
        isFetchingRef.current = false
      }
    },
    [selectedBarangayId, pageSize]
  )

  // Initial load or scope reset
  useEffect(() => {
    isMountedRef.current = true
    fetchPage(1, pageSize, false)

    return () => {
      isMountedRef.current = false
      activeFetchControllerRef.current?.abort()
    }
  }, [fetchPage, selectedBarangayId, pageSize])

  // Load next page
  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore || isFetchingRef.current) return
    await fetchPage(currentPage + 1, pageSize, false)
  }, [hasMore, loadingMore, currentPage, pageSize, fetchPage])

  // Refresh (page 1)
  const refresh = useCallback(async () => {
    await fetchPage(1, pageSize, true)
  }, [fetchPage, pageSize])

  // Change page size (10, 20, 30)
  const changePageSize = useCallback(
    (newSize) => {
      const clamped = Math.min(30, Math.max(10, Number(newSize) || 10))
      setPageSize(clamped)
    },
    []
  )

  // Load new content banner action
  const loadNewContent = useCallback(async () => {
    setHasNewContent(false)
    await fetchPage(1, pageSize, true)
  }, [fetchPage, pageSize])

  // Lightweight background polling check (every 60s)
  useEffect(() => {
    let timerId = null

    const checkLatest = async () => {
      if (
        !isMountedRef.current ||
        isPollingRef.current ||
        isFetchingRef.current ||
        document.visibilityState !== 'visible'
      ) {
        scheduleNext(backoffDelayRef.current)
        return
      }

      isPollingRef.current = true
      try {
        const params = {}
        if (selectedBarangayId) {
          params.barangay_id = selectedBarangayId
        }

        const res = await api.get('/api/community/posts/latest-check/', { params })
        if (!isMountedRef.current) return

        backoffDelayRef.current = 60000 // Reset backoff on success
        lastCheckTimeRef.current = Date.now()

        const { latest_id, count } = res.data || {}
        const prevSeen = latestSeenRef.current

        if (prevSeen.id !== null && latest_id !== undefined && latest_id > prevSeen.id) {
          setHasNewContent(true)
        } else if (prevSeen.count > 0 && typeof count === 'number' && count > prevSeen.count) {
          setHasNewContent(true)
        }
      } catch (err) {
        console.warn('Community latest check poll error, backing off:', err?.message)
        // Exponential backoff up to 180s
        backoffDelayRef.current = Math.min(180000, Math.round(backoffDelayRef.current * 1.5))
      } finally {
        isPollingRef.current = false
        scheduleNext(backoffDelayRef.current)
      }
    }

    const scheduleNext = (delayMs) => {
      clearTimeout(timerId)
      timerId = setTimeout(checkLatest, delayMs)
    }

    // Schedule initial check in 60s
    scheduleNext(60000)

    // Visibility listener: pause when hidden, check on tab return if >60s elapsed
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const elapsed = Date.now() - lastCheckTimeRef.current
        if (elapsed >= 50000) {
          checkLatest()
        } else {
          scheduleNext(Math.max(10000, 60000 - elapsed))
        }
      } else {
        clearTimeout(timerId)
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      clearTimeout(timerId)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [selectedBarangayId])

  // Create new post
  const createPost = useCallback(async (formData) => {
    try {
      const res = await api.post('/api/community/posts/', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      })
      if (res.data) {
        setPosts(prev => [res.data, ...prev])
        setTotalCount(c => c + 1)
        latestSeenRef.current.id = Math.max(latestSeenRef.current.id || 0, res.data.id)
      }
      return { success: true, post: res.data }
    } catch (err) {
      console.error('Error creating community post:', err)
      const data = err?.response?.data
      let msg = 'Failed to publish post. Please check your submission.'
      if (data) {
        if (typeof data === 'string') {
          msg = data
        } else if (data.content && Array.isArray(data.content)) {
          msg = data.content[0]
        } else if (data.category && Array.isArray(data.category)) {
          msg = data.category[0]
        } else if (data.detail) {
          msg = data.detail
        } else if (data.non_field_errors && Array.isArray(data.non_field_errors)) {
          msg = data.non_field_errors[0]
        }
      }
      return { success: false, error: msg }
    }
  }, [])

  // Toggle like
  const toggleLike = useCallback(
    async (postId) => {
      // Optimistic UI update
      setPosts(prev =>
        prev.map(p => {
          if (p.id === postId) {
            const currentlyLiked = Boolean(p.has_liked)
            return {
              ...p,
              has_liked: !currentlyLiked,
              like_count: Math.max(0, p.like_count + (currentlyLiked ? -1 : 1)),
            }
          }
          return p
        })
      )

      try {
        const res = await api.post(`/api/community/posts/${postId}/like/`)
        if (res.data) {
          setPosts(prev =>
            prev.map(p => {
              if (p.id === postId) {
                return {
                  ...p,
                  has_liked: res.data.liked,
                  like_count: res.data.like_count,
                }
              }
              return p
            })
          )
        }
        return { success: true }
      } catch (err) {
        console.error('Failed to like post:', err)
        fetchPage(1, pageSize, true)
        return { success: false, error: err?.response?.data?.detail || 'Action failed.' }
      }
    },
    [fetchPage, pageSize]
  )

  // Delete post
  const deletePost = useCallback(async (postId) => {
    try {
      await api.delete(`/api/community/posts/${postId}/`)
      setPosts(prev => prev.filter(p => p.id !== postId))
      setTotalCount(c => Math.max(0, c - 1))
      return { success: true }
    } catch (err) {
      console.error('Failed to delete post:', err)
      return { success: false, error: err?.response?.data?.detail || 'Failed to delete post.' }
    }
  }, [])

  // Moderate (hide / unhide) post
  const moderatePost = useCallback(
    async (postId, isHidden) => {
      try {
        const res = await api.patch(`/api/community/posts/${postId}/moderate/`, {
          is_hidden: isHidden,
        })
        if (isHidden) {
          setPosts(prev => prev.filter(p => p.id !== postId))
          setTotalCount(c => Math.max(0, c - 1))
        } else {
          fetchPage(1, pageSize, true)
        }
        return { success: true, data: res.data }
      } catch (err) {
        console.error('Failed to moderate post:', err)
        return { success: false, error: err?.response?.data?.error || 'Moderation action failed.' }
      }
    },
    [fetchPage, pageSize]
  )

  // Report post
  const reportPost = useCallback(async (postId, reason, details) => {
    try {
      const res = await api.post(`/api/community/posts/${postId}/report/`, {
        reason,
        details,
      })
      return { success: true, message: res.data?.message }
    } catch (err) {
      console.error('Failed to report post:', err)
      return { success: false, error: err?.response?.data?.detail || 'Report could not be sent.' }
    }
  }, [])

  // Add comment
  const addComment = useCallback(async (postId, content) => {
    try {
      const res = await api.post(`/api/community/posts/${postId}/comments/`, { content })
      setPosts(prev =>
        prev.map(p => {
          if (p.id === postId) {
            return { ...p, comment_count: (p.comment_count || 0) + 1 }
          }
          return p
        })
      )
      return { success: true, comment: res.data }
    } catch (err) {
      console.error('Failed to add comment:', err)
      const msg =
        err?.response?.data?.content?.[0] ||
        err?.response?.data?.detail ||
        'Failed to post comment.'
      return { success: false, error: msg }
    }
  }, [])

  // Delete comment
  const deleteComment = useCallback(async (postId, commentId) => {
    try {
      await api.delete(`/api/community/comments/${commentId}/`)
      setPosts(prev =>
        prev.map(p => {
          if (p.id === postId) {
            return { ...p, comment_count: Math.max(0, (p.comment_count || 1) - 1) }
          }
          return p
        })
      )
      return { success: true }
    } catch (err) {
      console.error('Failed to delete comment:', err)
      return { success: false, error: err?.response?.data?.detail || 'Failed to delete comment.' }
    }
  }, [])

  return {
    posts,
    loading,
    refreshing,
    error,
    currentPage,
    pageSize,
    setPageSize: changePageSize,
    totalCount,
    hasMore,
    loadingMore,
    hasNewContent,
    loadNewContent,
    loadMore,
    refresh,
    createPost,
    toggleLike,
    deletePost,
    moderatePost,
    reportPost,
    addComment,
    deleteComment,
  }
}
