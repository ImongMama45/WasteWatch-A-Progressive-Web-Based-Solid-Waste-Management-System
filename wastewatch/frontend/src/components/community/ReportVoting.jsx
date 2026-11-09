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
 *   - Positive vote (+1): "Confirm Issue" ("Still uncollected")
 *   - Negative vote (-1): "Confirm Cleared" ("Already resolved")
 *   - Consensus Indicators:
 *       * Still Present: authoritative positive count
 *       * Confirmed Cleared: authoritative negative count
 *       * Community Consensus: authoritative net score (+/-)
 *   - Strict Report Identity Safety:
 *       * Validates reportId using parsePositiveSafeInteger
 *       * Never falls back to hotspot IDs
 *       * Only renders for authoritative GarbageReports
 *   - Async Response & State Reliability:
 *       * Request sequence tracking and unmount guards discard stale responses
 *       * Dedicated initial-load error and retry states prevent fabricated zero counts
 *       * Existing votes on ineligible reports may be removed, but new votes are prevented
 *   - Zero emojis: Lucide SVG icons only.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Flame,
  CheckCircle2,
  Users,
  Loader2,
  Check,
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
  const isAdmin = user?.role === 'admin'
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

    setIsSubmitting(true)

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
        const newUp = Number(d.upvotes) || 0
        const newDown = Number(d.downvotes) || 0
        const newNet = d.net_votes !== undefined ? Number(d.net_votes) : (newUp - newDown)
        setUpvotes(newUp)
        setDownvotes(newDown)
        setNetVotes(newNet)
      }
      setUserVote(d.user_vote ?? null)

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
      console.error('[ReportVoting] Vote failed:', err)
      notify({
        variant: 'error-dark',
        message: getApiErrorMessage(err, 'Failed to update community verification vote.'),
      })
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

  // Visual Palette
  const styles = {
    container: {
      background: isDark ? 'rgba(255, 255, 255, 0.03)' : '#f8fafc',
      border: `1px solid ${isDark ? 'rgba(255, 255, 255, 0.08)' : '#e2e8f0'}`,
      borderRadius: 12,
      padding: '12px 14px',
      margin: '6px 0',
      fontFamily: 'inherit',
    },
    header: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: 10,
    },
    headerTitle: {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      fontSize: 12,
      fontWeight: 700,
      color: isDark ? '#94a3b8' : '#475569',
      textTransform: 'uppercase',
      letterSpacing: '0.04em',
    },
    consensusRow: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      flexWrap: 'wrap',
      fontSize: 12,
    },
    badge: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      padding: '3px 8px',
      borderRadius: 6,
      fontSize: 12,
      fontWeight: 600,
    },
    buttonGrid: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 10,
      marginTop: 4,
    },
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
      statusNotice = 'Community voting is closed for rejected reports.'
    } else if (isArchived) {
      statusNotice = 'Community voting is closed for archived reports.'
    } else {
      statusNotice = 'Community verification opens once an official report is verified and approved.'
    }
  }

  return (
    <div style={styles.container}>
      <style>{`
        @keyframes wwSpin {
          100% { transform: rotate(360deg); }
        }
        .ww-spin {
          animation: wwSpin 1.5s linear infinite;
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
            padding: '10px 12px',
            borderRadius: 8,
            background: isDark ? 'rgba(239, 68, 68, 0.1)' : '#fef2f2',
            border: `1px solid ${isDark ? 'rgba(239, 68, 68, 0.25)' : '#fecaca'}`,
            color: isDark ? '#fca5a5' : '#b91c1c',
            fontSize: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertCircle size={15} />
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
              padding: '4px 10px',
              borderRadius: 6,
              background: isDark ? 'rgba(239, 68, 68, 0.2)' : '#ffffff',
              border: `1px solid ${isDark ? 'rgba(239, 68, 68, 0.4)' : '#f87171'}`,
              color: isDark ? '#fca5a5' : '#b91c1c',
              fontSize: 11.5,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {isLoading ? <Loader2 size={12} className="ww-spin" /> : <RotateCw size={12} />}
            <span>Retry</span>
          </button>
        </div>
      ) : isLoading && !isLoaded ? (
        /* ── Initial Loading Indicator ── */
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '12px 8px',
            color: isDark ? '#94a3b8' : '#64748b',
            fontSize: 12,
          }}
        >
          <Loader2 size={14} className="ww-spin" />
          <span>Loading community consensus...</span>
        </div>
      ) : (
        /* ── Loaded Authoritative Vote & Consensus Display ── */
        <>
          {/* Consensus Indicators Summary Bar */}
          <div style={styles.header}>
            <div style={styles.headerTitle}>
              <Users size={14} />
              <span>Community Consensus</span>
            </div>

            <div style={styles.consensusRow}>
              {/* Still Present */}
              <div
                style={{
                  ...styles.badge,
                  background: isDark ? 'rgba(249, 115, 22, 0.12)' : '#fff7ed',
                  color: isDark ? '#fb923c' : '#c2410c',
                  border: `1px solid ${isDark ? 'rgba(249, 115, 22, 0.25)' : '#fed7aa'}`,
                }}
                title="Number of community members confirming the issue is still uncollected"
              >
                <span>Still Present:</span>
                <b>{upvotes}</b>
              </div>

              {/* Confirmed Cleared */}
              <div
                style={{
                  ...styles.badge,
                  background: isDark ? 'rgba(34, 197, 94, 0.12)' : '#f0fdf4',
                  color: isDark ? '#4ade80' : '#15803d',
                  border: `1px solid ${isDark ? 'rgba(34, 197, 94, 0.25)' : '#bbf7d0'}`,
                }}
                title="Number of community members confirming the problem has been resolved"
              >
                <span>Confirmed Cleared:</span>
                <b>{downvotes}</b>
              </div>

              {/* Net Consensus */}
              <div
                style={{
                  ...styles.badge,
                  background: isDark ? 'rgba(255, 255, 255, 0.05)' : '#ffffff',
                  color: consensusColor,
                  border: `1px solid ${isDark ? 'rgba(255, 255, 255, 0.12)' : '#cbd5e1'}`,
                  fontWeight: 700,
                }}
                title="Community Net Consensus (Positive minus Negative votes)"
              >
                <span>Consensus:</span>
                <span>{consensusSign}</span>
              </div>
            </div>
          </div>

          {/* Ineligible Status Notice (if not approved/resolved and no existing vote to remove) */}
          {!isEligibleStatus && userVote === null ? (
            <div
              style={{
                padding: '8px 10px',
                borderRadius: 8,
                fontSize: 12,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: isDark ? 'rgba(255, 255, 255, 0.03)' : '#f1f5f9',
                color: isDark ? '#94a3b8' : '#64748b',
              }}
            >
              <Info size={14} />
              <span>{statusNotice}</span>
            </div>
          ) : (
            /* Action Buttons (Enabled or displaying existing vote removal) */
            <div style={styles.buttonGrid}>
              {/* Positive Vote Action: Confirm Issue */}
              <button
                type="button"
                onClick={() => handleVoteClick(1)}
                disabled={isSubmitting || isLoading || (!isEligibleStatus && userVote !== 1)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: userVote === 1
                    ? '1px solid #f97316'
                    : `1px solid ${isDark ? 'rgba(255, 255, 255, 0.1)' : '#e2e8f0'}`,
                  background: userVote === 1
                    ? (isDark ? 'rgba(249, 115, 22, 0.2)' : '#fff7ed')
                    : (isDark ? 'rgba(255, 255, 255, 0.02)' : '#ffffff'),
                  color: userVote === 1
                    ? (isDark ? '#fb923c' : '#c2410c')
                    : (isDark ? '#e2e8f0' : '#334155'),
                  cursor: isSubmitting || (!isEligibleStatus && userVote !== 1) ? 'not-allowed' : 'pointer',
                  opacity: (!isEligibleStatus && userVote !== 1) ? 0.5 : 1,
                  transition: 'all 0.15s ease',
                  outline: 'none',
                  textAlign: 'left',
                  width: '100%',
                  boxShadow: userVote === 1 ? '0 0 0 1px #f97316' : 'none',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Flame size={15} color={userVote === 1 ? '#f97316' : (isDark ? '#fb923c' : '#ea580c')} />
                    <span style={{ fontSize: 13, fontWeight: 700 }}>Confirm Issue</span>
                  </div>
                  {userVote === 1 && <Check size={14} color="#f97316" />}
                  {isSubmitting && userVote !== 1 && <Loader2 size={13} className="ww-spin" />}
                </div>
                <span
                  style={{
                    fontSize: 11,
                    color: userVote === 1
                      ? (isDark ? '#fdba74' : '#9a3412')
                      : (isDark ? '#94a3b8' : '#64748b'),
                    marginTop: 2,
                    fontWeight: 500,
                  }}
                >
                  Still uncollected
                </span>
              </button>

              {/* Negative Vote Action: Confirm Cleared */}
              <button
                type="button"
                onClick={() => handleVoteClick(-1)}
                disabled={isSubmitting || isLoading || (!isEligibleStatus && userVote !== -1)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: userVote === -1
                    ? '1px solid #22c55e'
                    : `1px solid ${isDark ? 'rgba(255, 255, 255, 0.1)' : '#e2e8f0'}`,
                  background: userVote === -1
                    ? (isDark ? 'rgba(34, 197, 94, 0.2)' : '#f0fdf4')
                    : (isDark ? 'rgba(255, 255, 255, 0.02)' : '#ffffff'),
                  color: userVote === -1
                    ? (isDark ? '#4ade80' : '#15803d')
                    : (isDark ? '#e2e8f0' : '#334155'),
                  cursor: isSubmitting || (!isEligibleStatus && userVote !== -1) ? 'not-allowed' : 'pointer',
                  opacity: (!isEligibleStatus && userVote !== -1) ? 0.5 : 1,
                  transition: 'all 0.15s ease',
                  outline: 'none',
                  textAlign: 'left',
                  width: '100%',
                  boxShadow: userVote === -1 ? '0 0 0 1px #22c55e' : 'none',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <CheckCircle2 size={15} color={userVote === -1 ? '#22c55e' : (isDark ? '#4ade80' : '#16a34a')} />
                    <span style={{ fontSize: 13, fontWeight: 700 }}>Confirm Cleared</span>
                  </div>
                  {userVote === -1 && <Check size={14} color="#22c55e" />}
                  {isSubmitting && userVote !== -1 && <Loader2 size={13} className="ww-spin" />}
                </div>
                <span
                  style={{
                    fontSize: 11,
                    color: userVote === -1
                  ? (isDark ? '#86efac' : '#166534')
                  : (isDark ? '#94a3b8' : '#64748b'),
                    marginTop: 2,
                    fontWeight: 500,
                  }}
                >
                  Already resolved
                </span>
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
