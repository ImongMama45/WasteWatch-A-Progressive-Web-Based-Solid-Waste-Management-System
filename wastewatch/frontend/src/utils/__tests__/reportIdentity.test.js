// reportIdentity.test.js — Frontend unit tests for Map Pin Identity Safety
// Run with Node.js built-in test runner: node --test src/utils/__tests__/reportIdentity.test.js

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getGarbageReportId,
  hasAssociatedGarbageReport,
  parsePositiveSafeInteger,
} from '../reportIdentity.js'

test('reportIdentity helper - getGarbageReportId and hasAssociatedGarbageReport', async (t) => {
  await t.test('hotspot-only pin with report_id: null resolves to null (never substitutes hotspot id)', () => {
    const hotspotOnlyPin = {
      id: 42,
      report_id: null,
      community_post_id: null,
      severity: 'medium',
      name: 'Standalone Hotspot',
    }
    assert.equal(getGarbageReportId(hotspotOnlyPin), null)
    assert.equal(hasAssociatedGarbageReport(hotspotOnlyPin), false)
  })

  await t.test('hotspot-only pin with report_id: undefined resolves to null', () => {
    const pin = {
      id: 99,
      report_id: undefined,
      severity: 'high',
    }
    assert.equal(getGarbageReportId(pin), null)
    assert.equal(hasAssociatedGarbageReport(pin), false)
  })

  await t.test('map pin with valid numeric report_id resolves to report_id', () => {
    const pin = {
      id: 5,
      report_id: 108,
      community_post_id: 204,
      severity: 'high',
    }
    assert.equal(getGarbageReportId(pin), 108)
    assert.equal(hasAssociatedGarbageReport(pin), true)
  })

  await t.test('map pin with string numeric report_id resolves to parsed integer', () => {
    const pin = {
      id: 12,
      report_id: '350',
    }
    assert.equal(getGarbageReportId(pin), 350)
    assert.equal(hasAssociatedGarbageReport(pin), true)
  })

  await t.test('direct GarbageReport object (without report_id key) resolves to item.id', () => {
    const directReport = {
      id: 77,
      issue_type: 'overflow',
      status: 'approved',
      description: 'Direct report model object',
    }
    assert.equal(getGarbageReportId(directReport), 77)
    assert.equal(hasAssociatedGarbageReport(directReport), true)
  })

  await t.test('focusReport object with report_id takes priority', () => {
    const focusState = {
      id: 15,
      report_id: 88,
    }
    assert.equal(getGarbageReportId(focusState), 88)
    assert.equal(hasAssociatedGarbageReport(focusState), true)
  })

  await t.test('null, undefined, and non-object inputs return null/false safely', () => {
    assert.equal(getGarbageReportId(null), null)
    assert.equal(hasAssociatedGarbageReport(null), false)
    assert.equal(getGarbageReportId(undefined), null)
    assert.equal(hasAssociatedGarbageReport(undefined), false)
    assert.equal(getGarbageReportId('not an object'), null)
    assert.equal(hasAssociatedGarbageReport('not an object'), false)
    assert.equal(getGarbageReportId([1, 2, 3]), null)
    assert.equal(hasAssociatedGarbageReport([1, 2, 3]), false)
    assert.equal(getGarbageReportId(true), null)
    assert.equal(hasAssociatedGarbageReport(true), false)
  })

  await t.test('strict rejection of invalid report_id values on map pins without falling back to id', () => {
    const hotspotId = 777
    const invalidValues = [
      null,
      undefined,
      '',
      '   ',
      ' 42 ',
      '\t',
      '\n',
      true,
      false,
      [],
      [1],
      {},
      { id: 1 },
      12.3,
      0.5,
      '12.3',
      '0.5',
      0,
      '0',
      '00',
      -1,
      -99,
      '-1',
      '-99',
      NaN,
      Infinity,
      -Infinity,
      '0x1a',
      '0XFF',
      '1e5',
      '2e3',
      Number.MAX_SAFE_INTEGER + 1,
      '9007199254740992', // MAX_SAFE_INTEGER + 1
      '999999999999999999999999999999',
    ]

    for (const val of invalidValues) {
      const pin = { id: hotspotId, report_id: val }
      assert.equal(
        getGarbageReportId(pin),
        null,
        `Expected null for report_id: ${String(val)} (${typeof val})`
      )
      assert.equal(
        hasAssociatedGarbageReport(pin),
        false,
        `Expected false for hasAssociatedGarbageReport with report_id: ${String(val)}`
      )
    }
  })

  await t.test('direct GarbageReport object must pass strict validation on item.id', () => {
    assert.equal(getGarbageReportId({ id: 0 }), null)
    assert.equal(getGarbageReportId({ id: -5 }), null)
    assert.equal(getGarbageReportId({ id: 12.3 }), null)
    assert.equal(getGarbageReportId({ id: '12.3' }), null)
    assert.equal(getGarbageReportId({ id: 'bad_id' }), null)
    assert.equal(getGarbageReportId({ id: '0x12' }), null)
    assert.equal(getGarbageReportId({ id: '' }), null)
    assert.equal(getGarbageReportId({ id: null }), null)
    assert.equal(getGarbageReportId({ id: 9007199254740992 }), null)

    // Valid positive safe integers
    assert.equal(getGarbageReportId({ id: 1 }), 1)
    assert.equal(getGarbageReportId({ id: 100 }), 100)
    assert.equal(getGarbageReportId({ id: '500' }), 500)
    assert.equal(getGarbageReportId({ id: Number.MAX_SAFE_INTEGER }), Number.MAX_SAFE_INTEGER)
  })
})

