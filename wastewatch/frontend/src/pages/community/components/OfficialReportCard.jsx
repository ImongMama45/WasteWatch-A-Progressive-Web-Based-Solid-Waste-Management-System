/**
 * OfficialReportCard.jsx
 * ----------------------
 * Official Municipal Waste Report Card for the WasteWatch Community Feed.
 * Redesigned to follow Reddit-inspired flat social discussion feed principles:
 * - Content-first layout with subtle separators and standard border styling.
 * - Same visual skeleton as citizen discussions, with subtle textual "Official Report" & status indicator.
 * - Clear headline for Issue Type (e.g. Overflowing Waste, Missed Collection).
 * - Preserves evidence photos, location map navigation, collapsible details, and voting.
 * - Retains ?post=<id> deep links and tracking reference in details.
 *
 * Strict Iconography Rule: Zero emojis. Lucide SVG icons only.
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Clock,
  CheckCircle2,
  AlertTriangle,
  Trash2,
  Truck,
  MapPin,
  Heart,
  MessageSquare,
  Share2,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  Navigation,
  Check,
  Eye,
  EyeOff,
  Flame,
  ShieldCheck,
  CheckCheck,
} from 'lucide-react'
import CommentThread from './CommentThread'
import ReportPostModal from './ReportPostModal'
import ReportVoting from '../../../components/community/ReportVoting'
import { getGarbageReportId } from '../../../utils/reportIdentity'
import { useAuth } from '../../../context/AuthContext'

export function formatRelativeTime(dateString) {
  if (!dateString) return ''
  try {
    const d = new Date(dateString)
    const now = new Date()
    const diffSec = Math.floor((now - d) / 1000)
    if (diffSec < 60) return 'Just now'
    const diffMin = Math.floor(diffSec / 60)
    if (diffMin < 60) return `${diffMin}m ago`
    const diffHours = Math.floor(diffMin / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    const diffDays = Math.floor(diffHours / 24)
    if (diffDays < 7) return `${diffDays}d ago`
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    })
  } catch {
    return ''
  }
}

// Authoritative Report Status Configurations
export const REPORT_STATUS_CONFIG = {
  pending: {
    label: 'Pending Review',
    bg: '#f8fafc',
    color: '#475569',
    border: '#cbd5e1',
    icon: Clock,
    summary: 'Awaiting barangay verification.',
  },
  approved: {
    label: 'Verified & Approved',
    bg: '#f0fdf4',
    color: '#15803d',
    border: '#bbf7d0',
    icon: CheckCircle2,
    summary: 'Approved for municipal collection.',
  },
  resolved: {
    label: 'Resolved & Collected',
    bg: '#f0fdf4',
    color: '#15803d',
    border: '#bbf7d0',
    icon: CheckCheck,
    summary: 'Collection completed and verified.',
  },
  rejected: {
    label: 'Rejected',
    bg: '#fef2f2',
    color: '#b91c1c',
    border: '#fecaca',
    icon: AlertTriangle,
    summary: 'Not approved.',
  },
}

// Issue Type Metadata
export const ISSUE_TYPE_CONFIG = {
  overflow: {
    label: 'Overflowing Waste',
    icon: Trash2,
  },
  missed: {
    label: 'Missed Collection',
    icon: Truck,
  },
  illegal_dumping: {
    label: 'Illegal Dumpsite',
    icon: AlertTriangle,
  },
}

// Severity Metadata
export const SEVERITY_CONFIG = {
  low: { label: 'Low Severity' },
  medium: { label: 'Medium Severity' },
  high: { label: 'High Severity' },
}

export default function OfficialReportCard({
  post,
  onLike,
  onDelete,
  onModerate,
  onReport,
  onAuthRequired,
  isHighlighted = false,
}) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const isAdmin = Boolean(user && (user.role === 'admin' || user.is_staff))
  const isAuthor = Boolean(user && user.id === post.author_id)

  const [commentsOpen, setCommentsOpen] = useState(false)
  const [detailsExpanded, setDetailsExpanded] = useState(false)
  const [reportModalOpen, setReportModalOpen] = useState(false)
  const [copiedLink, setCopiedLink] = useState(false)
  const [imageModalOpen, setImageModalOpen] = useState(false)
  const [activeImageIndex, setActiveImageIndex] = useState(0)
  const [localCommentCount, setLocalCommentCount] = useState(post.comment_count || 0)

  const rep = post.report_details || {}
  const garbageReportId = getGarbageReportId(rep.id ? rep : { id: post.report })
  const statusKey = (rep.status || 'pending').toLowerCase()
  const statusMeta = REPORT_STATUS_CONFIG[statusKey] || REPORT_STATUS_CONFIG.pending
  const StatusIcon = statusMeta.icon

  const issueKey = (rep.issue_type || 'overflow').toLowerCase()
  const issueMeta = ISSUE_TYPE_CONFIG[issueKey] || ISSUE_TYPE_CONFIG.overflow

  const sevKey = (rep.severity || 'medium').toLowerCase()
  const sevMeta = SEVERITY_CONFIG[sevKey] || SEVERITY_CONFIG.medium

  const evidenceImages = (rep.images && rep.images.length > 0)
    ? rep.images
    : (post.image_url ? [post.image_url] : [])

  const hasLocationCoords = Boolean(rep.latitude && rep.longitude)

  const handleViewOnMap = (e) => {
    e.stopPropagation()
    if (!hasLocationCoords) return
    navigate('/public-map', {
      state: {
        focusReport: {
          id: rep.id || post.report,
          report_id: rep.id || post.report,
          community_post_id: post.id,
          comment_count: localCommentCount,
          latitude: rep.latitude,
          longitude: rep.longitude,
          address: rep.address || post.barangay_name || 'Lucena City',
          issue_type: rep.issue_type,
          status: rep.status,
          description: post.content || rep.description,
        },
      },
    })
  }

  const handleLikeClick = () => {
    if (!user) {
      if (onAuthRequired) onAuthRequired()
      return
    }
    onLike(post.id)
  }

  const handleShareClick = async () => {
    const shareUrl = `${window.location.origin}/community?post=${post.id}`
    const shareTitle = `WasteWatch Official Report #WR-${rep.id || post.report || post.id}`
    const shareText = `Official waste report in ${post.barangay_name || 'Lucena City'}: ${rep.issue_type_label || issueMeta.label}`

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
          console.warn('Share error, falling back to copy:', err)
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
    if (!window.confirm('Are you sure you want to delete this report discussion entry?')) return
    onDelete(post.id)
  }

  const handleToggleHide = () => {
    const actionName = post.is_hidden ? 'unhide and restore' : 'hide'
    if (!window.confirm(`Are you sure you want to ${actionName} this report card?`)) return
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

          <span style={{ color: '#cbd5e1', fontSize: 11 }}>·</span>

          {/* Official Report Subtle Badge */}
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3.5,
              fontSize: 11.5,
              fontWeight: 700,
              color: statusMeta.color,
            }}
          >
            <ShieldCheck size={12} />
            <span>Official Report ({statusMeta.label})</span>
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
            <span>{formatRelativeTime(rep.created_at || post.created_at)}</span>
          </span>
        </div>

        {/* Right Actions: Admin Moderate / Delete / Flag */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {isAdmin && (
            <button
              onClick={handleToggleHide}
              title={post.is_hidden ? 'Restore Report' : 'Hide Report'}
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
              title="Delete Report"
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

      {/* 2. Headline / Primary Description */}
      <h3
        style={{
          fontSize: 15,
          fontWeight: 700,
          color: '#0f172a',
          margin: '0 0 4px',
          lineHeight: 1.35,
        }}
      >
        {rep.issue_type_label || issueMeta.label}
        {rep.severity && rep.severity !== 'medium' && (
          <span style={{ fontSize: 12, fontWeight: 500, color: '#64748b', marginLeft: 8 }}>
            ({sevMeta.label})
          </span>
        )}
      </h3>

      {/* 3. Post Content */}
      <div
        style={{
          fontSize: 13.5,
          color: '#1e293b',
          lineHeight: 1.55,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          margin: '0 0 10px',
        }}
      >
        {post.content || rep.description || 'No additional remarks provided.'}
      </div>

      {/* 4. Evidence Photos (Clean Proportionate Presentation) */}
      {evidenceImages.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 6 }}>
            <img
              src={evidenceImages[activeImageIndex] || evidenceImages[0]}
              alt="Official report evidence"
              onClick={() => setImageModalOpen(true)}
              style={{
                width: '100%',
                maxHeight: 280,
                objectFit: 'cover',
                borderRadius: 6,
                border: '1px solid #e2e8f0',
                cursor: 'zoom-in',
                display: 'block',
                background: '#f8fafc',
              }}
            />
            {evidenceImages.length > 1 && (
              <div
                style={{
                  position: 'absolute',
                  bottom: 6,
                  right: 6,
                  background: 'rgba(15, 23, 42, 0.75)',
                  color: '#ffffff',
                  fontSize: 11,
                  fontWeight: 600,
                  padding: '2px 6px',
                  borderRadius: 4,
                }}
              >
                {activeImageIndex + 1} of {evidenceImages.length} Photos
              </div>
            )}
          </div>

          {evidenceImages.length > 1 && (
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              {evidenceImages.map((img, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setActiveImageIndex(idx)}
                  style={{
                    padding: 0,
                    border: idx === activeImageIndex ? '1.5px solid #16a34a' : '1px solid #e2e8f0',
                    borderRadius: 4,
                    overflow: 'hidden',
                    width: 40,
                    height: 40,
                    cursor: 'pointer',
                    background: '#f8fafc',
                  }}
                >
                  <img src={img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 5. Location and Navigation Strip */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: 12,
          color: '#64748b',
          padding: '6px 0',
          borderTop: '1px solid #f1f5f9',
          flexWrap: 'wrap',
          gap: 6,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <MapPin size={12} style={{ color: '#16a34a', flexShrink: 0 }} />
          <span>{rep.address || post.barangay_name || 'Lucena City'}</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {hasLocationCoords && (
            <button
              type="button"
              onClick={handleViewOnMap}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '3px 8px',
                borderRadius: 4,
                background: '#f8fafc',
                border: '1px solid #cbd5e1',
                color: '#0f172a',
                fontSize: 11.5,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <Navigation size={11} style={{ color: '#16a34a' }} />
              <span>View on Map</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setDetailsExpanded(prev => !prev)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
              padding: '3px 6px',
              background: 'transparent',
              border: 'none',
              color: '#64748b',
              fontSize: 11.5,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <span>{detailsExpanded ? 'Hide Details' : 'Details'}</span>
            {detailsExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
        </div>
      </div>

      {/* Collapsible Details (Tracking ID & Assessment) */}
      {detailsExpanded && (
        <div
          style={{
            background: '#f8fafc',
            borderRadius: 6,
            border: '1px solid #e2e8f0',
            padding: '8px 10px',
            fontSize: 11.5,
            color: '#475569',
            marginTop: 6,
            marginBottom: 6,
            lineHeight: 1.5,
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 6 }}>
            <div>
              <span style={{ color: '#94a3b8' }}>Tracking Reference: </span>
              <span style={{ fontWeight: 600, color: '#0f172a' }}>#WR-{rep.id || post.report || post.id}</span>
            </div>
            <div>
              <span style={{ color: '#94a3b8' }}>Status: </span>
              <span style={{ fontWeight: 600, color: statusMeta.color }}>{statusMeta.summary}</span>
            </div>
            {hasLocationCoords && (
              <div>
                <span style={{ color: '#94a3b8' }}>GPS: </span>
                <span style={{ fontWeight: 600, color: '#0f172a' }}>
                  {rep.latitude.toFixed(4)}° N, {rep.longitude.toFixed(4)}° E
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Voting & Verification Consensus */}
      {garbageReportId && (
        <div style={{ marginTop: 6, marginBottom: 6 }}>
          <ReportVoting
            reportId={garbageReportId}
            initialUpvotes={rep.upvotes}
            initialDownvotes={rep.downvotes}
            initialNetVotes={rep.net_votes}
            initialUserVote={rep.user_vote}
            status={statusKey}
            isArchived={rep.is_archived}
            theme="light"
            onAuthRequired={onAuthRequired}
          />
        </div>
      )}

      {/* 6. Reddit-Style Interaction Footer Bar */}
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
            key={`report-post-${post.id}`}
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

      {/* Image Zoom Modal */}
      {imageModalOpen && evidenceImages.length > 0 && (
        <div
          onClick={() => setImageModalOpen(false)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.88)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 3000,
            padding: 20,
            cursor: 'zoom-out',
          }}
        >
          <img
            src={evidenceImages[activeImageIndex] || evidenceImages[0]}
            alt="Expanded evidence preview"
            style={{
              maxWidth: '90vw',
              maxHeight: '90vh',
              borderRadius: 8,
              objectFit: 'contain',
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.3)',
            }}
          />
        </div>
      )}
    </article>
  )
}
