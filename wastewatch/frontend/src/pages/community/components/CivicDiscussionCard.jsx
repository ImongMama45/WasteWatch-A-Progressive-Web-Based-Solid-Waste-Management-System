/**
 * CivicDiscussionCard.jsx
 * -----------------------
 * Dedicated Civic Discussion Card for the WasteWatch Community Feed.
 * Represents citizen neighborhood discussions, cleanup initiatives,
 * collection inquiries, and civic advisories.
 *
 * Characteristics:
 * - Strictly text-only (no photo attachments)
 * - Required civic category badge (Collection Schedule, Cleanup Initiative, General Inquiry, Civic Advisory)
 * - Real author credentials & barangay attribution
 * - Like toggle with persisted count
 * - Expandable CommentThread
 * - Native share with clipboard copy fallback
 * - Citizen reporting and admin moderation
 *
 * Strict Iconography Rule: Zero emojis. Lucide SVG icons only.
 */

import { useState } from 'react'
import {
  Heart,
  MessageSquare,
  Share2,
  ShieldAlert,
  Trash2,
  EyeOff,
  Eye,
  MapPin,
  Check,
  Clock,
  Calendar,
  Sparkles,
  HelpCircle,
  Info,
} from 'lucide-react'
import CommentThread from './CommentThread'
import ReportPostModal from './ReportPostModal'
import { useAuth } from '../../../context/AuthContext'
import { formatRelativeTime } from './OfficialReportCard'

export const CIVIC_CATEGORY_META = {
  schedule: {
    label: 'Collection Schedule',
    icon: Calendar,
    bg: '#f0f9ff',
    color: '#0369a1',
    border: '#bae6fd',
  },
  cleanup: {
    label: 'Cleanup Initiative',
    icon: Sparkles,
    bg: '#f0fdf4',
    color: '#15803d',
    border: '#bbf7d0',
  },
  general: {
    label: 'General Inquiry',
    icon: HelpCircle,
    bg: '#f5f3ff',
    color: '#6d28d9',
    border: '#ddd6fe',
  },
  advisory: {
    label: 'Civic Advisory',
    icon: Info,
    bg: '#fffbeb',
    color: '#b45309',
    border: '#fde68a',
  },
}

