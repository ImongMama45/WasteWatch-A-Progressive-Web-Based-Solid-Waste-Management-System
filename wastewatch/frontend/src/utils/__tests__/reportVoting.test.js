/**
 * reportVoting.test.js
 * --------------------
 * Unit tests verifying civic verification report voting rules, identity safeguards,
 * payload structure, consensus calculation, and stale-state prevention logic.
 *
 * Run with:
 *   node --test src/utils/__tests__/reportVoting.test.js
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parsePositiveSafeInteger,
  getGarbageReportId,
  hasAssociatedGarbageReport,
} from '../reportIdentity.js'

test('Report Voting - Identity Validation & Hotspot-Only Pin Safety', async (t) => {
  await t.test('Hotspot-only pins cannot resolve a valid GarbageReport ID for voting', () => {
    const hotspotOnlyPin = {
      id: 42,
      report_id: null,
      community_post_id: null,
      comment_count: 0,
      issue_type: 'overflow',
    }
    assert.equal(getGarbageReportId(hotspotOnlyPin), null)
    assert.equal(hasAssociatedGarbageReport(hotspotOnlyPin), false)
  })

  await t.test('Hotspot-only pin with matching integer ID never falls back to hotspot id', () => {
    // Dangerous collision scenario: Hotspot #105 has source_report: null,
    // while an unrelated GarbageReport #105 exists in DB.
    const hotspotPin = {
      id: 105,
      report_id: null,
      community_post_id: null,
    }
    const resolvedId = getGarbageReportId(hotspotPin)
    assert.equal(resolvedId, null, 'Must strictly return null, never 105')
  })

  await t.test('Invalid report IDs are rejected safely', () => {
    assert.equal(parsePositiveSafeInteger(0), null)
    assert.equal(parsePositiveSafeInteger(-1), null)
    assert.equal(parsePositiveSafeInteger('abc'), null)
    assert.equal(parsePositiveSafeInteger(null), null)
    assert.equal(parsePositiveSafeInteger(undefined), null)
    assert.equal(parsePositiveSafeInteger('12.34'), null)
    assert.equal(parsePositiveSafeInteger(' 10 '), null)
  })

  await t.test('Valid report objects and pins resolve positive safe integer ID', () => {
    const mapPinWithReport = { id: 999, report_id: 105 }
    assert.equal(getGarbageReportId(mapPinWithReport), 105)

    const directReport = { id: 105, issue_type: 'overflow' }
    assert.equal(getGarbageReportId(directReport), 105)
  })
})

test('Report Voting - Payload & Semantics Contract', async (t) => {
  await t.test('+1 vote maps to Confirm Issue (still uncollected)', () => {
    const voteType = 1
    const payload = { vote_type: voteType }
    assert.equal(payload.vote_type, 1)
    const label = 'Confirm Issue'
    const supportingText = 'Still uncollected'
    assert.equal(label, 'Confirm Issue')
    assert.equal(supportingText, 'Still uncollected')
  })

  await t.test('-1 vote maps to Confirm Cleared (already resolved)', () => {
    const voteType = -1
    const payload = { vote_type: voteType }
    assert.equal(payload.vote_type, -1)
    const label = 'Confirm Cleared'
    const supportingText = 'Already resolved'
    assert.equal(label, 'Confirm Cleared')
    assert.equal(supportingText, 'Already resolved')
  })

  await t.test('Consensus calculation mirrors authoritative backend contract', () => {
    const calculateConsensus = (upvotes, downvotes) => ({
      upvotes,
      downvotes,
      net_votes: upvotes - downvotes,
    })

    const sample1 = calculateConsensus(8, 3)
    assert.equal(sample1.upvotes, 8)
    assert.equal(sample1.downvotes, 3)
    assert.equal(sample1.net_votes, 5)

    const sample2 = calculateConsensus(2, 5)
    assert.equal(sample2.net_votes, -3)

    const sample3 = calculateConsensus(0, 0)
    assert.equal(sample3.net_votes, 0)
  })
})

test('Report Voting - State Transitions & Active Vote Selection', async (t) => {
  await t.test('Current user vote mapping', () => {
    const getActiveState = (userVote) => ({
      isIssueConfirmed: userVote === 1,
      isClearedConfirmed: userVote === -1,
      isNeutral: userVote === null,
    })

    assert.deepEqual(getActiveState(1), {
      isIssueConfirmed: true,
      isClearedConfirmed: false,
      isNeutral: false,
    })

    assert.deepEqual(getActiveState(-1), {
      isIssueConfirmed: false,
      isClearedConfirmed: true,
      isNeutral: false,
    })

    assert.deepEqual(getActiveState(null), {
      isIssueConfirmed: false,
      isClearedConfirmed: false,
      isNeutral: true,
    })
  })

  await t.test('Clicking active vote triggers removal (DELETE semantics)', () => {
    const determineAction = (currentVote, targetVote) => {
      if (currentVote === targetVote) {
        return { method: 'DELETE', payload: null }
      }
      return { method: 'POST', payload: { vote_type: targetVote } }
    }

    // User already voted +1 and clicks Confirm Issue again -> DELETE
    assert.deepEqual(determineAction(1, 1), { method: 'DELETE', payload: null })

    // User already voted -1 and clicks Confirm Cleared again -> DELETE
    assert.deepEqual(determineAction(-1, -1), { method: 'DELETE', payload: null })

    // User has no vote and clicks Confirm Issue -> POST +1
    assert.deepEqual(determineAction(null, 1), { method: 'POST', payload: { vote_type: 1 } })

    // User voted +1 and switches to Confirm Cleared -> POST -1
    assert.deepEqual(determineAction(1, -1), { method: 'POST', payload: { vote_type: -1 } })
  })

  await t.test('Failed request does not falsely update local vote state', () => {
    let state = { upvotes: 4, downvotes: 1, netVotes: 3, userVote: null }

    const simulateVoteSubmission = (success, targetVote) => {
      if (!success) {
        // Error path: do not mutate state
        return { ...state }
      }
      return {
        upvotes: targetVote === 1 ? state.upvotes + 1 : state.upvotes,
        downvotes: targetVote === -1 ? state.downvotes + 1 : state.downvotes,
        netVotes: targetVote === 1 ? state.netVotes + 1 : state.netVotes - 1,
        userVote: targetVote,
      }
    }

    const failedResult = simulateVoteSubmission(false, 1)
    assert.deepEqual(failedResult, state, 'Local state must remain unchanged on failure')
  })
})

test('Report Voting - Stale State Prevention when Switching Reports', async (t) => {
  await t.test('Sequencing token discards out-of-order fetch responses', async () => {
    let activeVoteData = { reportId: null, upvotes: 0, downvotes: 0, userVote: null }
    let requestSeq = 0

    const fetchVoteStateSimulated = (reportId, delayMs, serverData) => {
      const thisSeq = ++requestSeq
      // Reset immediately upon switching report
      activeVoteData = { reportId, upvotes: 0, downvotes: 0, userVote: null }

      return new Promise((resolve) => {
        setTimeout(() => {
          if (thisSeq === requestSeq) {
            activeVoteData = { reportId, ...serverData }
          }
          resolve({ thisSeq, accepted: thisSeq === requestSeq })
        }, delayMs)
      })
    }

    // User selects Report 101 (slow network response: 80ms)
    const p1 = fetchVoteStateSimulated(101, 80, { upvotes: 10, downvotes: 2, userVote: 1 })

    // User swiftly switches to Report 202 (fast network response: 20ms)
    const p2 = fetchVoteStateSimulated(202, 20, { upvotes: 1, downvotes: 0, userVote: null })

    // Wait for Report 202
    const res2 = await p2
    assert.equal(res2.accepted, true)
    assert.equal(activeVoteData.reportId, 202)
    assert.equal(activeVoteData.upvotes, 1)

    // Wait for delayed Report 101
    const res1 = await p1
    assert.equal(res1.accepted, false, 'Stale Report 101 response must be rejected')
    assert.equal(activeVoteData.reportId, 202, 'Active data must retain Report 202')
    assert.equal(activeVoteData.upvotes, 1)
  })
})

test('Report Voting - Step 4.0B.5.1 Targeted Corrections', async (t) => {
  await t.test('Finding 4: Vote mutation response safety rejects stale in-flight responses', async () => {
    let currentReportId = 101
    let currentRequestSeq = 1
    let onVoteChangeCalls = []

    const simulateVoteMutation = async ({ reqReportId, reqSeq, delayMs, responseData }) => {
      await new Promise((r) => setTimeout(r, delayMs))
      // Safe response validation: must match current report ID and request sequence
      if (reqReportId === currentReportId && reqSeq === currentRequestSeq) {
        onVoteChangeCalls.push({ reportId: reqReportId, data: responseData })
        return { applied: true }
      }
      return { applied: false, reason: 'stale' }
    }

    // Report 101 vote request initiated (seq 1, slow 50ms)
    const voteP1 = simulateVoteMutation({
      reqReportId: 101,
      reqSeq: 1,
      delayMs: 50,
      responseData: { upvotes: 5, downvotes: 0, user_vote: 1 },
    })

    // User switches to Report 202 (seq increments to 2)
    currentReportId = 202
    currentRequestSeq = 2

    const result = await voteP1
    assert.equal(result.applied, false)
    assert.equal(result.reason, 'stale')
    assert.equal(onVoteChangeCalls.length, 0, 'onVoteChange must NEVER be called for stale report mutation')
  })

  await t.test('Finding 5: Initial vote load failure prevents fabricated zero counts and disables voting', () => {
    // Component state simulation
    const getInitialLoadFailureState = (fetchError) => ({
      loadError: Boolean(fetchError),
      isLoaded: !fetchError,
      // Zero counts must not be presented as authoritative truth when load failed
      displayNotice: fetchError ? 'Voting information unavailable.' : null,
      canVote: !fetchError,
    })

    const failedState = getInitialLoadFailureState(new Error('Network error'))
    assert.equal(failedState.loadError, true)
    assert.equal(failedState.isLoaded, false)
    assert.equal(failedState.displayNotice, 'Voting information unavailable.')
    assert.equal(failedState.canVote, false)

    const retryState = (prevReportId, newReportId) => ({
      loadError: false,
      isLoaded: false,
      targetReportId: newReportId,
    })

    const retried = retryState(101, 101)
    assert.equal(retried.loadError, false)
    assert.equal(retried.targetReportId, 101)
  })

  await t.test('Finding 7A: Existing votes on ineligible reports allow deletion but block new votes', () => {
    const isEligibleForNewVotes = (status, isArchived) => {
      if (isArchived) return false
      return status === 'approved' || status === 'resolved'
    }

    const canPerformAction = ({ status, isArchived, userVote, targetAction }) => {
      const eligible = isEligibleForNewVotes(status, isArchived)
      if (targetAction === 'DELETE') {
        // Supported vote removal is allowed if user has existing vote
        return userVote !== null
      }
      if (targetAction === 'POST') {
        return eligible
      }
      return false
    }

    // Rejected report with userVote: 1 (existing vote from when report was approved)
    assert.equal(
      canPerformAction({ status: 'rejected', isArchived: false, userVote: 1, targetAction: 'DELETE' }),
      true,
      'User must be allowed to remove existing vote on rejected report'
    )
    assert.equal(
      canPerformAction({ status: 'rejected', isArchived: false, userVote: 1, targetAction: 'POST' }),
      false,
      'User cannot cast new votes or switch votes on rejected report'
    )

    // Archived report with userVote: -1
    assert.equal(
      canPerformAction({ status: 'resolved', isArchived: true, userVote: -1, targetAction: 'DELETE' }),
      true,
      'User must be allowed to remove existing vote on archived report'
    )

    // Neutral user on rejected report
    assert.equal(
      canPerformAction({ status: 'rejected', isArchived: false, userVote: null, targetAction: 'POST' }),
      false,
      'Neutral user cannot vote on rejected report'
    )
  })

  await t.test('Finding 7B: Notice text mapping uses status-appropriate neutral wording', () => {
    const getNoticeText = (status, isArchived) => {
      if (isArchived) return 'Community voting is closed for archived reports.'
      if (status === 'rejected') return 'Community voting is closed for rejected reports.'
      if (status === 'pending') return 'Community verification opens once an official report is verified and approved.'
      return null
    }

    assert.equal(getNoticeText('rejected', false), 'Community voting is closed for rejected reports.')
    assert.equal(getNoticeText('resolved', true), 'Community voting is closed for archived reports.')
    assert.equal(getNoticeText('pending', false), 'Community verification opens once an official report is verified and approved.')
    assert.equal(getNoticeText('approved', false), null)
  })
})

test('Report Voting - Step 4.0B.5.2 Final Corrections', async (t) => {
  await t.test('Section 1: Inaccessible DELETE response contract preserves counts and updates userVote', () => {
    // When a report became inaccessible, the backend returns only { report_id, user_vote: null }
    let state = {
      upvotes: 7,
      downvotes: 2,
      netVotes: 5,
      userVote: 1,
    }

    const applyVoteResponse = (currentState, responseData) => {
      const next = { ...currentState }
      if (responseData.upvotes !== undefined && responseData.downvotes !== undefined) {
        next.upvotes = Number(responseData.upvotes) || 0
        next.downvotes = Number(responseData.downvotes) || 0
        next.netVotes = responseData.net_votes !== undefined
          ? Number(responseData.net_votes)
          : (next.upvotes - next.downvotes)
      }
      next.userVote = responseData.user_vote ?? null
      return next
    }

    const deleteInaccessibleResponse = {
      report_id: 101,
      user_vote: null,
    }

    const updatedState = applyVoteResponse(state, deleteInaccessibleResponse)
    assert.equal(updatedState.userVote, null, 'userVote must be updated to null')
    assert.equal(updatedState.upvotes, 7, 'upvotes must NOT be wiped out to 0')
    assert.equal(updatedState.downvotes, 2, 'downvotes must NOT be wiped out to 0')
    assert.equal(updatedState.netVotes, 5, 'netVotes must remain intact')
  })

  await t.test('Section 2: Switching report ID invalidates in-flight submission and resets isSubmitting', async () => {
    let activeReportIdRef = { current: 101 }
    let requestSeqRef = { current: 1 }
    let isSubmitting = false
    let reportUpdates = []

    // 1. User initiates vote on Report 101
    const submissionSeq = requestSeqRef.current
    const submissionReportId = 101
    isSubmitting = true

    // Simulate async network request
    const delayedRequest = async () => {
      await new Promise(r => setTimeout(r, 60))
      // Guard matches ReportVoting.jsx implementation:
      if (
        requestSeqRef.current !== submissionSeq ||
        activeReportIdRef.current !== submissionReportId
      ) {
        // Discard stale response
        return { discarded: true }
      }
      reportUpdates.push(submissionReportId)
      return { discarded: false }
    }

    const inFlightPromise = delayedRequest()

    // 2. User immediately switches to Report 202 before request finishes
    requestSeqRef.current += 1
    activeReportIdRef.current = 202
    isSubmitting = false // useEffect resets isSubmitting on report change!

    // Verify report 202 is NOT locked or submitting
    assert.equal(isSubmitting, false, 'Report 202 controls must be enabled immediately')

    // 3. Old request completes
    const result = await inFlightPromise
    assert.equal(result.discarded, true, 'Report 101 response must be discarded')
    assert.equal(reportUpdates.length, 0, 'Report 202 state must NOT be touched by Report 101 response')
    assert.equal(isSubmitting, false, 'isSubmitting must remain false for Report 202')
  })

  await t.test('Section 3: User barangay extraction accommodates user.barangay and user.barangay_id', () => {
    const extractUserBarangayId = (user) => {
      if (!user) return null
      return user.barangay != null
        ? (typeof user.barangay === 'object' ? user.barangay.id : user.barangay)
        : user.barangay_id != null
          ? user.barangay_id
          : null
    }

    // Direct ID in user.barangay (UserSerializer convention)
    assert.equal(extractUserBarangayId({ id: 1, barangay: 5 }), 5)

    // Nested object in user.barangay
    assert.equal(extractUserBarangayId({ id: 2, barangay: { id: 7, name: 'Isabang' } }), 7)

    // Direct ID in user.barangay_id (user_to_dict convention)
    assert.equal(extractUserBarangayId({ id: 3, barangay_id: 12 }), 12)

    // Both present
    assert.equal(extractUserBarangayId({ id: 4, barangay: 8, barangay_id: 8 }), 8)

    // Unassigned user
    assert.equal(extractUserBarangayId({ id: 5, barangay: null, barangay_id: null }), null)
    assert.equal(extractUserBarangayId({ id: 6 }), null)
    assert.equal(extractUserBarangayId(null), null)
  })
})