test('parsePositiveSafeInteger helper directly', async (t) => {
  await t.test('accepts positive safe integers and positive decimal numeric strings', () => {
    assert.equal(parsePositiveSafeInteger(1), 1)
    assert.equal(parsePositiveSafeInteger(42), 42)
    assert.equal(parsePositiveSafeInteger(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER)
    assert.equal(parsePositiveSafeInteger('1'), 1)
    assert.equal(parsePositiveSafeInteger('42'), 42)
    assert.equal(
      parsePositiveSafeInteger(String(Number.MAX_SAFE_INTEGER)),
      Number.MAX_SAFE_INTEGER
    )
  })

  await t.test('rejects unsafe numbers, non-integers, and non-decimal strings', () => {
    assert.equal(parsePositiveSafeInteger(0), null)
    assert.equal(parsePositiveSafeInteger(-1), null)
    assert.equal(parsePositiveSafeInteger(1.5), null)
    assert.equal(parsePositiveSafeInteger(NaN), null)
    assert.equal(parsePositiveSafeInteger(Infinity), null)
    assert.equal(parsePositiveSafeInteger(Number.MAX_SAFE_INTEGER + 1), null)
    assert.equal(parsePositiveSafeInteger('0'), null)
    assert.equal(parsePositiveSafeInteger('-1'), null)
    assert.equal(parsePositiveSafeInteger('1.5'), null)
    assert.equal(parsePositiveSafeInteger(' 42 '), null)
    assert.equal(parsePositiveSafeInteger('0x10'), null)
    assert.equal(parsePositiveSafeInteger('1e4'), null)
    assert.equal(parsePositiveSafeInteger('9007199254740992'), null)
  })
})

test('CommentThread stale state prevention logic', async (t) => {
  await t.test('sequencing token ignores stale out-of-order fetch responses', async () => {
    // Model the exact sequencing token pattern implemented in CommentThread.jsx
    let activeComments = []
    let requestSeq = 0

    const fetchCommentsSimulated = (postId, delayMs, commentsToReturn) => {
      const thisSeq = ++requestSeq
      // Reset comments immediately on switch
      activeComments = []

      return new Promise((resolve) => {
        setTimeout(() => {
          // If request is still current, accept results; otherwise discard
          if (thisSeq === requestSeq) {
            activeComments = commentsToReturn
          }
          resolve({ thisSeq, accepted: thisSeq === requestSeq })
        }, delayMs)
      })
    }

    // Step A: User clicks Report 1 (slow network: 100ms)
    const p1 = fetchCommentsSimulated(1, 100, [{ id: 101, content: 'Comment on report 1' }])

    // Step B: User quickly switches to Report 2 (fast network: 20ms)
    const p2 = fetchCommentsSimulated(2, 20, [{ id: 201, content: 'Comment on report 2' }])

    // Wait for Report 2 to finish
    const res2 = await p2
    assert.equal(res2.accepted, true)
    assert.deepEqual(activeComments, [{ id: 201, content: 'Comment on report 2' }])

    // Wait for Report 1 (the stale slower request) to finish
    const res1 = await p1
    assert.equal(res1.accepted, false)
    // activeComments must NOT be overwritten by the earlier, stale Report 1 request
    assert.deepEqual(activeComments, [{ id: 201, content: 'Comment on report 2' }])
  })

  await t.test('React-safe count synchronization sanitizes, deduplicates, and avoids updater side-effects', () => {
    // Model the exact notifyCountChange helper and effect in CommentThread.jsx
    let notifiedCounts = []
    let lastNotifiedPost = null
    let lastNotifiedCount = null

    const notifyCountChange = (activePostId, count) => {
      const safeCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0
      if (lastNotifiedPost === activePostId && lastNotifiedCount === safeCount) {
        return // Deduplicate identical notification
      }
      lastNotifiedPost = activePostId
      lastNotifiedCount = safeCount
      notifiedCounts.push(safeCount)
    }

    // 1. Initial load for post 10 with 3 comments
    notifyCountChange(10, 3)
    assert.deepEqual(notifiedCounts, [3])

    // 2. Duplicate render commit with same 3 comments should NOT re-notify
    notifyCountChange(10, 3)
    assert.deepEqual(notifiedCounts, [3], 'Duplicate render commit must not notify twice')

    // 3. User adds a comment -> state updates cleanly to 4 items
    notifyCountChange(10, 4)
    assert.deepEqual(notifiedCounts, [3, 4])

    // 4. User deletes a comment -> state updates cleanly to 3 items
    notifyCountChange(10, 3)
    assert.deepEqual(notifiedCounts, [3, 4, 3])

    // 5. Unsafe count values (NaN, negative, float) are strictly sanitized to valid non-negative integers
    notifyCountChange(10, NaN)
    assert.deepEqual(notifiedCounts, [3, 4, 3, 0])
    notifyCountChange(10, -5)
    assert.deepEqual(notifiedCounts, [3, 4, 3, 0], 'Negative values clamp to 0 and deduplicate')
    notifyCountChange(10, 7.8)
    assert.deepEqual(notifiedCounts, [3, 4, 3, 0, 7])

    // 6. Switching to post 20 with 7 comments: accepts new count because post ID changed
    notifyCountChange(20, 7)
    assert.deepEqual(notifiedCounts, [3, 4, 3, 0, 7, 7])
  })
})