export default function CivicDiscussionCard({
  post,
  onLike,
  onDelete,
  onModerate,
  onReport,
  onAuthRequired,
  isHighlighted = false,
}) {
  const { user } = useAuth()
  const isAdmin = Boolean(user && (user.role === 'admin' || user.is_staff))
  const isAuthor = Boolean(user && user.id === post.author_id)

  const [commentsOpen, setCommentsOpen] = useState(false)
  const [reportModalOpen, setReportModalOpen] = useState(false)
  const [copiedLink, setCopiedLink] = useState(false)
  const [localCommentCount, setLocalCommentCount] = useState(post.comment_count || 0)

  // Category Configuration
  const categoryKey = (post.category || 'general').toLowerCase()
  const categoryMeta = CIVIC_CATEGORY_META[categoryKey] || CIVIC_CATEGORY_META.general
  const CategoryIcon = categoryMeta.icon

  // Handle Like
  const handleLikeClick = () => {
    if (!user) {
      if (onAuthRequired) onAuthRequired()
      return
    }
    onLike(post.id)
  }

  // Handle Share (Native Share or Clipboard Copy)
  const handleShareClick = async () => {
    const shareUrl = `${window.location.origin}/community?post=${post.id}`
    const shareTitle = `WasteWatch Lucena Community: Post by ${post.author_name}`
    const shareText = post.content.length > 100 ? `${post.content.slice(0, 97)}...` : post.content

    if (navigator.share) {
      try {
        await navigator.share({
          title: shareTitle,
          text: shareText,
          url: shareUrl,
        })
        return
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.warn('Native share error, falling back to copy:', err)
        }
      }
    }

    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopiedLink(true)
      setTimeout(() => setCopiedLink(false), 2400)
    } catch (err) {
      console.error('Clipboard copy failed:', err)
    }
  }

  // Handle Delete
  const handleDeleteClick = () => {
    if (!window.confirm('Are you sure you want to delete this community discussion?')) return
    onDelete(post.id)
  }

  // Handle Admin Moderate
  const handleToggleHide = () => {
    const actionName = post.is_hidden ? 'unhide and restore' : 'hide'
    if (!window.confirm(`Are you sure you want to ${actionName} this post?`)) return
    onModerate(post.id, !post.is_hidden)
  }

  return (
    <article
      id={`post-${post.id}`}
      style={{
        background: '#ffffff',
        borderRadius: 14,
        padding: '20px 22px',
        marginBottom: 16,
        border: isHighlighted ? '2px solid #16a34a' : '1px solid #e2e8f0',
        boxShadow: isHighlighted
          ? '0 4px 12px rgba(22, 163, 74, 0.15)'
          : '0 1px 3px rgba(0, 0, 0, 0.02)',
        transition: 'border 0.2s, box-shadow 0.2s',
      }}
    >
      {/* Post Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Author Avatar */}
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: '50%',
              background: '#16a34a',
              color: '#ffffff',
              fontSize: 15,
              fontWeight: 800,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              overflow: 'hidden',
            }}
          >
            {post.author_avatar ? (
              <img src={post.author_avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              (post.author_name || 'U').charAt(0).toUpperCase()
            )}
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>
                {post.author_name || 'Lucena Citizen'}
              </span>
              {post.author_role && post.author_role !== 'citizen' && (
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    padding: '2px 7px',
                    borderRadius: 4,
                    background: '#e0f2fe',
                    color: '#0369a1',
                    textTransform: 'uppercase',
                  }}
                >
                  {post.author_role.replace('_', ' ')}
                </span>
              )}
              {post.is_hidden && (
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    padding: '2px 7px',
                    borderRadius: 4,
                    background: '#fee2e2',
                    color: '#dc2626',
                    textTransform: 'uppercase',
                  }}
                >
                  Hidden by Admin
                </span>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2, flexWrap: 'wrap' }}>
              {/* Category Badge */}
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: 6,
                  background: categoryMeta.bg,
                  color: categoryMeta.color,
                  border: `1px solid ${categoryMeta.border}`,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <CategoryIcon size={12} />
                <span>{categoryMeta.label}</span>
              </span>

              {/* Barangay Tag */}
              {post.barangay_name && (
                <span style={{ fontSize: 12, color: '#16a34a', display: 'flex', alignItems: 'center', gap: 3, fontWeight: 600 }}>
                  <MapPin size={12} />
                  {post.barangay_name}
                </span>
              )}

              {/* Publication Date */}
              <span style={{ fontSize: 12, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 3 }}>
                <Clock size={11} />
                {formatRelativeTime(post.created_at)}
              </span>
            </div>
          </div>
        </div>

        {/* Action Menu (Delete / Report / Moderate) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* Admin Moderate Hide / Unhide */}
          {isAdmin && (
            <button
              onClick={handleToggleHide}
              title={post.is_hidden ? 'Unhide Post' : 'Hide Inappropriate Post'}
              style={{
                background: post.is_hidden ? '#fef2f2' : '#f8fafc',
                border: '1px solid #e2e8f0',
                color: post.is_hidden ? '#dc2626' : '#64748b',
                padding: '5px 8px',
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                cursor: 'pointer',
              }}
            >
              {post.is_hidden ? <Eye size={13} /> : <EyeOff size={13} />}
              <span className="ww-hide-mobile">{post.is_hidden ? 'Restore' : 'Hide'}</span>
            </button>
          )}

          {/* Delete (Author or Admin) */}
          {(isAuthor || isAdmin) && (
            <button
              onClick={handleDeleteClick}
              title="Delete Post"
              style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                color: '#64748b',
                padding: '5px 8px',
                borderRadius: 6,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <Trash2 size={13} />
            </button>
          )}

          {/* Report (Non-author) */}
          {!isAuthor && (
            <button
              onClick={() => {
                if (!user) {
                  if (onAuthRequired) onAuthRequired()
                  return
                }
                setReportModalOpen(true)
              }}
              title="Report Inappropriate Content"
              style={{
                background: 'transparent',
                border: 'none',
                color: '#94a3b8',
                padding: '5px 6px',
                cursor: 'pointer',
                borderRadius: 6,
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <ShieldAlert size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Discussion Text Content (Strictly Text-Only) */}
      <div
        style={{
          fontSize: 14.5,
          color: '#1e293b',
          lineHeight: 1.6,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          marginBottom: 16,
        }}
      >
        {post.content}
      </div>

      {/* Interaction Footer Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderTop: '1px solid #f1f5f9',
          paddingTop: 12,
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {/* Like Button */}
          <button
            onClick={handleLikeClick}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              background: post.has_liked ? '#fef2f2' : 'transparent',
              border: post.has_liked ? '1px solid #fecaca' : '1px solid transparent',
              color: post.has_liked ? '#e11d48' : '#64748b',
              padding: '6px 12px',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <Heart
              size={16}
              fill={post.has_liked ? '#e11d48' : 'none'}
              stroke={post.has_liked ? '#e11d48' : 'currentColor'}
            />
            <span>{post.like_count || 0}</span>
          </button>

          {/* Comment Toggle Button */}
          <button
            onClick={() => setCommentsOpen(o => !o)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              background: commentsOpen ? '#f0fdf4' : 'transparent',
              border: commentsOpen ? '1px solid #bbf7d0' : '1px solid transparent',
              color: commentsOpen ? '#16a34a' : '#64748b',
              padding: '6px 12px',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <MessageSquare size={16} />
            <span>{localCommentCount} {localCommentCount === 1 ? 'Comment' : 'Comments'}</span>
          </button>
        </div>

        {/* Share Button */}
        <button
          onClick={handleShareClick}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            background: copiedLink ? '#f0fdf4' : 'transparent',
            border: copiedLink ? '1px solid #bbf7d0' : '1px solid #e2e8f0',
            color: copiedLink ? '#15803d' : '#64748b',
            padding: '6px 12px',
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
        >
          {copiedLink ? <Check size={14} /> : <Share2 size={14} />}
          <span>{copiedLink ? 'Link Copied!' : 'Share'}</span>
        </button>
      </div>

      {/* Expandable Comments Thread */}
      {commentsOpen && (
        <CommentThread
          key={`discussion-post-${post.id}`}
          postId={post.id}
          onCommentCountChange={setLocalCommentCount}
          onAuthRequired={onAuthRequired}
        />
      )}

      {/* Report Modal */}
      {reportModalOpen && (
        <ReportPostModal
          post={post}
          onClose={() => setReportModalOpen(false)}
          onSubmit={onReport}
        />
      )}
    </article>
  )
}
