/**
 * hooks/useCommunityPosts.js
 * ---------------------------
 * Data management and optimistic updates for Community posts, likes,
 * comments, and reports.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import api from '../api/client'

export function useCommunityPosts(selectedBarangayId = null) {
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)
  const [nextPageUrl, setNextPageUrl] = useState(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const isFetchingRef = useRef(false)

  // Fetch initial posts (page 1)
  const fetchPosts = useCallback(async (isRefresh = false) => {
    if (isFetchingRef.current) return
    isFetchingRef.current = true
    if (isRefresh) {
      setRefreshing(true)
    } else {
      setLoading(true)
    }
    setError(null)

    try {
      const params = {}
      if (selectedBarangayId) {
        params.barangay_id = selectedBarangayId
      }
      const res = await api.get('/api/community/posts/', { params })
      const data = res.data
      if (Array.isArray(data)) {
        setPosts(data)
        setNextPageUrl(null)
      } else if (data && Array.isArray(data.results)) {
        setPosts(data.results)
        setNextPageUrl(data.next)
      } else {
        setPosts([])
        setNextPageUrl(null)
      }
    } catch (err) {
      console.error('Failed to fetch community posts:', err)
      setError(err?.response?.data?.detail || 'Unable to load community discussions. Please try again.')
    } finally {
      setLoading(false)
      setRefreshing(false)
      isFetchingRef.current = false
    }
  }, [selectedBarangayId])

  useEffect(() => {
    fetchPosts()
  }, [fetchPosts])

  // Load next page
  const loadMore = useCallback(async () => {
    if (!nextPageUrl || loadingMore || isFetchingRef.current) return
    setLoadingMore(true)
    try {
      const res = await api.get(nextPageUrl)
      const data = res.data
      if (data && Array.isArray(data.results)) {
        setPosts(prev => [...prev, ...data.results])
        setNextPageUrl(data.next)
      }
    } catch (err) {
      console.error('Failed to load more posts:', err)
    } finally {
      setLoadingMore(false)
    }
  }, [nextPageUrl, loadingMore])

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
  const toggleLike = useCallback(async (postId) => {
    // Optimistic UI update
    setPosts(prev => prev.map(p => {
      if (p.id === postId) {
        const currentlyLiked = Boolean(p.has_liked)
        return {
          ...p,
          has_liked: !currentlyLiked,
          like_count: Math.max(0, p.like_count + (currentlyLiked ? -1 : 1)),
        }
      }
      return p
    }))

    try {
      const res = await api.post(`/api/community/posts/${postId}/like/`)
      // Reconcile with actual server response
      if (res.data) {
        setPosts(prev => prev.map(p => {
          if (p.id === postId) {
            return {
              ...p,
              has_liked: res.data.liked,
              like_count: res.data.like_count,
            }
          }
          return p
        }))
      }
      return { success: true }
    } catch (err) {
      console.error('Failed to like post:', err)
      // Rollback on failure
      fetchPosts(true)
      return { success: false, error: err?.response?.data?.detail || 'Action failed.' }
    }
  }, [fetchPosts])

  // Delete post
  const deletePost = useCallback(async (postId) => {
    try {
      await api.delete(`/api/community/posts/${postId}/`)
      setPosts(prev => prev.filter(p => p.id !== postId))
      return { success: true }
    } catch (err) {
      console.error('Failed to delete post:', err)
      return { success: false, error: err?.response?.data?.detail || 'Failed to delete post.' }
    }
  }, [])

  // Moderate (hide / unhide) post
  const moderatePost = useCallback(async (postId, isHidden) => {
    try {
      const res = await api.patch(`/api/community/posts/${postId}/moderate/`, {
        is_hidden: isHidden,
      })
      if (isHidden) {
        setPosts(prev => prev.filter(p => p.id !== postId))
      } else {
        fetchPosts(true)
      }
      return { success: true, data: res.data }
    } catch (err) {
      console.error('Failed to moderate post:', err)
      return { success: false, error: err?.response?.data?.error || 'Moderation action failed.' }
    }
  }, [fetchPosts])

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
      // Increment comment count on the post
      setPosts(prev => prev.map(p => {
        if (p.id === postId) {
          return { ...p, comment_count: p.comment_count + 1 }
        }
        return p
      }))
      return { success: true, comment: res.data }
    } catch (err) {
      console.error('Failed to add comment:', err)
      const msg = err?.response?.data?.content?.[0] ||
        err?.response?.data?.detail ||
        'Failed to post comment.'
      return { success: false, error: msg }
    }
  }, [])

  // Delete comment
  const deleteComment = useCallback(async (postId, commentId) => {
    try {
      await api.delete(`/api/community/comments/${commentId}/`)
      setPosts(prev => prev.map(p => {
        if (p.id === postId) {
          return { ...p, comment_count: Math.max(0, p.comment_count - 1) }
        }
        return p
      }))
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
    hasMore: Boolean(nextPageUrl),
    loadingMore,
    loadMore,
    refresh: () => fetchPosts(true),
    createPost,
    toggleLike,
    deletePost,
    moderatePost,
    reportPost,
    addComment,
    deleteComment,
  }
}
