/**
 * CommunityFeed.jsx
 * -----------------
 * Feed displaying database-backed community discussion posts.
 * Includes loading skeleton, empty state, error recovery, and pagination.
 * No emojis. Lucide icons only.
 */

import { Users, RefreshCw, AlertCircle, MessageCircle } from 'lucide-react'
import CommunityPostCard from './CommunityPostCard'
import { FeedCardSkeleton } from '../../../components/ui/Skeleton'

export default function CommunityFeed({
  posts,
  loading,
  refreshing,
  error,
  hasMore,
  loadingMore,
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

      {/* Pagination / Load More */}
      {hasMore && (
        <div style={{ textAlign: 'center', marginTop: 20, marginBottom: 30 }}>
          <button
            onClick={onLoadMore}
            disabled={loadingMore}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 24px',
              borderRadius: 10,
              background: '#ffffff',
              border: '1.5px solid #cbd5e1',
              color: '#334155',
              fontSize: 13,
              fontWeight: 700,
              cursor: loadingMore ? 'not-allowed' : 'pointer',
              boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
            }}
          >
            {loadingMore && <RefreshCw size={14} className="spin" />}
            <span>{loadingMore ? 'Loading More Posts...' : 'Load More Posts'}</span>
          </button>
        </div>
      )}
    </div>
  )
}
