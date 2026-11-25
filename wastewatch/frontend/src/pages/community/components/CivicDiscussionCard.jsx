/**
 * CivicDiscussionCard.jsx
 * -----------------------
 * Dedicated Civic Discussion Card for the WasteWatch Community Feed.
 * Redesigned to follow Reddit-inspired flat social discussion feed principles:
 * - Content-first layout with subtle separators and standard border styling.
 * - Same visual skeleton as official reports, with category indicator and clean author attribution.
 * - Text-first focus with high readability and consistent spacing.
 * - Compact Reddit-style interaction actions (Like, Comments, Share, Report).
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
  },
  cleanup: {
    label: 'Cleanup Initiative',
    icon: Sparkles,
  },
  general: {
    label: 'General Inquiry',
    icon: HelpCircle,
  },
  advisory: {
    label: 'Civic Advisory',
    icon: Info,
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

  const categoryKey = (post.category || 'general').toLowerCase()
  const categoryMeta = CIVIC_CATEGORY_META[categoryKey] || CIVIC_CATEGORY_META.general
  const CategoryIcon = categoryMeta.icon

  const handleLikeClick = () => {
    if (!user) {
      if (onAuthRequired) onAuthRequired()
      return
    }
    onLike(post.id)
  }

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

  const handleDeleteClick = () => {
    if (!window.confirm('Are you sure you want to delete this community discussion?')) return
    onDelete(post.id)
  }

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
        borderRadius: 8,
        marginBottom: 10,
        border: isHighlighted ? '1.5px solid #16a34a' : '1px solid #e2e8f0',
        padding: '12px 16px',
        boxShadow: '0 1px 2px rgba(15, 23, 42, 0.02)',
        transition: 'border-color 0.15s',
      }}
    >
      {/* 1. Header Metadata Row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: 8,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
          {/* Author avatar */}
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: '50%',
              background: '#16a34a',
              color: '#ffffff',
              fontSize: 11.5,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              flexShrink: 0,
            }}
          >
            {post.author_avatar ? (
              <img src={post.author_avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              (post.author_name || 'U').charAt(0).toUpperCase()
            )}
          </div>

          {/* Author Name */}
          <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
            {post.author_name || 'Lucena Resident'}
          </span>

          {post.author_role && post.author_role !== 'citizen' && (
            <span
              style={{
                fontSize: 9.5,
                fontWeight: 700,
                padding: '1px 5px',
                borderRadius: 3,
                background: '#f1f5f9',
                color: '#475569',
                textTransform: 'uppercase',
              }}
            >
              {post.author_role.replace('_', ' ')}
            </span>
          )}

          <span style={{ color: '#cbd5e1', fontSize: 11 }}>·</span>

          {/* Category Tag */}
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3.5,
              fontSize: 11.5,
              fontWeight: 600,
              color: '#15803d',
            }}
          >
            <CategoryIcon size={12} />
            <span>{categoryMeta.label}</span>
          </span>

          {/* Barangay location */}
          {post.barangay_name && (
            <>
              <span style={{ color: '#cbd5e1', fontSize: 11 }}>·</span>
              <span style={{ fontSize: 12, color: '#64748b', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                <MapPin size={11} />
                <span>{post.barangay_name}</span>
              </span>
            </>
          )}

          <span style={{ color: '#cbd5e1', fontSize: 11 }}>·</span>

          {/* Relative publication time */}
          <span style={{ fontSize: 11.5, color: '#94a3b8', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            <Clock size={11} />
            <span>{formatRelativeTime(post.created_at)}</span>
          </span>
        </div>

        {/* Right Actions: Admin Moderate / Delete / Flag */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {isAdmin && (
            <button
              onClick={handleToggleHide}
              title={post.is_hidden ? 'Restore Post' : 'Hide Post'}
              style={{
                background: 'transparent',
                border: 'none',
                color: post.is_hidden ? '#dc2626' : '#94a3b8',
                padding: '3px 6px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 3,
                fontSize: 11,
              }}
            >
              {post.is_hidden ? <Eye size={13} /> : <EyeOff size={13} />}
              <span>{post.is_hidden ? 'Restore' : 'Hide'}</span>
            </button>
          )}

          {(isAuthor || isAdmin) && (
            <button
              onClick={handleDeleteClick}
              title="Delete Post"
              style={{
                background: 'transparent',
                border: 'none',
                color: '#94a3b8',
                padding: '3px 6px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <Trash2 size={13} />
            </button>
          )}

          {!isAuthor && (
            <button
              onClick={() => {
                if (!user) {
                  if (onAuthRequired) onAuthRequired()
                  return
                }
                setReportModalOpen(true)
              }}
              title="Report Concern"
              style={{
                background: 'transparent',
                border: 'none',
                color: '#94a3b8',
                padding: '3px 6px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <ShieldAlert size={13} />
            </button>
          )}
        </div>
      </div>

      {/* 2. Content */}
      <div
        style={{
          fontSize: 14,
          color: '#1e293b',
          lineHeight: 1.55,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          margin: '0 0 10px',
        }}
      >
        {post.content}
      </div>

      {/* 3. Reddit-Style Interaction Footer Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderTop: '1px solid #f1f5f9',
          paddingTop: 6,
          marginTop: 6,
          flexWrap: 'wrap',
          gap: 6,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {/* Like */}
          <button
            onClick={handleLikeClick}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              background: post.has_liked ? '#fef2f2' : 'transparent',
              border: 'none',
              color: post.has_liked ? '#dc2626' : '#64748b',
              padding: '4px 8px',
              borderRadius: 4,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <Heart
              size={13}
              fill={post.has_liked ? '#dc2626' : 'none'}
              stroke={post.has_liked ? '#dc2626' : 'currentColor'}
            />
            <span>{post.like_count || 0}</span>
          </button>

          {/* Comments */}
          <button
            onClick={() => setCommentsOpen(o => !o)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              background: commentsOpen ? '#f0fdf4' : 'transparent',
              border: 'none',
              color: commentsOpen ? '#16a34a' : '#64748b',
              padding: '4px 8px',
              borderRadius: 4,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <MessageSquare size={13} />
            <span>{localCommentCount} {localCommentCount === 1 ? 'Comment' : 'Comments'}</span>
          </button>
        </div>

        {/* Share */}
        <button
          onClick={handleShareClick}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            background: 'transparent',
            border: 'none',
            color: copiedLink ? '#16a34a' : '#64748b',
            padding: '4px 8px',
            borderRadius: 4,
            fontSize: 11.5,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {copiedLink ? <Check size={12} /> : <Share2 size={12} />}
          <span>{copiedLink ? 'Copied' : 'Share'}</span>
        </button>
      </div>

      {/* Expandable Comment Thread */}
      {commentsOpen && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #f1f5f9' }}>
          <CommentThread
            key={`discussion-post-${post.id}`}
            postId={post.id}
            onCommentCountChange={setLocalCommentCount}
            onAuthRequired={onAuthRequired}
          />
        </div>
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
