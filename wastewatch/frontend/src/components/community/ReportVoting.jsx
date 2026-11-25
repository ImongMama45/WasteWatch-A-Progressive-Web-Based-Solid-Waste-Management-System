/**
 * ReportVoting.jsx
 * ----------------
 * Shared Civic Verification Voting & Consensus Indicators component.
 * Reused in:
 *   - OfficialReportCard (Community Feed)
 *   - MapView (ReportPanel detail drawer)
 *   - PublicMap (ReportSelectedPanel)
 *
 * Product Rules & Semantics:
 *   - Positive vote (+1): "Confirm Issue" ("Still uncollected") -> Trash2 icon
 *   - Negative vote (-1): "Confirm Cleared" ("Already resolved") -> CheckCircle2 icon
 *   - Consensus Indicators:
 *       * Still Present: authoritative positive count
 *       * Confirmed Cleared: authoritative negative count
 *       * Community Consensus: authoritative net score (+/-)
 *   - Compact Reddit-Inspired Interaction:
 *       * Horizontal voting control bar replacing oversized card-in-card buttons
 *       * Optimistic UI voting with automatic state rollback on server rejection
 *       * Accessible aria-label, aria-pressed, and hover/focus tooltips
 *       * Zero emojis: Lucide SVG icons only.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Trash2,
  CheckCircle2,
  Users,
  Loader2,
  Info,
  AlertCircle,
  RotateCw,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useNotification } from '../../context/NotificationContext'
import api from '../../api/client'
import { getApiErrorMessage } from '../../utils/notificationHelpers'
import { parsePositiveSafeInteger } from '../../utils/reportIdentity'

export default function ReportVoting({
  reportId,
  initialUpvotes,
  initialDownvotes,
  initialNetVotes,
  initialUserVote,
  status = 'approved',
  isArchived = false,
  barangayId = null,
  theme = 'light',
  onVoteChange,
  onAuthRequired,
}) {
  const { user } = useAuth()
  const { notify } = useNotification()
  const navigate = useNavigate()

  const validReportId = parsePositiveSafeInteger(reportId)

  // Mount tracking, request sequencing, and active report tracking
  const isMountedRef = useRef(true)
  const requestSeqRef = useRef(0)
  const activeReportIdRef = useRef(validReportId)
  activeReportIdRef.current = validReportId

  // Previous authoritative state backup for optimistic rollback
  const previousStateRef = useRef(null)
  // Last action for retry on temporary failure
  const pendingActionRef = useRef(null)

  // State management
  const [upvotes, setUpvotes] = useState(
    initialUpvotes !== undefined ? Number(initialUpvotes) || 0 : 0
  )
  const [downvotes, setDownvotes] = useState(
    initialDownvotes !== undefined ? Number(initialDownvotes) || 0 : 0
  )
  const [netVotes, setNetVotes] = useState(
    initialNetVotes !== undefined
      ? Number(initialNetVotes) || 0
      : initialUpvotes !== undefined && initialDownvotes !== undefined
        ? (Number(initialUpvotes) || 0) - (Number(initialDownvotes) || 0)
        : 0
  )
  const [userVote, setUserVote] = useState(initialUserVote ?? null)
  const [isLoaded, setIsLoaded] = useState(initialUpvotes !== undefined)
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [syncStatus, setSyncStatus] = useState('idle') // 'idle' | 'syncing' | 'failed'

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  // Authoritative vote fetcher (with sequence protection, active report guard, and retry support)
  const fetchAuthoritativeVotes = useCallback((targetId) => {
    if (!targetId) return

    const seq = ++requestSeqRef.current
    setIsLoading(true)
    setLoadError(null)

    api.get(`/api/watcher/reports/${targetId}/`)
      .then(res => {
        if (
          !isMountedRef.current ||
          seq !== requestSeqRef.current ||
          activeReportIdRef.current !== targetId
        ) {
          return
        }
        const d = res.data || {}
        const up = d.upvotes ?? 0
        const down = d.downvotes ?? 0
        setUpvotes(up)
        setDownvotes(down)
        setNetVotes(d.net_votes ?? (up - down))
        setUserVote(d.user_vote ?? null)
        setIsLoaded(true)
        setLoadError(null)
        setSyncStatus('idle')
      })
      .catch(err => {
        if (
          !isMountedRef.current ||
          seq !== requestSeqRef.current ||
          activeReportIdRef.current !== targetId
        ) {
          return
        }
        console.warn(`[ReportVoting] Could not fetch vote counts for report #${targetId}:`, err)
        setIsLoaded(false)
        setLoadError('Voting information unavailable.')
      })
      .finally(() => {
        if (
          isMountedRef.current &&
          seq === requestSeqRef.current &&
          activeReportIdRef.current === targetId
        ) {
          setIsLoading(false)
        }
      })
  }, [])

  // Reset and synchronize when report or initial props change
  useEffect(() => {
    // Invalidate any in-flight requests from a previous report
    const seq = ++requestSeqRef.current
    activeReportIdRef.current = validReportId
    setLoadError(null)
    setIsSubmitting(false) // Always reset isSubmitting for the new report
    setSyncStatus('idle')
    pendingActionRef.current = null
    previousStateRef.current = null

    if (!validReportId) {
      setUpvotes(0)
      setDownvotes(0)
      setNetVotes(0)
      setUserVote(null)
      setIsLoaded(false)
      setIsLoading(false)
      return
    }

    // Community feed path: initial props already supplied by API serializer
    if (initialUpvotes !== undefined) {
      setUpvotes(Number(initialUpvotes) || 0)
      setDownvotes(Number(initialDownvotes) || 0)
      setNetVotes(
        Number(initialNetVotes ?? ((Number(initialUpvotes) || 0) - (Number(initialDownvotes) || 0))) || 0
      )
      setUserVote(initialUserVote ?? null)
      setIsLoaded(true)
      setIsLoading(false)
      return
    }

    // Map View fallback path: fetch authoritative report vote data
    setIsLoaded(false)
    setIsLoading(true)

    api.get(`/api/watcher/reports/${validReportId}/`)
      .then(res => {
        if (
          !isMountedRef.current ||
          seq !== requestSeqRef.current ||
          activeReportIdRef.current !== validReportId
        ) {
          return
        }
        const d = res.data || {}
        const up = d.upvotes ?? 0
        const down = d.downvotes ?? 0
        setUpvotes(up)
        setDownvotes(down)
        setNetVotes(d.net_votes ?? (up - down))
        setUserVote(d.user_vote ?? null)
        setIsLoaded(true)
        setLoadError(null)
      })
      .catch(err => {
        if (
          !isMountedRef.current ||
          seq !== requestSeqRef.current ||
          activeReportIdRef.current !== validReportId
        ) {
          return
        }
        console.warn(`[ReportVoting] Could not fetch vote counts for report #${validReportId}:`, err)
        setIsLoaded(false)
        setLoadError('Voting information unavailable.')
      })
      .finally(() => {
        if (
          isMountedRef.current &&
          seq === requestSeqRef.current &&
          activeReportIdRef.current === validReportId
        ) {
          setIsLoading(false)
        }
      })
  }, [validReportId, initialUpvotes, initialDownvotes, initialNetVotes, initialUserVote])

  // If no valid GarbageReport ID, do not render voting UI
  if (!validReportId) {
    return null
  }

  const isDark = theme === 'dark'
  const normStatus = String(status).toLowerCase()
  const isEligibleStatus = !isArchived && ['approved', 'resolved'].includes(normStatus)
  const isDriver = user?.role === 'driver'
  const isRoleEligible = ['citizen', 'watcher', 'brgy_official'].includes(user?.role)

  const handleVoteClick = async (targetVote) => {
    if (isSubmitting || isLoading || loadError || !isLoaded) return

    // 1. Authentication check
    if (!user) {
      if (onAuthRequired) {
        onAuthRequired()
      } else {
        navigate('/login')
      }
      return
    }

    // 2. Role eligibility check
    if (!isRoleEligible) {
      notify({
        variant: 'error-dark',
        message: isDriver
          ? 'Drivers cannot cast civic verification votes on reports.'
          : 'Administrators view consensus results in view-only mode.',
      })
      return
    }

    // 3. User barangay assignment check (support user.barangay, user.barangay.id, or user.barangay_id)
    const userBarangayId =
      user?.barangay != null
        ? (typeof user.barangay === 'object' ? user.barangay.id : user.barangay)
        : user?.barangay_id != null
          ? user.barangay_id
          : null

    if (!userBarangayId) {
      notify({
        variant: 'error-dark',
        message: 'Users without an assigned barangay cannot vote.',
      })
      return
    }

    // 4. Determine action: Remove existing vote (DELETE) or Cast/Update vote (POST)
    const isRemoving = userVote === targetVote

    // 5. Status eligibility check:
    // Existing votes may be removed on ineligible reports, but new votes cannot be created
    if (!isEligibleStatus && !isRemoving) {
      let statusMsg = 'Only approved or resolved reports are eligible for community voting.'
      if (normStatus === 'rejected') {
        statusMsg = 'Community voting is closed for rejected reports.'
      } else if (isArchived) {
        statusMsg = 'Community voting is closed for archived reports.'
      } else if (normStatus === 'pending') {
        statusMsg = 'Community verification opens once an official report is verified and approved.'
      }
      notify({
        variant: 'error-dark',
        message: statusMsg,
      })
      return
    }

    // 6. Cross-barangay check (if report barangay ID is available on client)
    if (barangayId && userBarangayId !== barangayId && !isRemoving) {
      notify({
        variant: 'error-dark',
        message: 'Cannot vote on reports outside your assigned barangay.',
      })
      return
    }

    // Capture submission identity to prevent race conditions across report selection
    const submissionSeq = requestSeqRef.current
    const submissionReportId = validReportId

    // Save previous state for rollback
    previousStateRef.current = {
      upvotes,
      downvotes,
      netVotes,
      userVote,
    }
    pendingActionRef.current = { targetVote, isRemoving }

    // Compute optimistic state update
    let nextUpvotes = upvotes
    let nextDownvotes = downvotes
    let nextUserVote = null

    if (isRemoving) {
      nextUserVote = null
      if (userVote === 1) {
        nextUpvotes = Math.max(0, upvotes - 1)
      } else if (userVote === -1) {
        nextDownvotes = Math.max(0, downvotes - 1)
      }
    } else if (targetVote === 1) {
      nextUserVote = 1
      nextUpvotes = upvotes + 1
      if (userVote === -1) {
        nextDownvotes = Math.max(0, downvotes - 1)
      }
    } else if (targetVote === -1) {
      nextUserVote = -1
      nextDownvotes = downvotes + 1
      if (userVote === 1) {
        nextUpvotes = Math.max(0, upvotes - 1)
      }
    }

    const nextNetVotes = nextUpvotes - nextDownvotes

    // Apply optimistic updates immediately
    setUpvotes(nextUpvotes)
    setDownvotes(nextDownvotes)
    setNetVotes(nextNetVotes)
    setUserVote(nextUserVote)
    setIsSubmitting(true)
    setSyncStatus('syncing')

    try {
      let res
      if (isRemoving) {
        res = await api.delete(`/api/watcher/reports/${submissionReportId}/vote/`)
      } else {
        res = await api.post(`/api/watcher/reports/${submissionReportId}/vote/`, {
          vote_type: targetVote,
        })
      }

      // Async Safety Guard: Discard stale response if report switched or unmounted
      if (
        !isMountedRef.current ||
        requestSeqRef.current !== submissionSeq ||
        activeReportIdRef.current !== submissionReportId
      ) {
        return
      }

      const d = res.data || {}
      if (d.upvotes !== undefined && d.downvotes !== undefined) {
        const serverUp = Number(d.upvotes) || 0
        const serverDown = Number(d.downvotes) || 0
        const serverNet = d.net_votes !== undefined ? Number(d.net_votes) : (serverUp - serverDown)
        setUpvotes(serverUp)
        setDownvotes(serverDown)
        setNetVotes(serverNet)
      }
      setUserVote(d.user_vote ?? nextUserVote)
      setSyncStatus('idle')
      pendingActionRef.current = null

      if (onVoteChange) {
        onVoteChange(d)
      }

      notify({
        variant: 'success',
        message: isRemoving
          ? 'Vote removed.'
          : targetVote === 1
            ? 'Confirmed issue: still uncollected.'
            : 'Confirmed cleared: marked as resolved.',
      })
    } catch (err) {
      if (
        !isMountedRef.current ||
        requestSeqRef.current !== submissionSeq ||
        activeReportIdRef.current !== submissionReportId
      ) {
        return
      }
      console.error('[ReportVoting] Vote request failed:', err)
      const statusCode = err?.response?.status

      // Rollback immediately on 4xx permission / eligibility errors
      if (statusCode && statusCode >= 400 && statusCode < 500) {
        if (previousStateRef.current) {
          setUpvotes(previousStateRef.current.upvotes)
          setDownvotes(previousStateRef.current.downvotes)
          setNetVotes(previousStateRef.current.netVotes)
          setUserVote(previousStateRef.current.userVote)
        }
        setSyncStatus('idle')
        pendingActionRef.current = null
        notify({
          variant: 'error-dark',
          message: getApiErrorMessage(err, 'Failed to update community verification vote.'),
        })
      } else {
        // Mark as failed and allow manual retry without discarding optimistic state
        setSyncStatus('failed')
        notify({
          variant: 'error-dark',
          message: getApiErrorMessage(err, 'Unable to sync verification vote. Click Retry to synchronize.'),
        })
      }
    } finally {
      if (
        isMountedRef.current &&
        requestSeqRef.current === submissionSeq &&
        activeReportIdRef.current === submissionReportId
      ) {
        setIsSubmitting(false)
      }
    }
  }

  const handleRetryVote = () => {
    if (!pendingActionRef.current || isSubmitting) return
    handleVoteClick(pendingActionRef.current.targetVote)
  }

  const consensusColor =
    netVotes > 0
      ? isDark ? '#fb923c' : '#c2410c'
      : netVotes < 0
        ? isDark ? '#4ade80' : '#15803d'
        : isDark ? '#94a3b8' : '#64748b'

  const consensusSign = netVotes > 0 ? `+${netVotes}` : `${netVotes}`

  // Status-appropriate informational notice
  let statusNotice = null
  if (!isEligibleStatus) {
    if (normStatus === 'rejected') {
      statusNotice = 'Community voting closed: rejected report.'
    } else if (isArchived) {
      statusNotice = 'Community voting closed: archived report.'
    } else {
      statusNotice = 'Verification opens once verified & approved.'
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 8,
        padding: '6px 10px',
        borderRadius: 8,
        background: isDark ? 'rgba(255, 255, 255, 0.03)' : '#f8fafc',
        border: `1px solid ${isDark ? 'rgba(255, 255, 255, 0.08)' : '#e2e8f0'}`,
        margin: '4px 0',
        fontFamily: 'inherit',
      }}
    >
      <style>{`
        @keyframes wwSpin {
          100% { transform: rotate(360deg); }
        }
        .ww-spin {
          animation: wwSpin 1.5s linear infinite;
        }
        .ww-vote-pill-btn:hover:not(:disabled) {
          background: rgba(148, 163, 184, 0.15) !important;
        }
        .ww-vote-pill-btn:focus-visible {
          outline: 2px solid #16a34a !important;
          outline-offset: 1px !important;
        }
      `}</style>

      {/* ── Initial Load Error State ── */}
      {loadError && !isLoaded ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            width: '100%',
            padding: '4px 6px',
            color: isDark ? '#fca5a5' : '#b91c1c',
            fontSize: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertCircle size={14} />
            <span>{loadError}</span>
          </div>
          <button
            type="button"
            onClick={() => fetchAuthoritativeVotes(validReportId)}
            disabled={isLoading}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '3px 8px',
              borderRadius: 6,
              background: isDark ? 'rgba(239, 68, 68, 0.2)' : '#ffffff',
              border: `1px solid ${isDark ? 'rgba(239, 68, 68, 0.4)' : '#f87171'}`,
              color: isDark ? '#fca5a5' : '#b91c1c',
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {isLoading ? <Loader2 size={11} className="ww-spin" /> : <RotateCw size={11} />}
            <span>Retry</span>
          </button>
        </div>
      ) : isLoading && !isLoaded ? (
        /* ── Initial Loading Indicator ── */
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 6px',
            color: isDark ? '#94a3b8' : '#64748b',
            fontSize: 12,
          }}
        >
          <Loader2 size={13} className="ww-spin" />
          <span>Loading consensus…</span>
        </div>
      ) : (
        /* ── Compact Reddit-Inspired Consensus Control Bar ── */
        <>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {/* Consensus Title */}
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 11,
                fontWeight: 700,
                color: isDark ? '#94a3b8' : '#475569',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              <Users size={13} />
              <span>Consensus</span>
            </div>

            {/* Voting Pill Group */}
            {!isEligibleStatus && userVote === null ? (
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  fontSize: 11.5,
                  color: isDark ? '#94a3b8' : '#64748b',
                  fontStyle: 'italic',
                }}
              >
                <Info size={12} />
                <span>{statusNotice}</span>
              </div>
            ) : (
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  background: isDark ? 'rgba(255, 255, 255, 0.05)' : '#ffffff',
                  border: `1px solid ${isDark ? 'rgba(255, 255, 255, 0.12)' : '#cbd5e1'}`,
                  borderRadius: 20,
                  padding: '2px 4px',
                  gap: 2,
                }}
              >
                {/* Positive Vote Action: Confirm Issue (Still uncollected) */}
                <button
                  type="button"
                  onClick={() => handleVoteClick(1)}
                  disabled={isSubmitting || isLoading || (!isEligibleStatus && userVote !== 1)}
                  aria-label="Confirm Issue (Still uncollected)"
                  aria-pressed={userVote === 1}
                  title="Confirm Issue (Still uncollected)"
                  className="ww-vote-pill-btn"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '3px 8px',
                    borderRadius: 14,
                    border: 'none',
                    background: userVote === 1
                      ? (isDark ? 'rgba(249, 115, 22, 0.22)' : '#fff7ed')
                      : 'transparent',
                    color: userVote === 1
                      ? (isDark ? '#fb923c' : '#ea580c')
                      : (isDark ? '#cbd5e1' : '#475569'),
                    fontWeight: userVote === 1 ? 700 : 600,
                    fontSize: 12,
                    cursor: isSubmitting || (!isEligibleStatus && userVote !== 1) ? 'not-allowed' : 'pointer',
                    opacity: (!isEligibleStatus && userVote !== 1) ? 0.45 : 1,
                    transition: 'all 0.15s ease',
                    outline: 'none',
                  }}
                >
                  <Trash2 size={13} strokeWidth={userVote === 1 ? 2.4 : 1.8} />
                  <span>{upvotes}</span>
                </button>

                <span
                  style={{
                    width: 1,
                    height: 14,
                    background: isDark ? 'rgba(255, 255, 255, 0.12)' : '#e2e8f0',
                  }}
                />

                {/* Negative Vote Action: Confirm Cleared (Already resolved) */}
                <button
                  type="button"
                  onClick={() => handleVoteClick(-1)}
                  disabled={isSubmitting || isLoading || (!isEligibleStatus && userVote !== -1)}
                  aria-label="Confirm Cleared (Already resolved)"
                  aria-pressed={userVote === -1}
                  title="Confirm Cleared (Already resolved)"
                  className="ww-vote-pill-btn"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '3px 8px',
                    borderRadius: 14,
                    border: 'none',
                    background: userVote === -1
                      ? (isDark ? 'rgba(34, 197, 94, 0.22)' : '#f0fdf4')
                      : 'transparent',
                    color: userVote === -1
                      ? (isDark ? '#4ade80' : '#16a34a')
                      : (isDark ? '#cbd5e1' : '#475569'),
                    fontWeight: userVote === -1 ? 700 : 600,
                    fontSize: 12,
                    cursor: isSubmitting || (!isEligibleStatus && userVote !== -1) ? 'not-allowed' : 'pointer',
                    opacity: (!isEligibleStatus && userVote !== -1) ? 0.45 : 1,
                    transition: 'all 0.15s ease',
                    outline: 'none',
                  }}
                >
                  <CheckCircle2 size={13} strokeWidth={userVote === -1 ? 2.4 : 1.8} />
                  <span>{downvotes}</span>
                </button>
              </div>
            )}

            {/* Syncing indicator */}
            {syncStatus === 'syncing' && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 11,
                  color: isDark ? '#94a3b8' : '#64748b',
                }}
              >
                <Loader2 size={11} className="ww-spin" />
                <span>Syncing…</span>
              </span>
            )}

            {/* Sync Failed Retry Button */}
            {syncStatus === 'failed' && (
              <button
                type="button"
                onClick={handleRetryVote}
                title="Vote saved locally. Tap to retry sync with server."
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                  padding: '2px 7px',
                  borderRadius: 10,
                  background: isDark ? 'rgba(239, 68, 68, 0.15)' : '#fef2f2',
                  border: `1px solid ${isDark ? 'rgba(239, 68, 68, 0.3)' : '#fecaca'}`,
                  color: isDark ? '#fca5a5' : '#dc2626',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                <RotateCw size={10} />
                <span>Retry Sync</span>
              </button>
            )}
          </div>

          {/* Right side: Authoritative Net Consensus Badge */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 11.5,
            }}
          >
            <span style={{ color: isDark ? '#94a3b8' : '#64748b', fontSize: 11 }}>Net:</span>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '2px 7px',
                borderRadius: 8,
                fontSize: 11.5,
                fontWeight: 700,
                background: isDark ? 'rgba(255, 255, 255, 0.05)' : '#ffffff',
                color: consensusColor,
                border: `1px solid ${isDark ? 'rgba(255, 255, 255, 0.12)' : '#cbd5e1'}`,
              }}
              title={`Community Net Score: ${consensusSign}`}
            >
              {consensusSign}
            </span>
          </div>
        </>
      )}
    </div>
  )
}
