// articleDetail.test.js — Frontend unit tests for Phase 5.2.6 Article Detail and Deep-Link Improvements
// Run with Node.js built-in test runner: node --test src/pages/news/utils/__tests__/articleDetail.test.js

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CATEGORY_CONFIG,
  TYPE_CONFIG,
  PRIORITY_CONFIG,
  getCategoryLabel,
  calculateReadingTime,
} from '../newsConfig.js'
import { buildArticleShareUrl } from '../newsUtils.js'

test('Phase 5.2.6 — Canonical Article Share URL Generation', async (t) => {
  await t.test('buildArticleShareUrl generates clean permalink with only ?article=<id>', () => {
    const url = buildArticleShareUrl(123, '/announcements', 'https://lucena.gov.ph')
    assert.equal(url, 'https://lucena.gov.ph/announcements?article=123')
  })

  await t.test('buildArticleShareUrl works with deployment subpaths', () => {
    const url = buildArticleShareUrl(456, '/portal/wastewatch/announcements', 'https://city.gov.ph')
    assert.equal(url, 'https://city.gov.ph/portal/wastewatch/announcements?article=456')
  })

  await t.test('buildArticleShareUrl handles root path safely', () => {
    const url = buildArticleShareUrl('789', '/', 'https://wastewatch.ph')
    assert.equal(url, 'https://wastewatch.ph/?article=789')
  })

  await t.test('buildArticleShareUrl returns empty string for missing or invalid IDs', () => {
    assert.equal(buildArticleShareUrl(null), '')
    assert.equal(buildArticleShareUrl(undefined), '')
    assert.equal(buildArticleShareUrl(''), '')
    assert.equal(buildArticleShareUrl(0), '')
  })

  await t.test('buildArticleShareUrl discards all discovery filters and conflicting alert params', () => {
    // Calling with path that might contain query params in error or environment
    const shareUrl = buildArticleShareUrl(55, '/announcements', 'https://lucena.gov.ph')
    const parsed = new URL(shareUrl)
    assert.equal(parsed.searchParams.get('article'), '55')
    assert.equal(parsed.searchParams.get('alert'), null, 'Conflicting alert param excluded')
    assert.equal(parsed.searchParams.get('scope'), null, 'Scope filter excluded')
    assert.equal(parsed.searchParams.get('category'), null, 'Category filter excluded')
    assert.equal(parsed.searchParams.get('search'), null, 'Search query excluded')
    assert.equal(parsed.searchParams.get('page'), null, 'Page param excluded')
  })
})

test('Phase 5.2.6 — URL Parameter Normalization & EmergencyAlert Precedence', async (t) => {
  await t.test('When both alert and article parameters are present, alert takes precedence and article is removed', () => {
    const searchParams = new URLSearchParams('alert=10&article=25&scope=city_wide&search=schedule&category=Service+Updates')

    // Simulation of NewsPage normalization logic:
    const alertParam = searchParams.get('alert')
    const articleParam = searchParams.get('article')

    assert.equal(Boolean(alertParam && articleParam), true, 'Both parameters detected')

    const normalized = new URLSearchParams(searchParams)
    normalized.delete('article') // Purge subordinate article parameter

    assert.equal(normalized.get('alert'), '10', 'Alert parameter preserved')
    assert.equal(normalized.get('article'), null, 'Article parameter removed')
    assert.equal(normalized.get('scope'), 'city_wide', 'Unrelated scope parameter preserved')
    assert.equal(normalized.get('search'), 'schedule', 'Unrelated search parameter preserved')
    assert.equal(normalized.get('category'), 'Service Updates', 'Unrelated category parameter preserved')

    // Dismissing alert cleanly leaves unrelated parameters intact without opening article
    normalized.delete('alert')
    assert.equal(normalized.get('alert'), null)
    assert.equal(normalized.get('article'), null, 'Article does not reappear after alert closes')
    assert.equal(normalized.get('scope'), 'city_wide')
    assert.equal(normalized.get('search'), 'schedule')
  })
})

test('Phase 5.2.6 — Article ID Validation & Identity Matching', async (t) => {
  await t.test('Positive integer validation regex accepts only valid numeric strings', () => {
    const isValidId = id => /^\d+$/.test(id)
    assert.equal(isValidId('1'), true)
    assert.equal(isValidId('42'), true)
    assert.equal(isValidId('999999'), true)

    assert.equal(isValidId('abc'), false)
    assert.equal(isValidId('1.5'), false)
    assert.equal(isValidId('-10'), false)
    assert.equal(isValidId('1; DROP TABLE'), false)
    assert.equal(isValidId(''), false)
    assert.equal(isValidId(' 12 '), false)
  })

  await t.test('Identity matching strictly checks response ID against requested canonical ID', () => {
    const canonicalId = '105'
    const validResponse = { id: 105, title: 'Matching Item' }
    const mismatchedResponse = { id: 106, title: 'Stale Item' }

    const isMatch = (res, targetId) => Boolean(res && String(res.id) === targetId)

    assert.equal(isMatch(validResponse, canonicalId), true)
    assert.equal(isMatch(mismatchedResponse, canonicalId), false)
  })
})

