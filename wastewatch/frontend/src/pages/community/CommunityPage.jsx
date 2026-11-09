/**
 * CommunityPage.jsx
 * -----------------
 * WasteWatch — Lucena City Civic Community Discussion Hub.
 * A citizen-centered space for discussions about waste management,
 * neighborhood cleanliness, collection concerns, and environmental activities.
 *
 * Architecture:
 * - Real database records from /api/community/posts/
 * - Seamless integration with official /announcements
 * - Role-based permissions & admin moderation
 * - Responsive two-column desktop / stacked mobile layout
 * Zero emojis. Lucide icons only.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import {
  Users,
  MessageSquare,
  Filter,
  RefreshCw,
  MapPin,
  Sparkles,
  ArrowRight,
  AlertCircle,
  X,
} from 'lucide-react'
import api from '../../api/client'
import Navbar from '../../components/Navbar'
import BottomNav from '../../components/BottomNav'
import AuthModal from '../../components/AuthModal'
import ReportForm from '../ReportForm'
import { useAuth } from '../../context/AuthContext'
import { useCommunityPosts } from '../../hooks/useCommunityPosts'

import CreatePostBox from './components/CreatePostBox'
import CommunityFeed from './components/CommunityFeed'
import CommunitySidebar from './components/CommunitySidebar'

export default function CommunityPage() {
  const { user, barangays } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const highlightedPostId = searchParams.get('post')
  const [selectedBarangay, setSelectedBarangay] = useState('')
  const [authModalOpen, setAuthModalOpen] = useState(false)
  const [reportModalOpen, setReportModalOpen] = useState(false)
  const [targetedPostError, setTargetedPostError] = useState(null)
  const [injectedPost, setInjectedPost] = useState(null)
  const [targetedPostLoading, setTargetedPostLoading] = useState(false)

  // Compute active scope for sidebar official notices
  const activeScope = useMemo(() => {
    if (selectedBarangay) return String(selectedBarangay)
    if (user?.barangay?.id) return String(user.barangay.id)
    if (user?.barangay && typeof user.barangay === 'number') return String(user.barangay)
    return 'all'
  }, [selectedBarangay, user?.barangay])

  const {
    posts,
    loading,
    refreshing,
    error,
    hasMore,
    loadingMore,
    loadMore,
    refresh,
    createPost,
    toggleLike,
    deletePost,
    moderatePost,
    reportPost,
  } = useCommunityPosts(selectedBarangay || null)

  // Seamlessly merge injected targeted post with feed if fetched directly via deep link
  const displayPosts = useMemo(() => {
    if (!injectedPost) return posts
    if (posts.some(p => String(p.id) === String(injectedPost.id))) return posts
    return [injectedPost, ...posts]
  }, [posts, injectedPost])

  const handleOpenReportModal = useCallback(() => {
    if (!user) {
      setAuthModalOpen(true)
      return
    }
    setReportModalOpen(true)
  }, [user])

  const handleReportSuccess = useCallback(() => {
    refresh()
  }, [refresh])

  // Automatically refresh feed when any report is synced/created
  useEffect(() => {
    const onReportCreated = () => {
      refresh()
    }
    window.addEventListener('ww-report-created', onReportCreated)
    return () => window.removeEventListener('ww-report-created', onReportCreated)
  }, [refresh])

  // Handle deep-linked post resolution (?post=<id>)
  useEffect(() => {
    if (!highlightedPostId) {
      setTargetedPostError(null)
      setInjectedPost(null)
      return
    }

    // 1. Check if post already exists in current feed
    const inFeed = posts.some(p => String(p.id) === String(highlightedPostId))
    if (inFeed) {
      setTargetedPostError(null)
      const timer = setTimeout(() => {
        const el = document.getElementById(`post-${highlightedPostId}`)
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      }, 100)
      return () => clearTimeout(timer)
    }

    // 2. If feed is still initially loading, wait for it
    if (loading) return

    // 3. If post already injected and matching, scroll to it
    if (injectedPost && String(injectedPost.id) === String(highlightedPostId)) {
      setTargetedPostError(null)
      const timer = setTimeout(() => {
        const el = document.getElementById(`post-${highlightedPostId}`)
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      }, 100)
      return () => clearTimeout(timer)
    }

    // 4. Remote fetch required for targeted post
    let active = true
    setTargetedPostLoading(true)
    api.get(`/api/community/posts/${highlightedPostId}/`)
      .then(res => {
        if (!active) return
        if (res.data) {
          setInjectedPost(res.data)
          setTargetedPostError(null)
          setTimeout(() => {
            const el = document.getElementById(`post-${highlightedPostId}`)
            if (el) {
              el.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }
          }, 120)
        }
      })
      .catch(err => {
        if (!active) return
        console.warn(`Targeted community post #${highlightedPostId} not available:`, err?.response?.status)
        setTargetedPostError(`The requested community discussion (Post #${highlightedPostId}) is unavailable, has been deleted, or requires different permissions.`)
      })
      .finally(() => {
        if (active) setTargetedPostLoading(false)
      })

    return () => {
      active = false
    }
  }, [highlightedPostId, loading, posts, injectedPost])

  const handleClearTargetedPost = useCallback(() => {
    setTargetedPostError(null)
    setInjectedPost(null)
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.delete('post')
      return next
    }, { replace: true })
  }, [setSearchParams])

  const handleAuthRequired = useCallback(() => {
    setAuthModalOpen(true)
  }, [])

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#f8fafc',
        fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif",
        paddingTop: 80,
        paddingBottom: 90,
      }}
    >
      <Navbar />

      <main
        className="ww-page-enter"
        style={{
          maxWidth: 1140,
          margin: '0 auto',
          padding: '0 20px',
        }}
      >
        {/* Page Introduction Hero */}
        <div
          style={{
            background: 'linear-gradient(135deg, #15803d 0%, #16a34a 100%)',
            borderRadius: 16,
            padding: '28px 30px',
            color: '#ffffff',
            marginBottom: 24,
            boxShadow: '0 4px 14px rgba(22, 163, 74, 0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 16,
          }}
        >
          <div style={{ maxWidth: 640 }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                borderRadius: 20,
                background: 'rgba(255, 255, 255, 0.2)',
                fontSize: 12,
                fontWeight: 700,
                marginBottom: 10,
                letterSpacing: 0.3,
              }}
            >
              <Users size={14} />
              <span>Lucena City Civic Forum</span>
            </div>
            <h1
              style={{
                fontSize: 26,
                fontWeight: 800,
                margin: '0 0 8px',
                letterSpacing: -0.5,
                lineHeight: 1.25,
              }}
            >
              Community Voice & Neighborhood Cleanliness
            </h1>
            <p
              style={{
                fontSize: 14,
                margin: 0,
                opacity: 0.92,
                lineHeight: 1.5,
              }}
            >
              A collaborative citizen space to discuss local collection schedules, report neighborhood concerns, share cleanup drives, and support environmental initiatives across Lucena City.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              onClick={refresh}
              disabled={refreshing}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '9px 16px',
                borderRadius: 10,
                border: '1.5px solid rgba(255, 255, 255, 0.4)',
                background: 'rgba(255, 255, 255, 0.12)',
                color: '#ffffff',
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              <RefreshCw size={14} className={refreshing ? 'spin' : ''} />
              <span>{refreshing ? 'Updating...' : 'Refresh Feed'}</span>
            </button>
          </div>
        </div>

        {/* Filter Toolbar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 20,
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <MessageSquare size={18} style={{ color: '#16a34a' }} />
            <h2 style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', margin: 0 }}>
              Community Feed & Reports
            </h2>
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: 12,
                background: '#e2e8f0',
                color: '#475569',
              }}
            >
              {posts.length}
            </span>
          </div>

          {/* Barangay Filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Filter size={15} style={{ color: '#64748b' }} />
            <select
              value={selectedBarangay}
              onChange={(e) => setSelectedBarangay(e.target.value)}
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                fontSize: 13,
                color: '#334155',
                fontWeight: 600,
                fontFamily: 'inherit',
                outline: 'none',
              }}
            >
              <option value="">All Lucena Barangays</option>
              {barangays && barangays.map(b => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Two-Column Responsive Layout */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) 340px',
            gap: 28,
            alignItems: 'start',
          }}
          className="ww-community-grid"
        >
          {/* Main Content Column */}
          <div>
            {/* Targeted Post Error / Notice Banner */}
            {targetedPostError && (
              <div
                role="alert"
                style={{
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: 8,
                  padding: '12px 16px',
                  marginBottom: 16,
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <AlertCircle size={18} color="#dc2626" style={{ marginTop: 2, flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#991b1b', marginBottom: 2 }}>
                      Discussion Unavailable
                    </div>
                    <div style={{ fontSize: 12.5, color: '#7f1d1d', lineHeight: 1.4 }}>
                      {targetedPostError}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={handleClearTargetedPost}
                    style={{
                      background: '#ffffff',
                      border: '1px solid #fca5a5',
                      borderRadius: 6,
                      padding: '4px 10px',
                      fontSize: 12,
                      fontWeight: 500,
                      color: '#b91c1c',
                      cursor: 'pointer',
                    }}
                  >
                    View All Discussions
                  </button>
                  <button
                    type="button"
                    onClick={handleClearTargetedPost}
                    aria-label="Dismiss notice"
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 4,
                      cursor: 'pointer',
                      color: '#991b1b',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
            )}

            {/* Post Creation Area */}
            <CreatePostBox
              onPostCreated={createPost}
              onAuthRequired={handleAuthRequired}
              onReportProblemClick={handleOpenReportModal}
            />

            {/* Community Feed */}
            <CommunityFeed
              posts={displayPosts}
              loading={loading}
              refreshing={refreshing}
              error={error}
              hasMore={hasMore}
              loadingMore={loadingMore}
              onLoadMore={loadMore}
              onRefresh={refresh}
              onLike={toggleLike}
              onDelete={deletePost}
              onModerate={moderatePost}
              onReport={reportPost}
              onAuthRequired={handleAuthRequired}
              highlightedPostId={highlightedPostId}
            />
          </div>

          {/* Sidebar Column */}
          <div className="ww-community-sidebar">
            <CommunitySidebar scope={activeScope} />
          </div>
        </div>
      </main>

      {/* Official Report Form Modal Overlay */}
      <ReportForm
        isOpen={reportModalOpen}
        onClose={() => setReportModalOpen(false)}
        onSuccess={handleReportSuccess}
      />

      {/* Auth Modal overlay for unauthenticated interactions */}
      {authModalOpen && (
        <AuthModal
          defaultMode="login"
          onClose={() => setAuthModalOpen(false)}
        />
      )}

      <BottomNav />

      {/* Embedded CSS for responsive grid */}
      <style>{`
        @media (max-width: 900px) {
          .ww-community-grid {
            grid-template-columns: 1fr !important;
          }
          .ww-community-sidebar {
            margin-top: 24px;
          }
          .ww-hide-mobile {
            display: none !important;
          }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .spin {
          animation: spin 1s linear infinite;
        }
      `}</style>
    </div>
  )
}
