/**
 * CommentThread.jsx
 * -----------------
 * Unified comment discussion thread component shared across Community Feed
 * and Map View (Public Map / ReportPanel).
 *
 * Single Source of Truth:
 * GarbageReport -> CommunityPost -> PostComment
 *
 * Features:
 * - Direct CommunityPost ID or auto-resolves via GarbageReport ID (/api/watcher/reports/{id}/community_post/)
 * - Request cancellation & sequencing token to prevent stale threads when switching map selections
 * - Separated load errors from submit errors (submit failure preserves loaded comment list)
 * - Theme-aware ('light' for cards, 'dark' for map drawers)
 * - Author / admin delete permissions
 * - Clean author badges and relative timestamps
 * - Strict Iconography Rule: Zero emojis. Lucide SVG icons only.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { Send, Trash2, MessageSquare, AlertCircle, Lock } from 'lucide-react'
import { useAuth } from '../../../context/AuthContext'
import api from '../../../api/client'
import { SidebarWidgetSkeleton } from '../../../components/ui/Skeleton'

function formatRelativeTime(dateString) {
  if (!dateString) return ''
  try {
    const date = new Date(dateString)
    const now = new Date()
    const diffSec = Math.floor((now - date) / 1000)
    if (diffSec < 60) return 'just now'
    const diffMin = Math.floor(diffSec / 60)
    if (diffMin < 60) return `${diffMin}m ago`
    const diffHours = Math.floor(diffMin / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    const diffDays = Math.floor(diffHours / 24)
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch {
    return ''
  }
}

export default function CommentThread({
  postId = null,
  reportId = null,
  theme = 'light',
  onCommentAdded,
  onCommentDeleted,
  onCommentCountChange,
  onAuthRequired,
}) {
  const { user } = useAuth()
  const isAdmin = Boolean(user && (user.role === 'admin' || user.is_staff))
  const isDark = theme === 'dark'

  const [activePostId, setActivePostId] = useState(postId)
  const [resolvingPost, setResolvingPost] = useState(!postId && Boolean(reportId))
  const [postUnavailable, setPostUnavailable] = useState(false)

  const [comments, setComments] = useState([])
  const [loading, setLoading] = useState(Boolean(postId || reportId))
  const [newComment, setNewComment] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Separated error states:
  // - loadError: retrieval failure (shown in comments area)
  // - submitError: composer failure (shown near form, preserving existing comments)
  const [loadError, setLoadError] = useState(null)
  const [submitError, setSubmitError] = useState(null)

  // Keep ref to callbacks to avoid unstable dependencies triggering re-fetches
  const onCommentCountChangeRef = useRef(onCommentCountChange)
  onCommentCountChangeRef.current = onCommentCountChange
  const onCommentAddedRef = useRef(onCommentAdded)
  onCommentAddedRef.current = onCommentAdded
  const onCommentDeletedRef = useRef(onCommentDeleted)
  onCommentDeletedRef.current = onCommentDeleted

  // Track loaded state and prevent duplicate count notifications
  const hasLoadedRef = useRef(false)
  const lastNotifiedPostRef = useRef(null)
  const lastNotifiedCountRef = useRef(null)

  // Safe helper to notify parent of numeric count (deduplicated per post and count)
  const notifyCountChange = useCallback((count) => {
    if (typeof onCommentCountChangeRef.current === 'function') {
      const safeCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0
      const currentPost = activePostIdRef.current
      if (lastNotifiedPostRef.current === currentPost && lastNotifiedCountRef.current === safeCount) {
        return
      }
      lastNotifiedPostRef.current = currentPost
      lastNotifiedCountRef.current = safeCount
      onCommentCountChangeRef.current(safeCount)
    }
  }, [])

  // Sequence token ref to completely ignore stale async responses from earlier selections
  const requestSeqRef = useRef(0)
  const activePostIdRef = useRef(activePostId)
  activePostIdRef.current = activePostId

  // Fetch comments for a specific post ID using the sequence token
  const fetchComments = useCallback(async (targetPostId, token) => {
    if (!targetPostId) return
    setLoading(true)
    setLoadError(null)

    try {
      const res = await api.get(`/api/community/posts/${targetPostId}/comments/`)
      // Only commit if this request is still the active sequence
      if (token === requestSeqRef.current) {
        const loadedComments = Array.isArray(res.data) ? res.data : []
        hasLoadedRef.current = true
        setComments(loadedComments)
        setLoadError(null)
      }
    } catch (err) {
      if (token === requestSeqRef.current) {
        console.error('[CommentThread] Failed to load comments:', err)
        setLoadError('Could not load comments.')
      }
    } finally {
      if (token === requestSeqRef.current) {
        setLoading(false)
      }
    }
  }, [])

  // Resolve thread whenever postId or reportId changes
  useEffect(() => {
    const token = ++requestSeqRef.current

    // Clear previous thread data immediately on selection switch
    hasLoadedRef.current = false
    setComments([])
    setLoadError(null)
    setSubmitError(null)

    if (postId) {
      setActivePostId(postId)
      setResolvingPost(false)
      setPostUnavailable(false)
      fetchComments(postId, token)
      return
    }

    if (!reportId) {
      setActivePostId(null)
      setResolvingPost(false)
      setPostUnavailable(true)
      setLoading(false)
      return
    }

    // Resolve reportId -> CommunityPost
    setResolvingPost(true)
    setPostUnavailable(false)
    setLoading(true)

    api.get(`/api/watcher/reports/${reportId}/community_post/`)
      .then(res => {
        if (token !== requestSeqRef.current) return
        if (res.data && res.data.id) {
          setActivePostId(res.data.id)
          setPostUnavailable(false)
          fetchComments(res.data.id, token)
        } else {
          setPostUnavailable(true)
          setLoading(false)
        }
      })
      .catch(err => {
        if (token !== requestSeqRef.current) return
        console.warn(`[CommentThread] Could not resolve CommunityPost for report #${reportId}:`, err?.response?.status)
        setPostUnavailable(true)
        setLoading(false)
      })
      .finally(() => {
        if (token === requestSeqRef.current) {
          setResolvingPost(false)
        }
      })
  }, [postId, reportId, fetchComments])

  // React-safe synchronization effect: notifies parent of absolute count after state commits
  useEffect(() => {
    if (!loading && !resolvingPost && !loadError && hasLoadedRef.current && activePostId) {
      notifyCountChange(comments.length)
    }
  }, [comments.length, loading, resolvingPost, loadError, activePostId, notifyCountChange])

  // Submit a new comment
  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!user) {
      if (onAuthRequired) onAuthRequired()
      return
    }

    const currentPostId = activePostIdRef.current
    if (!currentPostId) return

    const text = newComment.trim()
    if (!text) return

    setSubmitting(true)
    setSubmitError(null)

    try {
      const res = await api.post(`/api/community/posts/${currentPostId}/comments/`, { content: text })
      // Guard against race if user switched thread while submit was in-flight
      if (currentPostId === activePostIdRef.current) {
        // Pure state update without side-effects inside updater function
        setComments(prev => [...prev, res.data])
        setNewComment('')
        setSubmitError(null)
        if (onCommentAddedRef.current) onCommentAddedRef.current(res.data)
      }
    } catch (err) {
      if (currentPostId === activePostIdRef.current) {
        console.error('[CommentThread] Error posting comment:', err)
        setSubmitError(err?.response?.data?.content?.[0] || err?.response?.data?.error || 'Unable to post comment. Try again.')
      }
    } finally {
      if (currentPostId === activePostIdRef.current) {
        setSubmitting(false)
      }
    }
  }

  // Delete comment
  const handleDelete = async (commentId) => {
    if (!window.confirm('Delete this comment?')) return
    try {
      await api.delete(`/api/community/comments/${commentId}/`)
      // Pure state update without side-effects inside updater function
      setComments(prev => prev.filter(c => c.id !== commentId))
      if (onCommentDeletedRef.current) onCommentDeletedRef.current(commentId)
    } catch (err) {
      console.error('[CommentThread] Failed to delete comment:', err)
      alert('Could not delete comment.')
    }
  }

  // Visual Theme Tokens
  const themeStyles = {
    container: {
      marginTop: 14,
      paddingTop: 14,
      borderTop: isDark ? '1px solid rgba(255, 255, 255, 0.08)' : '1px solid #f1f5f9',
    },
    commentBox: {
      display: 'flex',
      gap: 10,
      alignItems: 'flex-start',
      background: isDark ? 'rgba(255, 255, 255, 0.04)' : '#f8fafc',
      padding: '10px 12px',
      borderRadius: 10,
      border: isDark ? '1px solid rgba(255, 255, 255, 0.06)' : '1px solid #f1f5f9',
    },
    authorName: {
      fontSize: 13,
      fontWeight: 700,
      color: isDark ? '#f8fafc' : '#0f172a',
    },
    roleBadge: {
      fontSize: 10,
      fontWeight: 700,
      padding: '1px 6px',
      borderRadius: 4,
      background: isDark ? 'rgba(56, 189, 248, 0.18)' : '#e0f2fe',
      color: isDark ? '#38bdf8' : '#0369a1',
      textTransform: 'uppercase',
    },
    timeText: {
      fontSize: 11,
      color: isDark ? '#64748b' : '#94a3b8',
    },
    commentContent: {
      fontSize: 13,
      color: isDark ? '#cbd5e1' : '#334155',
      lineHeight: 1.45,
      wordBreak: 'break-word',
    },
    emptyNotice: {
      padding: '12px 14px',
      background: isDark ? 'rgba(255, 255, 255, 0.03)' : '#f8fafc',
      borderRadius: 8,
      fontSize: 13,
      color: isDark ? '#94a3b8' : '#64748b',
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      marginBottom: 12,
      border: isDark ? '1px solid rgba(255, 255, 255, 0.05)' : 'none',
    },
    input: {
      flex: 1,
      padding: '8px 12px',
      borderRadius: 8,
      border: isDark ? '1px solid rgba(255, 255, 255, 0.15)' : '1px solid #cbd5e1',
      fontSize: 13,
      fontFamily: 'inherit',
      outline: 'none',
      background: isDark ? 'rgba(15, 23, 42, 0.7)' : '#ffffff',
      color: isDark ? '#f8fafc' : '#0f172a',
    },
    authPrompt: {
      padding: '8px 12px',
      background: isDark ? 'rgba(255, 255, 255, 0.04)' : '#f1f5f9',
      border: isDark ? '1px solid rgba(255, 255, 255, 0.06)' : 'none',
      borderRadius: 8,
      fontSize: 12,
      color: isDark ? '#94a3b8' : '#475569',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    submitError: {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      color: '#ef4444',
      fontSize: 12,
      marginBottom: 8,
      padding: '4px 8px',
      background: isDark ? 'rgba(239, 68, 68, 0.1)' : '#fef2f2',
      borderRadius: 6,
      border: isDark ? '1px solid rgba(239, 68, 68, 0.2)' : '1px solid #fecaca',
    },
  }

  // Resolving post state
  if (resolvingPost) {
    return (
      <div style={themeStyles.container}>
        <SidebarWidgetSkeleton rows={3} dark={isDark} />
      </div>
    )
  }

  // Unavailable state (e.g. unlinked historical or hidden post)
  if (postUnavailable || (!activePostId && !resolvingPost)) {
    return (
      <div style={themeStyles.container}>
        <div style={themeStyles.emptyNotice}>
          <Lock size={15} style={{ color: isDark ? '#64748b' : '#94a3b8', flexShrink: 0 }} />
          <span>Comments are not available for this report.</span>
        </div>
      </div>
    )
  }

  return (
    <div style={themeStyles.container}>
      {/* Existing Comments Area */}
      {loading ? (
        <SidebarWidgetSkeleton rows={3} dark={isDark} style={{ marginBottom: 14 }} />
      ) : loadError ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#ef4444', fontSize: 13, padding: '8px 0' }}>
          <AlertCircle size={15} />
          <span>{loadError}</span>
        </div>
      ) : comments.length === 0 ? (
        <div style={themeStyles.emptyNotice}>
          <MessageSquare size={16} style={{ color: isDark ? '#64748b' : '#94a3b8', flexShrink: 0 }} />
          <span>No comments yet. Be the first to share your perspective.</span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
          {comments.map(c => {
            const canDelete = user && (c.author_id === user.id || isAdmin)
            return (
              <div key={c.id} style={themeStyles.commentBox}>
                {/* Avatar */}
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    background: '#16a34a',
                    color: '#ffffff',
                    fontSize: 12,
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    overflow: 'hidden',
                  }}
                >
                  {c.author_avatar ? (
                    <img src={c.author_avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    (c.author_name || 'U').charAt(0).toUpperCase()
                  )}
                </div>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 2 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span style={themeStyles.authorName}>
                        {c.author_name}
                      </span>
                      {c.author_role && c.author_role !== 'citizen' && (
                        <span style={themeStyles.roleBadge}>
                          {c.author_role.replace('_', ' ')}
                        </span>
                      )}
                      <span style={themeStyles.timeText}>
                        {formatRelativeTime(c.created_at)}
                      </span>
                    </div>

                    {canDelete && (
                      <button
                        onClick={() => handleDelete(c.id)}
                        title="Delete comment"
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: isDark ? '#64748b' : '#94a3b8',
                          cursor: 'pointer',
                          padding: 2,
                          display: 'flex',
                          alignItems: 'center',
                        }}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                  <div style={themeStyles.commentContent}>
                    {c.content}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Submission Composer Error Notice (Separate from comment list) */}
      {submitError && (
        <div style={themeStyles.submitError}>
          <AlertCircle size={14} style={{ flexShrink: 0 }} />
          <span>{submitError}</span>
        </div>
      )}

      {/* Comment Input */}
      {user ? (
        <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="text"
            value={newComment}
            onChange={(e) => {
              setNewComment(e.target.value)
              if (submitError) setSubmitError(null)
            }}
            placeholder="Write a constructive civic comment..."
            maxLength={1000}
            style={themeStyles.input}
          />
          <button
            type="submit"
            disabled={submitting || !newComment.trim()}
            style={{
              padding: '8px 14px',
              borderRadius: 8,
              border: 'none',
              background: '#16a34a',
              color: '#ffffff',
              fontSize: 13,
              fontWeight: 600,
              cursor: submitting || !newComment.trim() ? 'not-allowed' : 'pointer',
              opacity: submitting || !newComment.trim() ? 0.6 : 1,
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              whiteSpace: 'nowrap',
            }}
          >
            <Send size={14} />
            <span>{submitting ? '...' : 'Post'}</span>
          </button>
        </form>
      ) : (
        <div style={themeStyles.authPrompt}>
          <span>Sign in to participate in civic discussions.</span>
          <button
            type="button"
            onClick={onAuthRequired}
            style={{
              background: '#16a34a',
              color: '#ffffff',
              border: 'none',
              borderRadius: 6,
              padding: '4px 10px',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Sign In
          </button>
        </div>
      )}
    </div>
  )
}