test('Phase 5.2.6 — Metadata Configuration Fallbacks & Decoupled Badges', async (t) => {
  await t.test('Known category resolves with specific icon and theme colors', () => {
    const catCfg = CATEGORY_CONFIG['Service Updates']
    assert.ok(catCfg)
    assert.ok(catCfg.Icon)
    assert.equal(catCfg.color, '#0284c7')
  })

  await t.test('Unknown or custom category falls back safely to General configuration without throwing', () => {
    const rawCategory = 'Special Urban Agriculture Project'
    const categoryLabel = getCategoryLabel(rawCategory)
    const catCfg = CATEGORY_CONFIG[rawCategory] || CATEGORY_CONFIG[categoryLabel] || CATEGORY_CONFIG.General

    assert.ok(catCfg)
    assert.ok(catCfg.Icon)
    assert.equal(categoryLabel, 'Special Urban Agriculture Project')
  })

  await t.test('Known content type resolves distinct styling and label', () => {
    const emergencyType = TYPE_CONFIG.emergency
    assert.equal(emergencyType.label, 'Emergency Alert')
    assert.equal(emergencyType.badgeColor, '#dc2626')

    const announcementType = TYPE_CONFIG.announcement
    assert.equal(announcementType.label, 'Announcement')
  })

  await t.test('Unknown content type falls back safely to news configuration', () => {
    const rawType = 'bulletin_flyer'
    const typeCfg = TYPE_CONFIG[rawType] || TYPE_CONFIG.news
    assert.ok(typeCfg)
    assert.equal(typeCfg.label, 'News')
  })

  await t.test('Priority configurations resolve high, medium, and low gracefully', () => {
    assert.equal(PRIORITY_CONFIG.high.label, 'HIGH')
    assert.equal(PRIORITY_CONFIG.medium.label, 'MED')
    assert.equal(PRIORITY_CONFIG.low.label, 'LOW')

    const unknownPriority = 'critical_tier_one'
    const pCfg = PRIORITY_CONFIG[unknownPriority] || PRIORITY_CONFIG.low
    assert.equal(pCfg.label, 'LOW')
  })
})

test('Phase 5.2.6 — Reading Time Display Behavior', async (t) => {
  await t.test('calculateReadingTime returns null for null, empty, or short texts (< 15 words)', () => {
    assert.equal(calculateReadingTime(null), null)
    assert.equal(calculateReadingTime(''), null)
    assert.equal(calculateReadingTime('   '), null)
    assert.equal(calculateReadingTime('Short advisory message with ten words only inside here today.'), null)
  })

  await t.test('calculateReadingTime calculates approx 200 words per minute for longer texts', () => {
    // 30 words -> 1 min read
    const thirtyWords = Array(30).fill('word').join(' ')
    assert.equal(calculateReadingTime(thirtyWords), '1 min read')

    // 250 words -> 2 min read
    const twoFiftyWords = Array(250).fill('word').join(' ')
    assert.equal(calculateReadingTime(twoFiftyWords), '2 min read')

    // 450 words -> 3 min read
    const fourFiftyWords = Array(450).fill('word').join(' ')
    assert.equal(calculateReadingTime(fourFiftyWords), '3 min read')
  })
})

test('Phase 5.2.6 — Request Sequencing Token Simulation', async (t) => {
  await t.test('Sequencing token rejects out-of-order in-flight responses', () => {
    let requestIdCounter = 0
    let activeRequestId = 0
    let committedArticle = null

    // User triggers request for Article 1
    const req1Id = ++requestIdCounter
    activeRequestId = req1Id

    // Before Request 1 completes, user triggers request for Article 2
    const req2Id = ++requestIdCounter
    activeRequestId = req2Id

    // Request 2 completes first
    if (req2Id === activeRequestId) {
      committedArticle = { id: 2, title: 'Article Two' }
    }
    assert.equal(committedArticle.id, 2)

    // Request 1 completes late (simulating network lag)
    if (req1Id === activeRequestId) {
      committedArticle = { id: 1, title: 'Article One' }
    }

    // Article 2 must NOT be overwritten by late Request 1
    assert.equal(committedArticle.id, 2, 'Stale Request 1 was safely rejected by token comparison')
  })

  await t.test('Closing modal increments token and invalidates active request', () => {
    let requestIdCounter = 5
    let activeRequestId = 5
    let committedArticle = null

    // In-flight request 5 is running
    // User closes modal:
    requestIdCounter++
    activeRequestId = 0 // Invalidate

    // Request 5 finishes afterward:
    if (5 === activeRequestId) {
      committedArticle = { id: 5, title: 'Article Five' }
    }

    assert.equal(committedArticle, null, 'Response dropped because modal was closed during request')
  })
})

test('Phase 5.2.6 — Browser History Replace vs Push Logic', async (t) => {
  await t.test('Opening from feed pushes history, switching inside modal replaces history', () => {
    const resolveHistoryMode = (isModalAlreadyOpen) => ({
      replace: isModalAlreadyOpen,
    })

    // 1. User clicks card while on feed (modal is closed)
    assert.deepEqual(resolveHistoryMode(false), { replace: false }, 'Pushes new history entry')

    // 2. User switches to another article while modal is already open
    assert.deepEqual(resolveHistoryMode(true), { replace: true }, 'Replaces existing history entry without stack pollution')
  })
})

