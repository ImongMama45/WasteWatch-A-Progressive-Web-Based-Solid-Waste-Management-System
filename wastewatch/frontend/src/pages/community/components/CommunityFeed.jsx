/**
 * CommunityFeed.jsx
 * -----------------
 * Feed displaying database-backed community discussion posts.
 * Includes loading skeleton, empty state, error recovery,
 * server-side pagination with controlled page sizes (10, 20, 30),
 * and subtle 'new content' notification banner.
 * No emojis. Lucide icons only.
 */

import { Users, RefreshCw, AlertCircle, MessageCircle, Sparkles, ArrowUp, CheckCircle2 } from 'lucide-react'
import CommunityPostCard from './CommunityPostCard'
import { FeedCardSkeleton } from '../../../components/ui/Skeleton'

export default function CommunityFeed({
  posts,
  loading,
  refreshing,
  error,
  hasMore,
  loadingMore,
  totalCount = 0,
  pageSize = 10,
  onPageSizeChange,
  hasNewContent = false,
  onLoadNewContent,
  onLoadMore,
  onRefresh,
  onLike,
  onDelete,
  onModerate,
  onReport,
  onAuthRequired,
  highlightedPostId,
}) {
  if (loading) {
    return <FeedCardSkeleton count={3} />
  }

  if (error) {
    return (
      <div
        style={{
          background: '#ffffff',
          borderRadius: 14,
          padding: '36px 24px',
          textAlign: 'center',
          border: '1px solid #fee2e2',
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            background: '#fef2f2',
            color: '#dc2626',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 12px',
          }}
        >
          <AlertCircle size={24} />
        </div>
        <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: '0 0 6px' }}>
          Unable to Load Discussions
        </h3>
        <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 16px' }}>
          {error}
        </p>
        <button
          onClick={onRefresh}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            background: '#16a34a',
            color: '#ffffff',
            border: 'none',
            borderRadius: 8,
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <RefreshCw size={14} />
          <span>Try Again</span>
        </button>
      </div>
    )
  }

  if (posts.length === 0) {
    return (
      <div
        style={{
          background: '#ffffff',
          borderRadius: 14,
          padding: '48px 24px',
          textAlign: 'center',
          border: '1px solid #e2e8f0',
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            background: '#f0fdf4',
            color: '#16a34a',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 14px',
          }}
        >
          <MessageCircle size={28} />
        </div>
        <h3 style={{ fontSize: 17, fontWeight: 700, color: '#0f172a', margin: '0 0 6px' }}>
          No Community Posts Yet
        </h3>
        <p style={{ fontSize: 13.5, color: '#64748b', maxWidth: 440, margin: '0 auto' }}>
          Be the first to start a conversation about neighborhood cleanliness, collection schedules, or submit an official waste report.
        </p>
      </div>
    )
  }

  return (
    <div>
      {/* Subtle New Posts Notification Pill */}
      {hasNewContent && (
        <div
          style={{
            position: 'sticky',
            top: 72,
            zIndex: 20,
            display: 'flex',
            justifyContent: 'center',
            marginBottom: 14,
            animation: 'fadeIn 0.2s ease-in-out',
          }}
        >
          <button
            type="button"
            onClick={onLoadNewContent}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '7px 18px',
              borderRadius: 20,
              background: '#f0fdf4',
              border: '1px solid #86efac',
              color: '#15803d',
              fontSize: 12.5,
              fontWeight: 700,
              cursor: 'pointer',
              boxShadow: '0 3px 8px rgba(22, 163, 74, 0.12)',
              transition: 'all 0.15s ease',
            }}
          >
            <Sparkles size={14} strokeWidth={2.4} />
            <span>New posts available · Click to view</span>
            <ArrowUp size={13} strokeWidth={2.4} />
          </button>
        </div>
      )}

      {/* Posts List */}
      <div className="ww-stagger">
        {posts.map(post => (
          <CommunityPostCard
            key={post.id}
            post={post}
            onLike={onLike}
            onDelete={onDelete}
            onModerate={onModerate}
            onReport={onReport}
            onAuthRequired={onAuthRequired}
            isHighlighted={String(post.id) === String(highlightedPostId)}
          />
        ))}
      </div>

      {/* Controlled Pagination Footer */}
      <div
        style={{
          marginTop: 20,
          marginBottom: 32,
          paddingTop: 16,
          borderTop: '1px solid #f1f5f9',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 12,
        }}
      >
        {/* Count & Page Size Row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            maxWidth: 680,
            fontSize: 12.5,
            color: '#64748b',
          }}
        >
          <div>
            Showing <strong style={{ color: '#0f172a' }}>{posts.length}</strong> of{' '}
            <strong style={{ color: '#0f172a' }}>{totalCount || posts.length}</strong> discussions
          </div>
        </div>

        {/* Load More Action Button */}
        {hasMore ? (
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loadingMore}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '9px 24px',
              borderRadius: 8,
              background: '#ffffff',
              border: '1px solid #cbd5e1',
              color: '#334155',
              fontSize: 13,
              fontWeight: 700,
              cursor: loadingMore ? 'not-allowed' : 'pointer',
              boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
              transition: 'background 0.15s, border-color 0.15s',
            }}
          >
            {loadingMore && <RefreshCw size={13} className="spin" />}
            <span>{loadingMore ? 'Loading More Discussions…' : 'Load More Discussions'}</span>
          </button>
        ) : (
          posts.length > 0 && (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                color: '#94a3b8',
                fontWeight: 500,
                padding: '6px 12px',
              }}
            >
              <CheckCircle2 size={13} strokeWidth={2} style={{ color: '#16a34a' }} />
              <span>You've reached the end of the discussions</span>
            </div>
          )
        )}
      </div>
    </div>
  )
}
