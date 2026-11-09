/**
 * OfficialReportCard.jsx
 * ----------------------
 * Official Municipal Waste Report Card for the WasteWatch Community Feed.
 * Represents an authoritative waste report linked to a GarbageReport.
 *
 * Visual System:
 * - Distinctive official banner and tracking ID
 * - Real backend status presentation (Pending Verification, Verified & Approved, Resolved & Collected)
 * - Structured metadata (Issue Type, Severity, Address, Coordinates, Evidence Photo)
 * - Read-only community confirmation count
 * - Interactive "View on City Map" navigation
 * - Privacy-preserving reporter presentation (no private citizen PII exposed)
 * - Shared likes and comment thread
 *
 * Strict Iconography Rule: Zero emojis. Lucide SVG icons only.
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  FileText,
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
    label: 'Pending Verification',
    bg: '#fffbeb',
    color: '#b45309',
    border: '#fde68a',
    icon: Clock,
    summary: 'Awaiting review.',
  },
  approved: {
    label: 'Verified & Approved',
    bg: '#eff6ff',
    color: '#1d4ed8',
    border: '#bfdbfe',
    icon: CheckCircle2,
    summary: 'Approved for collection.',
  },
  resolved: {
    label: 'Resolved & Collected',
    bg: '#f0fdf4',
    color: '#15803d',
    border: '#bbf7d0',
    icon: CheckCheck,
    summary: 'Marked as resolved.',
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
    color: '#dc2626',
    bg: '#fef2f2',
    border: '#fecaca',
  },
  missed: {
    label: 'Missed Collection',
    icon: Truck,
    color: '#d97706',
    bg: '#fffbeb',
    border: '#fde68a',
  },
  illegal_dumping: {
    label: 'Illegal Dumpsite',
    icon: AlertTriangle,
    color: '#7c3aed',
    bg: '#f5f3ff',
    border: '#ddd6fe',
  },
}

// Severity Metadata
export const SEVERITY_CONFIG = {
  low: { label: 'Low Severity', color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0' },
  medium: { label: 'Medium Severity', color: '#d97706', bg: '#fffbeb', border: '#fde68a' },
  high: { label: 'High Severity', color: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
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
  const IssueIcon = issueMeta.icon

  const sevKey = (rep.severity || 'medium').toLowerCase()
  const sevMeta = SEVERITY_CONFIG[sevKey] || SEVERITY_CONFIG.medium

  // Evidence Images (from report_details or post.image_url)
  const evidenceImages = (rep.images && rep.images.length > 0)
    ? rep.images
    : (post.image_url ? [post.image_url] : [])

  const hasLocationCoords = Boolean(rep.latitude && rep.longitude)

  // Navigate to PublicMap centered on report
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

  // Handle Like
  const handleLikeClick = () => {
    if (!user) {
      if (onAuthRequired) onAuthRequired()
      return
    }
    onLike(post.id)
  }

  // Handle Share
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

  // Handle Delete
  const handleDeleteClick = () => {
    if (!window.confirm('Are you sure you want to delete this report discussion entry?')) return
    onDelete(post.id)
  }

  // Handle Admin Moderate
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
        borderRadius: 14,
        marginBottom: 18,
        border: isHighlighted ? '2px solid #16a34a' : '1px solid #e2e8f0',
        borderLeft: isHighlighted ? '6px solid #16a34a' : '5px solid #d97706',
        boxShadow: isHighlighted
          ? '0 4px 14px rgba(22, 163, 74, 0.16)'
          : '0 2px 6px rgba(0, 0, 0, 0.03)',
        overflow: 'hidden',
        transition: 'border 0.2s, box-shadow 0.2s',
      }}
    >
      {/* ============================================================== */}
      {/* 1. OFFICIAL REPORT HEADER BAR                                  */}
      {/* ============================================================== */}
      <div
        style={{
          background: '#fffdfa',
          padding: '12px 18px',
          borderBottom: '1px solid #fef3c7',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {/* Official Indicator Pill */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '3px 9px',
              borderRadius: 6,
              background: '#fef3c7',
              border: '1px solid #fde68a',
              color: '#92400e',
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: 0.3,
              textTransform: 'uppercase',
            }}
          >
            <ShieldCheck size={13} style={{ color: '#d97706' }} />
            <span>Official Waste Report</span>
          </div>

          {/* Report ID */}
          <span style={{ fontSize: 12, fontWeight: 700, color: '#64748b' }}>
            #WR-{rep.id || post.report || post.id}
          </span>

          {/* Timestamp */}
          <span style={{ fontSize: 11.5, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Clock size={11} />
            {formatRelativeTime(rep.created_at || post.created_at)}
          </span>
        </div>

        {/* Right Header: Official Status Badge + Moderate/Delete */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Status Badge */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '4px 10px',
              borderRadius: 8,
              background: statusMeta.bg,
              border: `1px solid ${statusMeta.border}`,
              color: statusMeta.color,
              fontSize: 12,
              fontWeight: 700,
            }}
            title={statusMeta.summary}
          >
            <StatusIcon size={13} />
            <span>{statusMeta.label}</span>
          </div>

          {/* Admin Moderate Toggle */}
          {isAdmin && (
            <button
              onClick={handleToggleHide}
              title={post.is_hidden ? 'Unhide Report Card' : 'Hide Report Card'}
              style={{
                background: post.is_hidden ? '#fef2f2' : '#f8fafc',
                border: '1px solid #e2e8f0',
                color: post.is_hidden ? '#dc2626' : '#64748b',
                padding: '4px 7px',
                borderRadius: 6,
                fontSize: 11,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              {post.is_hidden ? <Eye size={12} /> : <EyeOff size={12} />}
              <span className="ww-hide-mobile">{post.is_hidden ? 'Restore' : 'Hide'}</span>
            </button>
          )}

          {/* Delete (Admin or Owner) */}
          {(isAuthor || isAdmin) && (
            <button
              onClick={handleDeleteClick}
              title="Delete Report Entry"
              style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                color: '#64748b',
                padding: '4px 7px',
                borderRadius: 6,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <Trash2 size={12} />
            </button>
          )}

          {/* Citizen Flag Modal Trigger (Non-author) */}
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
                padding: '4px 5px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <ShieldAlert size={14} />
            </button>
          )}
        </div>
      </div>

      {/* ============================================================== */}
      {/* 2. CARD BODY                                                   */}
      {/* ============================================================== */}
      <div style={{ padding: '18px 20px 14px' }}>
        {/* Issue Type & Severity Metadata Badges */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          {/* Issue Type Badge */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 10px',
              borderRadius: 6,
              background: issueMeta.bg,
              border: `1px solid ${issueMeta.border}`,
              color: issueMeta.color,
              fontSize: 12.5,
              fontWeight: 700,
            }}
          >
            <IssueIcon size={14} />
            <span>{rep.issue_type_label || issueMeta.label}</span>
          </div>

          {/* Severity Badge */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 9px',
              borderRadius: 6,
              background: sevMeta.bg,
              border: `1px solid ${sevMeta.border}`,
              color: sevMeta.color,
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            <Flame size={13} />
            <span>{sevMeta.label}</span>
          </div>
        </div>

        {/* Report Content / Description */}
        <div
          style={{
            fontSize: 14.5,
            color: '#1e293b',
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            marginBottom: 14,
          }}
        >
          {post.content || rep.description || 'No additional remarks provided by reporter.'}
        </div>

        {/* Evidence Photos (Responsive, max height 280px) */}
        {evidenceImages.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 10 }}>
              <img
                src={evidenceImages[activeImageIndex] || evidenceImages[0]}
                alt="Official report evidence"
                onClick={() => setImageModalOpen(true)}
                style={{
                  width: '100%',
                  maxHeight: 280,
                  objectFit: 'cover',
                  borderRadius: 10,
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
                    bottom: 8,
                    right: 8,
                    background: 'rgba(15, 23, 42, 0.78)',
                    color: '#ffffff',
                    fontSize: 11,
                    fontWeight: 700,
                    padding: '3px 8px',
                    borderRadius: 6,
                    backdropFilter: 'blur(4px)',
                  }}
                >
                  {activeImageIndex + 1} of {evidenceImages.length} Photos
                </div>
              )}
            </div>

            {/* Thumbnail row if multiple evidence photos */}
            {evidenceImages.length > 1 && (
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                {evidenceImages.map((img, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setActiveImageIndex(idx)}
                    style={{
                      padding: 0,
                      border: idx === activeImageIndex ? '2px solid #d97706' : '1px solid #e2e8f0',
                      borderRadius: 6,
                      overflow: 'hidden',
                      width: 48,
                      height: 48,
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

        {/* Location & Navigation Bar */}
        <div
          style={{
            background: '#f8fafc',
            borderRadius: 8,
            padding: '10px 14px',
            border: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 10,
            marginBottom: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 200 }}>
            <MapPin size={16} style={{ color: '#d97706', flexShrink: 0 }} />
            <div style={{ fontSize: 13, color: '#334155', fontWeight: 600 }}>
              <span>{rep.address || post.barangay_name || 'Lucena City'}</span>
              {post.barangay_name && rep.address && !rep.address.includes(post.barangay_name) && (
                <span style={{ color: '#64748b', fontWeight: 500 }}> · {post.barangay_name}</span>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* View on Map CTA */}
            {hasLocationCoords && (
              <button
                type="button"
                onClick={handleViewOnMap}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '6px 11px',
                  borderRadius: 6,
                  background: '#ffffff',
                  border: '1px solid #cbd5e1',
                  color: '#0f172a',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'background 0.15s',
                }}
              >
                <Navigation size={13} style={{ color: '#2563eb' }} />
                <span>View on Map</span>
              </button>
            )}

            {/* Expand Details Toggle */}
            <button
              type="button"
              onClick={() => setDetailsExpanded(prev => !prev)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '6px 10px',
                borderRadius: 6,
                background: 'transparent',
                border: 'none',
                color: '#64748b',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <span>{detailsExpanded ? 'Less' : 'Details'}</span>
              {detailsExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
          </div>
        </div>

        {/* Collapsible Permitted Report Details Drawer */}
        {detailsExpanded && (
          <div
            style={{
              background: '#f8fafc',
              borderRadius: 8,
              border: '1px solid #e2e8f0',
              padding: '12px 14px',
              fontSize: 12.5,
              color: '#475569',
              marginBottom: 14,
              lineHeight: 1.5,
            }}
          >
            <div style={{ fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>
              Report Details & Status Breakdown
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
              <div>
                <span style={{ color: '#94a3b8' }}>Status Assessment: </span>
                <span style={{ fontWeight: 600, color: statusMeta.color }}>{statusMeta.summary}</span>
              </div>
              {hasLocationCoords && (
                <div>
                  <span style={{ color: '#94a3b8' }}>Coordinates: </span>
                  <span style={{ fontWeight: 600, color: '#0f172a' }}>
                    {rep.latitude.toFixed(5)}° N, {rep.longitude.toFixed(5)}° E
                  </span>
                </div>
              )}
              <div>
                <span style={{ color: '#94a3b8' }}>Attribution: </span>
                <span style={{ fontWeight: 600, color: '#0f172a' }}>
                  {post.author_name || 'Community Waste Report'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Civic Verification Voting & Consensus Indicators */}
        {garbageReportId && (
          <div style={{ marginTop: 14 }}>
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
      </div>

      {/* ============================================================== */}
      {/* 3. INTERACTION FOOTER BAR (Likes, Comments, Share)             */}
      {/* ============================================================== */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderTop: '1px solid #f1f5f9',
          padding: '10px 20px',
          background: '#ffffff',
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
              size={15}
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
              background: commentsOpen ? '#fffdfa' : 'transparent',
              border: commentsOpen ? '1px solid #fde68a' : '1px solid transparent',
              color: commentsOpen ? '#b45309' : '#64748b',
              padding: '6px 12px',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <MessageSquare size={15} />
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

      {/* ============================================================== */}
      {/* 4. EXPANDABLE SHARED COMMENT THREAD                            */}
      {/* ============================================================== */}
      {commentsOpen && (
        <CommentThread
          key={`report-post-${post.id}`}
          postId={post.id}
          onCommentCountChange={setLocalCommentCount}
          onAuthRequired={onAuthRequired}
        />
      )}

      {/* Citizen Concern Report Modal */}
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
              borderRadius: 12,
              objectFit: 'contain',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)',
            }}
          />
        </div>
      )}
    </article>
  )
}
