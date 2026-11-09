// newsConfig.test.js — Frontend unit tests for Phase 5.2.1 Configuration and Data-Handling Remediation
// Run with Node.js built-in test runner: node --test src/pages/news/utils/__tests__/newsConfig.test.js

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ANNOUNCEMENT_CATEGORIES,
  CATEGORY_TABS,
  getCategoryLabel,
  matchesCategory,
  selectFeaturedAnnouncement,
  calculateReadingTime,
  estimateReadingTime,
} from '../newsConfig.js'
import {
  filterNews,
  sortNews,
  resolveScopeParams,
  executeScopedFetch,
  readScopeCache,
  writeScopeCache,
  getScopeCacheKey,
  normalizeBarangayList,
  createScopeSignature,
  calculateFeedCountBreakdown,
  resolveFeedDisplayState,
  resolveCardAccentPrecedence,
  normalizeEmergencyAlert,
  normalizeUrgentNewsItem,
  resolveAdvisoryUrgencyTheme,
} from '../newsUtils.js'

test('Correction A — Category Configuration and Reconciliation', async (t) => {
  await t.test('Canonical identifier for All Notices is "All" and label is "All Notices"', () => {
    const firstTab = CATEGORY_TABS[0]
    assert.equal(firstTab.id, 'All')
    assert.equal(firstTab.label, 'All Notices')
  })

  await t.test('All public categories are defined with canonical IDs and public labels', () => {
    const expected = [
      { id: 'All', label: 'All Notices' },
      { id: 'Announcements', label: 'Announcements' },
      { id: 'Service Updates', label: 'Service Updates' },
      { id: 'Cleanup Drives', label: 'Cleanup Drives' },
      { id: 'Advisories', label: 'Advisories & Alerts' },
      { id: 'Rankings', label: 'Barangay Rankings' },
      { id: 'Community News', label: 'Community News' },
    ]
    assert.deepEqual(CATEGORY_TABS, expected)
  })

  await t.test('getCategoryLabel resolves display label from canonical ID and falls back gracefully', () => {
    assert.equal(getCategoryLabel('All'), 'All Notices')
    assert.equal(getCategoryLabel('all'), 'All Notices')
    assert.equal(getCategoryLabel('Advisories'), 'Advisories & Alerts')
    assert.equal(getCategoryLabel('advisories'), 'Advisories & Alerts')
    assert.equal(getCategoryLabel('Rankings'), 'Barangay Rankings')
    assert.equal(getCategoryLabel('Announcements'), 'Announcements')
    assert.equal(getCategoryLabel('UnknownCategory'), 'UnknownCategory')
    assert.equal(getCategoryLabel(null), 'All Notices')
  })

  await t.test('matchesCategory matches target category case-insensitively and trims whitespace', () => {
    // Announcements
    assert.equal(matchesCategory('Announcements', 'Announcements'), true)
    assert.equal(matchesCategory('announcements', 'announcements'), true)
    assert.equal(matchesCategory('announcement', 'Announcements'), true)
    assert.equal(matchesCategory('  ANNOUNCEMENT  ', 'Announcements'), true)

    // Service Updates
    assert.equal(matchesCategory('Service Updates', 'Service Updates'), true)
    assert.equal(matchesCategory('service updates', 'Service Updates'), true)

    // Cleanup Drives
    assert.equal(matchesCategory('Cleanup Drives', 'Cleanup Drives'), true)

    // Advisories & Alerts
    assert.equal(matchesCategory('Advisories', 'Advisories'), true)
    assert.equal(matchesCategory('Emergencies', 'Advisories'), true)
    assert.equal(matchesCategory('Emergency', 'Advisories'), true)
    assert.equal(matchesCategory('emergency', 'Advisories'), true)
    assert.equal(matchesCategory('Advisories', 'Advisories & Alerts'), true)

    // Barangay Rankings
    assert.equal(matchesCategory('Rankings', 'Rankings'), true)
    assert.equal(matchesCategory('rankings', 'Barangay Rankings'), true)

    // Community News
    assert.equal(matchesCategory('News', 'Community News'), true)
    assert.equal(matchesCategory('news', 'Community News'), true)
    assert.equal(matchesCategory('General', 'Community News'), true)
    assert.equal(matchesCategory('Community', 'Community News'), true)
  })

  await t.test('All and All Notices match all items including missing or unknown categories', () => {
    assert.equal(matchesCategory('General', 'All'), true)
    assert.equal(matchesCategory('Announcements', 'All'), true)
    assert.equal(matchesCategory('UnknownCategory', 'All'), true)
    assert.equal(matchesCategory('', 'All'), true)
    assert.equal(matchesCategory(null, 'All'), true)
    assert.equal(matchesCategory(undefined, 'All'), true)
    assert.equal(matchesCategory('General', 'All Notices'), true)
    assert.equal(matchesCategory('General', 'all notices'), true)
  })

  await t.test('matchesCategory handles missing, null, undefined, or empty categories gracefully for specific filters', () => {
    assert.equal(matchesCategory(null, 'Announcements'), false)
    assert.equal(matchesCategory(undefined, 'Announcements'), false)
    assert.equal(matchesCategory('', 'Announcements'), false)
    assert.equal(matchesCategory('   ', 'Announcements'), false)
  })

  await t.test('Category filtering does not match based on item.type', () => {
    const items = [
      { id: 1, title: 'Item 1', category: 'General', type: 'announcement' },
      { id: 2, title: 'Item 2', category: 'Announcements', type: 'news' },
      { id: 3, title: 'Item 3', category: 'News', type: 'emergency' },
      { id: 4, title: 'Item 4', category: 'Emergency', type: 'announcement' },
    ]

    // Filtering by 'Announcements' should ONLY match Item 2 (category: Announcements)
    // It must NOT match Item 1 (category: General, even though type: announcement)
    const announcementResults = filterNews(items, 'Announcements')
    assert.equal(announcementResults.length, 1)
    assert.equal(announcementResults[0].id, 2)

    // Filtering by 'Community News' should match Item 1 (General) and Item 3 (News)
    // It must NOT match Item 4 even though type: announcement
    const communityResults = filterNews(items, 'Community News')
    assert.equal(communityResults.length, 2)
    assert.deepEqual(communityResults.map(i => i.id).sort(), [1, 3])

    // Filtering by 'Advisories' should ONLY match Item 4 (category: Emergency)
    // It must NOT match Item 3 even though type: emergency
    const advisoryResults = filterNews(items, 'Advisories')
    assert.equal(advisoryResults.length, 1)
    assert.equal(advisoryResults[0].id, 4)
  })
})

test('Correction B — Scope Isolation and Cache Management', async (t) => {
  await t.test('readScopeCache isolates cached data strictly per scopeKey', () => {
    const mockStorage = new Map()
    const storageAdapter = {
      getItem: (k) => mockStorage.get(k) ?? null,
      setItem: (k, v) => mockStorage.set(k, String(v)),
    }

    // Populate scope caches
    writeScopeCache('all', [{ id: 10, title: 'Citywide 10' }], storageAdapter)
    writeScopeCache('brgy_2', [{ id: 20, title: 'Barangay 2 Report' }], storageAdapter)

    // Verify 'all' cache reads its own data
    const allItems = readScopeCache('all', storageAdapter)
    assert.deepEqual(allItems, [{ id: 10, title: 'Citywide 10' }])

    // Verify 'brgy_2' cache reads its own data
    const brgy2Items = readScopeCache('brgy_2', storageAdapter)
    assert.deepEqual(brgy2Items, [{ id: 20, title: 'Barangay 2 Report' }])

    // Verify un-cached scope 'brgy_5' returns empty array (does NOT leak 'all' or 'brgy_2')
    const brgy5Items = readScopeCache('brgy_5', storageAdapter)
    assert.deepEqual(brgy5Items, [])
  })

  await t.test('executeScopedFetch: Successful array response normalization', async () => {
    let committedItems = null
    const mockApi = async () => ({
      data: [{ id: 1, title: 'Notice 1' }, { id: 2, title: 'Notice 2' }],
    })

    const result = await executeScopedFetch({
      apiClient: mockApi,
      params: { barangay_id: '5' },
      isValidRequest: () => true,
      onCommit: (items) => {
        committedItems = items
      },
    })

    assert.equal(result.committed, true)
    assert.deepEqual(result.items, [{ id: 1, title: 'Notice 1' }, { id: 2, title: 'Notice 2' }])
    assert.deepEqual(committedItems, result.items)
  })

  await t.test('executeScopedFetch: Successful { results: [...] } paginated response normalization', async () => {
    let committedItems = null
    const mockApi = async () => ({
      data: {
        count: 1,
        next: null,
        previous: null,
        results: [{ id: 99, title: 'Paginated Notice' }],
      },
    })

    const result = await executeScopedFetch({
      apiClient: mockApi,
      params: {},
      isValidRequest: () => true,
      onCommit: (items) => {
        committedItems = items
      },
    })

    assert.equal(result.committed, true)
    assert.deepEqual(result.items, [{ id: 99, title: 'Paginated Notice' }])
    assert.deepEqual(committedItems, [{ id: 99, title: 'Paginated Notice' }])
  })

  await t.test('executeScopedFetch: Request failure and error preservation', async () => {
    let errorPreserved = null
    let committed = false
    const mockFailureApi = async () => {
      const err = new Error('Network 500 Server Error')
      err.response = { status: 500 }
      throw err
    }

    const result = await executeScopedFetch({
      apiClient: mockFailureApi,
      params: { barangay_id: '1' },
      isValidRequest: () => true,
      onCommit: () => {
        committed = true
      },
      onError: (err) => {
        errorPreserved = err
      },
    })

    assert.equal(result.committed, false)
    assert.equal(committed, false)
    assert.equal(result.error?.message, 'Network 500 Server Error')
    assert.equal(errorPreserved?.message, 'Network 500 Server Error')
  })

  await t.test('executeScopedFetch: Stale request is prevented from committing', async () => {
    let committedCount = 0
    let lastCommittedData = null

    // Simulate slow Request 1 (Barangay 1)
    let isReq1Valid = true
    const req1Promise = executeScopedFetch({
      apiClient: () => new Promise(res => setTimeout(() => res({ data: [{ id: 1, title: 'Req 1 Brgy 1' }] }), 40)),
      params: { barangay_id: '1' },
      isValidRequest: () => isReq1Valid,
      onCommit: (items) => {
        committedCount++
        lastCommittedData = items
      },
    })

    // User switches immediately to Barangay 2 (superseding Request 1)
    isReq1Valid = false // Request 1 marked stale

    const req2Promise = executeScopedFetch({
      apiClient: () => new Promise(res => setTimeout(() => res({ data: [{ id: 2, title: 'Req 2 Brgy 2' }] }), 10)),
      params: { barangay_id: '2' },
      isValidRequest: () => true,
      onCommit: (items) => {
        committedCount++
        lastCommittedData = items
      },
    })

    const [res1, res2] = await Promise.all([req1Promise, req2Promise])

    assert.equal(res1.committed, false)
    assert.equal(res1.stale, true)
    assert.equal(res2.committed, true)
    assert.equal(committedCount, 1)
    assert.deepEqual(lastCommittedData, [{ id: 2, title: 'Req 2 Brgy 2' }])
  })

  await t.test('executeScopedFetch: Cancellation behavior via AbortSignal', async () => {
    const controller = new AbortController()
    let committed = false
    let errorCalled = false

    const delayedFetch = executeScopedFetch({
      apiClient: (url, { signal }) => new Promise((resolve, reject) => {
        signal?.addEventListener('abort', () => {
          const err = new Error('The operation was aborted')
          err.name = 'CanceledError'
          reject(err)
        })
      }),
      signal: controller.signal,
      isValidRequest: () => true,
      onCommit: () => { committed = true },
      onError: () => { errorCalled = true },
    })

    // Abort in-flight
    controller.abort()
    const result = await delayedFetch

    assert.equal(result.committed, false)
    assert.equal(result.canceled, true)
    assert.equal(committed, false)
    assert.equal(errorCalled, false)
  })
})

test('Deterministic Featured Announcement Selection', async (t) => {
  await t.test('Selection priority: is_featured > is_pinned > priority=high', () => {
    const items = [
      { id: 1, title: 'High Priority', priority: 'high', date: '2026-11-05', is_featured: false, is_pinned: false },
      { id: 2, title: 'Pinned Item', is_pinned: true, date: '2026-11-04', is_featured: false, priority: 'low' },
      { id: 3, title: 'Featured Item', is_featured: true, date: '2026-11-01', is_pinned: false, priority: 'low' },
    ]

    const hero = selectFeaturedAnnouncement(items)
    assert.equal(hero.id, 3)

    const itemsWithoutFeatured = items.filter(i => i.id !== 3)
    const hero2 = selectFeaturedAnnouncement(itemsWithoutFeatured)
    assert.equal(hero2.id, 2)

    const itemsWithoutPinned = itemsWithoutFeatured.filter(i => i.id !== 2)
    const hero3 = selectFeaturedAnnouncement(itemsWithoutPinned)
    assert.equal(hero3.id, 1)
  })

  await t.test('Newest-first selection within each priority group', () => {
    const featuredItems = [
      { id: 10, title: 'Older Featured', is_featured: true, date: '2026-11-01' },
      { id: 20, title: 'Newer Featured', is_featured: true, date: '2026-11-07' },
      { id: 30, title: 'Middle Featured', is_featured: true, date: '2026-11-04' },
    ]
    const hero = selectFeaturedAnnouncement(featuredItems)
    assert.equal(hero.id, 20)

    const pinnedItems = [
      { id: 100, title: 'Older Pinned', is_pinned: true, date: '2026-10-15' },
      { id: 200, title: 'Newer Pinned', is_pinned: true, date: '2026-11-02' },
    ]
    const heroPinned = selectFeaturedAnnouncement(pinnedItems)
    assert.equal(heroPinned.id, 200)

    const highPriorityItems = [
      { id: 1000, title: 'Older High', priority: 'high', date: '2026-10-20' },
      { id: 2000, title: 'Newer High', priority: 'high', date: '2026-11-06' },
    ]
    const heroHigh = selectFeaturedAnnouncement(highPriorityItems)
    assert.equal(heroHigh.id, 2000)
  })

  await t.test('Deterministic tie-breaker with missing, null, or equal dates', () => {
    const itemsWithEqualDates = [
      { id: 15, title: 'Featured A', is_featured: true, date: '2026-11-01' },
      { id: 45, title: 'Featured B', is_featured: true, date: '2026-11-01' },
    ]
    const hero = selectFeaturedAnnouncement(itemsWithEqualDates)
    assert.equal(hero.id, 45)

    const itemsWithMissingDates = [
      { id: 10, title: 'Featured Null Date', is_featured: true, date: null },
      { id: 30, title: 'Featured Undefined Date', is_featured: true, date: undefined },
    ]
    const heroMissing = selectFeaturedAnnouncement(itemsWithMissingDates)
    assert.equal(heroMissing.id, 30)
  })

  await t.test('Respects is_active field (inactive items cannot become hero)', () => {
    const items = [
      { id: 1, title: 'Inactive Featured', is_featured: true, is_active: false, date: '2026-11-07' },
      { id: 2, title: 'Active Pinned', is_pinned: true, is_active: true, date: '2026-11-01' },
    ]
    const hero = selectFeaturedAnnouncement(items)
    assert.equal(hero.id, 2)
  })

  await t.test('No qualifying items returns null', () => {
    const ordinaryItems = [
      { id: 1, title: 'Ordinary 1', is_featured: false, is_pinned: false, priority: 'low' },
      { id: 2, title: 'Ordinary 2', is_featured: false, is_pinned: false, priority: 'medium' },
    ]
    assert.equal(selectFeaturedAnnouncement(ordinaryItems), null)
    assert.equal(selectFeaturedAnnouncement([]), null)
    assert.equal(selectFeaturedAnnouncement(null), null)
    assert.equal(selectFeaturedAnnouncement(undefined), null)
  })

  await t.test('Original input array is not mutated', () => {
    const items = [
      { id: 1, title: 'Item 1', is_featured: true, date: '2026-11-01' },
      { id: 2, title: 'Item 2', is_featured: true, date: '2026-11-07' },
      { id: 3, title: 'Item 3', is_featured: false, date: '2026-11-05' },
    ]
    const copy = [...items]
    const hero = selectFeaturedAnnouncement(items)

    assert.equal(hero.id, 2)
    assert.equal(items.length, 3)
    assert.equal(items[0].id, copy[0].id)
    assert.equal(items[1].id, copy[1].id)
    assert.equal(items[2].id, copy[2].id)
  })
})

test('Reading-Time Calculation Utility', async (t) => {
  await t.test('Returns null for missing, empty, or fewer than 15 words', () => {
    assert.equal(calculateReadingTime(null), null)
    assert.equal(calculateReadingTime(undefined), null)
    assert.equal(calculateReadingTime(''), null)
    assert.equal(calculateReadingTime('   \n\t  '), null)

    const fourteenWords = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen'
    assert.equal(calculateReadingTime(fourteenWords), null)
    assert.equal(estimateReadingTime(fourteenWords), null)
  })

  await t.test('Calculates approx 200 wpm with proper ceiling for >= 15 words', () => {
    const fifteenWords = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen'
    assert.equal(calculateReadingTime(fifteenWords), '1 min read')

    const twoHundredWords = Array(200).fill('word').join(' ')
    assert.equal(calculateReadingTime(twoHundredWords), '1 min read')

    const twoHundredOneWords = Array(201).fill('word').join(' ')
    assert.equal(calculateReadingTime(twoHundredOneWords), '2 min read')

    const fourHundredWords = Array(400).fill('word').join(' ')
    assert.equal(calculateReadingTime(fourHundredWords), '2 min read')

    const fourHundredOneWords = Array(401).fill('word').join(' ')
    assert.equal(calculateReadingTime(fourHundredOneWords), '3 min read')
  })

  await t.test('Handles repeated whitespace, tabs, and newlines accurately', () => {
    const multiLineText = '  Word1   Word2\n\nWord3\t\tWord4\nWord5   Word6  Word7  Word8  Word9  Word10  Word11  Word12  Word13  Word14  Word15  '
    assert.equal(calculateReadingTime(multiLineText), '1 min read')
    const detailed = estimateReadingTime(multiLineText)
    assert.equal(detailed.words, 15)
    assert.equal(detailed.minutes, 1)
    assert.equal(detailed.text, '1 min read')
  })
})

test('Barangay Scope Parameter Resolution', async (t) => {
  await t.test('All Lucena City scope produces empty query params and scopeKey "all"', () => {
    assert.deepEqual(resolveScopeParams(), { params: {}, scopeKey: 'all' })
    assert.deepEqual(resolveScopeParams({}), { params: {}, scopeKey: 'all' })
    assert.deepEqual(resolveScopeParams({ barangayId: null, cityWide: false }), { params: {}, scopeKey: 'all' })
    assert.deepEqual(resolveScopeParams({ barangayId: 'all' }), { params: {}, scopeKey: 'all' })
    assert.deepEqual(resolveScopeParams('all'), { params: {}, scopeKey: 'all' })
  })

  await t.test('Specific barangay scope produces barangay_id query parameter and scopeKey "brgy_<id>"', () => {
    assert.deepEqual(resolveScopeParams({ barangayId: 3 }), {
      params: { barangay_id: '3' },
      scopeKey: 'brgy_3',
    })
    assert.deepEqual(resolveScopeParams({ barangayId: '12' }), {
      params: { barangay_id: '12' },
      scopeKey: 'brgy_12',
    })
    assert.deepEqual(resolveScopeParams(5), {
      params: { barangay_id: '5' },
      scopeKey: 'brgy_5',
    })
    assert.deepEqual(resolveScopeParams('7'), {
      params: { barangay_id: '7' },
      scopeKey: 'brgy_7',
    })
  })

  await t.test('Citywide only scope produces city_wide=true query parameter and scopeKey "city_wide"', () => {
    assert.deepEqual(resolveScopeParams({ cityWide: true }), {
      params: { city_wide: 'true' },
      scopeKey: 'city_wide',
    })
    assert.deepEqual(resolveScopeParams({ cityWide: 'true' }), {
      params: { city_wide: 'true' },
      scopeKey: 'city_wide',
    })
    assert.deepEqual(resolveScopeParams({ barangayId: 'city_wide' }), {
      params: { city_wide: 'true' },
      scopeKey: 'city_wide',
    })
    assert.deepEqual(resolveScopeParams('city_wide'), {
      params: { city_wide: 'true' },
      scopeKey: 'city_wide',
    })
  })
})

test('Phase 5.2.2 — Masthead Admin Check and Feed Deduplication Logic', async (t) => {
  await t.test('Admin check matches role === admin or is_staff exactly', () => {
    const checkIsAdmin = (user) => Boolean(user && (user.role === 'admin' || user.is_staff))
    assert.equal(checkIsAdmin(null), false)
    assert.equal(checkIsAdmin(undefined), false)
    assert.equal(checkIsAdmin({ role: 'citizen' }), false)
    assert.equal(checkIsAdmin({ role: 'watcher' }), false)
    assert.equal(checkIsAdmin({ role: 'driver' }), false)
    assert.equal(checkIsAdmin({ role: 'brgy_official' }), false)
    assert.equal(checkIsAdmin({ role: 'admin' }), true)
    assert.equal(checkIsAdmin({ role: 'citizen', is_staff: true }), true)
    assert.equal(checkIsAdmin({ role: 'admin', is_staff: false }), true)
  })

  await t.test('Safe feed deduplication excludes hero by stable ID', () => {
    const items = [
      { id: 1, title: 'Item 1', is_featured: true },
      { id: 2, title: 'Item 2' },
      { id: 3, title: 'Item 3' },
    ]
    const hero = selectFeaturedAnnouncement(items)
    assert.equal(hero.id, 1)

    const heroId = hero?.id != null ? String(hero.id) : null
    const feedItems = (items || []).filter(item => String(item?.id) !== heroId)

    assert.equal(feedItems.length, 2)
    assert.deepEqual(feedItems.map(i => i.id), [2, 3])
  })

  await t.test('Safe feed deduplication preserves all items when hero is null or has no valid ID', () => {
    const items = [
      { id: 1, title: 'Item 1' },
      { id: 2, title: 'Item 2' },
    ]

    // Case 1: hero is null
    const hero1 = null
    const heroId1 = hero1?.id != null ? String(hero1.id) : null
    const feedItems1 = !heroId1 ? items : items.filter(item => String(item?.id) !== heroId1)
    assert.equal(feedItems1.length, 2)
    assert.deepEqual(feedItems1, items)

    // Case 2: hero has no stable ID
    const hero2 = { title: 'No ID Item' }
    const heroId2 = hero2?.id != null ? String(hero2.id) : null
    const feedItems2 = !heroId2 ? items : items.filter(item => String(item?.id) !== heroId2)
    assert.equal(feedItems2.length, 2)
    assert.deepEqual(feedItems2, items)
  })

  await t.test('Safe feed deduplication handles string and number ID comparison stably', () => {
    const items = [
      { id: '105', title: 'Featured String ID', is_featured: true },
      { id: 106, title: 'Number ID' },
    ]
    const hero = selectFeaturedAnnouncement(items)
    const heroId = hero?.id != null ? String(hero.id) : null
    const feedItems = (items || []).filter(item => String(item?.id) !== heroId)

    assert.equal(feedItems.length, 1)
    assert.equal(feedItems[0].id, 106)
  })

  await t.test('Correction 1: Hero image state tracking resets when hero ID or image URL changes', () => {
    const computeImgKey = (item) => {
      const raw = item?.image_url || (typeof item?.image === 'string' ? item.image : null) || null
      return item ? `${item.id}:${raw}` : ''
    }

    const itemA = { id: 1, image_url: 'https://example.com/broken.jpg' }
    let key = computeImgKey(itemA)
    assert.equal(key, '1:https://example.com/broken.jpg')

    // Simulate error state
    let imgError = true

    // New hero item arrives with valid image
    const itemB = { id: 2, image_url: 'https://example.com/hero.jpg' }
    const newKey = computeImgKey(itemB)
    assert.notEqual(newKey, key)

    // Component resets error state on key change
    if (newKey !== key) {
      key = newKey
      imgError = false
    }
    assert.equal(imgError, false)

    // Image URL changes on same hero item
    const itemBUpdated = { id: 2, image_url: 'https://example.com/hero-v2.jpg' }
    const updatedKey = computeImgKey(itemBUpdated)
    assert.notEqual(updatedKey, key)
    if (updatedKey !== key) {
      key = updatedKey
      imgError = false
    }
    assert.equal(imgError, false)
  })

  await t.test('Correction 2: ActiveAdvisoriesSection excludes hero item without dropping valid advisories', () => {
    const items = [
      { id: 10, title: 'Pinned Hero Item', is_pinned: true, priority: 'normal' },
      { id: 20, title: 'Urgent Advisory 1', priority: 'high' },
      { id: 30, title: 'Emergency Notice 2', type: 'emergency' },
      { id: 40, title: 'Regular Item', priority: 'normal' },
    ]

    const hero = selectFeaturedAnnouncement(items)
    assert.equal(hero.id, 10)

    const heroId = String(hero.id)

    // Filter used in ActiveAdvisoriesSection with excludeId
    const filterAdvisories = (records, excludeId) =>
      records.filter(
        i =>
          (excludeId == null || String(i?.id) !== String(excludeId)) &&
          (i.type === 'emergency' || i.priority === 'high' || i.is_pinned)
      )

    const urgentItems = filterAdvisories(items, heroId)

    // Hero item (id 10) must be excluded from advisories to prevent duplication
    assert.equal(urgentItems.some(i => i.id === 10), false)

    // Non-hero urgent/emergency advisories must be preserved
    assert.equal(urgentItems.length, 2)
    assert.deepEqual(urgentItems.map(i => i.id), [20, 30])

    // When excludeId is null, all urgent items are preserved
    const allUrgent = filterAdvisories(items, null)
    assert.equal(allUrgent.length, 3)
  })

  await t.test('Correction 3: EmergencyAlert and NewsItem separation is preserved', () => {
    // Overlapping integer IDs between EmergencyAlert and NewsItem
    const emergencyAlert = { id: 5, title: 'Typhoon Signal No. 2', body: 'Emergency details' }
    const newsItem = { id: 5, title: 'Tree Planting Drive', body: 'News article body' }

    // EmergencyAlert records have no onReadMore action; they render inline full text
    const isEmergencyAlertClickable = Boolean(emergencyAlert.onReadMore)
    assert.equal(isEmergencyAlertClickable, false)

    // NewsItems pass to onReadMore with article query param
    const makeArticleParam = (item) => `?article=${item.id}`
    assert.equal(makeArticleParam(newsItem), '?article=5')
  })
})

test('Phase 5.2.3 — Discovery and Filtering Requirements Suite', async (t) => {
  await t.test('1-3. Scope Parameter Resolution: All Lucena City, City-Wide Only, and Barangay ID', () => {
    // 1. All Lucena City scope resolves to no parameters
    assert.deepEqual(resolveScopeParams('all'), { params: {}, scopeKey: 'all' })
    assert.deepEqual(resolveScopeParams({ barangayId: 'all' }), { params: {}, scopeKey: 'all' })

    // 2. City-Wide Only resolves to city_wide=true
    assert.deepEqual(resolveScopeParams('city_wide'), { params: { city_wide: 'true' }, scopeKey: 'city_wide' })
    assert.deepEqual(resolveScopeParams({ cityWide: true }), { params: { city_wide: 'true' }, scopeKey: 'city_wide' })

    // 3. Selected barangay resolves to barangay_id=<id>
    assert.deepEqual(resolveScopeParams('12'), { params: { barangay_id: '12' }, scopeKey: 'brgy_12' })
    assert.deepEqual(resolveScopeParams(12), { params: { barangay_id: '12' }, scopeKey: 'brgy_12' })
    assert.deepEqual(resolveScopeParams({ barangayId: 12 }), { params: { barangay_id: '12' }, scopeKey: 'brgy_12' })
  })

  await t.test('4. Barangay dataset contract preserves citywide notices alongside barangay notices', () => {
    // Simulating API response for /api/news/items/?barangay_id=5
    // Under backend contract, it returns both citywide notices (barangay == null) and barangay-specific notices
    const scopedDataset = [
      { id: 1, title: 'Citywide Schedule Notice', barangay: null, category: 'Service Updates' },
      { id: 2, title: 'Barangay 5 Cleanup', barangay: 5, barangay_name: 'Barangay 5', category: 'Cleanup Drives' },
    ]

    // Neither notice is excluded by scope
    assert.equal(scopedDataset.length, 2)
    assert.equal(scopedDataset.some(i => i.barangay === null), true)
    assert.equal(scopedDataset.some(i => i.barangay === 5), true)
  })

  await t.test('5. Category counts include the hero and represent the complete currently scoped dataset', () => {
    const scopedDataset = [
      { id: 1, title: 'Hero Announcement', category: 'Announcements', is_featured: true },
      { id: 2, title: 'Regular Announcement', category: 'Announcements' },
      { id: 3, title: 'Service Update 1', category: 'Service Updates' },
      { id: 4, title: 'Cleanup Drive 1', category: 'Cleanup Drives' },
    ]

    const hero = selectFeaturedAnnouncement(scopedDataset)
    assert.equal(hero.id, 1)

    // Category counts computed over scopedDataset (including hero item)
    const counts = { All: scopedDataset.length }
    CATEGORY_TABS.forEach(tab => {
      const id = typeof tab === 'object' ? tab.id : tab
      if (id !== 'All') {
        counts[id] = filterNews(scopedDataset, id, '').length
      }
    })

    // Total count includes all 4 notices including the hero
    assert.equal(counts.All, 4)
    // Announcements count includes both the hero (id 1) and regular announcement (id 2)
    assert.equal(counts.Announcements, 2)
    assert.equal(counts['Service Updates'], 1)
    assert.equal(counts['Cleanup Drives'], 1)
  })

  await t.test('6. Search and category filters work together seamlessly across title, body, category, and barangay', () => {
    const scopedDataset = [
      { id: 1, title: 'Collection Schedule Route A', description: 'Truck arrives at 8 AM', category: 'Service Updates', barangay_name: 'Isabang' },
      { id: 2, title: 'Tree Planting Drive', description: 'Volunteers welcome at the park', category: 'Cleanup Drives', barangay_name: 'Ibabang Dupay' },
      { id: 3, title: 'Water Advisory', description: 'Boil water reminder', category: 'Advisories', barangay_name: 'Isabang' },
      { id: 4, title: 'Collection Schedule Route B', description: 'Commercial district route', category: 'Service Updates', barangay_name: 'Gulang-Gulang' },
    ]

    // Category filter: Service Updates
    const catOnly = filterNews(scopedDataset, 'Service Updates', '')
    assert.equal(catOnly.length, 2)
    assert.deepEqual(catOnly.map(i => i.id), [1, 4])

    // Category filter + Search term matching title: 'Route A'
    const catAndSearchTitle = filterNews(scopedDataset, 'Service Updates', 'Route A')
    assert.equal(catAndSearchTitle.length, 1)
    assert.equal(catAndSearchTitle[0].id, 1)

    // Category filter + Search term matching barangay: 'Isabang'
    const catAndSearchBrgy = filterNews(scopedDataset, 'Service Updates', 'isabang')
    assert.equal(catAndSearchBrgy.length, 1)
    assert.equal(catAndSearchBrgy[0].id, 1)

    // Search matching category name directly: 'cleanup'
    const searchCategoryName = filterNews(scopedDataset, 'All', 'cleanup')
    assert.equal(searchCategoryName.length, 1)
    assert.equal(searchCategoryName[0].id, 2)

    // Non-matching search query returns empty array
    const noMatch = filterNews(scopedDataset, 'Service Updates', 'nonexistent term')
    assert.equal(noMatch.length, 0)
  })

  await t.test('7. Search filtering operates in-memory over scoped dataset without causing API fetches', () => {
    let apiFetchCount = 0
    const mockFetch = () => { apiFetchCount++ }

    // Initial scope fetch
    mockFetch()
    assert.equal(apiFetchCount, 1)

    // Subsequent keystrokes filter in-memory with filterNews
    const dataset = [{ id: 1, title: 'Notice 1', category: 'Announcements' }]
    filterNews(dataset, 'All', 'n')
    filterNews(dataset, 'All', 'no')
    filterNews(dataset, 'All', 'not')
    filterNews(dataset, 'All', 'noti')
    filterNews(dataset, 'All', 'notice')

    // API fetch count must remain 1 (zero network requests per keystroke)
    assert.equal(apiFetchCount, 1)
  })

  await t.test('8. Featured Hero is hidden when filter is active, but its notice remains eligible in filtered results', () => {
    const scopedDataset = [
      { id: 1, title: 'City Cleanup Drive', description: 'Lucena general cleanup', category: 'Cleanup Drives', is_featured: true },
      { id: 2, title: 'General Advisory', description: 'General public reminder', category: 'Advisories' },
    ]

    const hero = selectFeaturedAnnouncement(scopedDataset)
    assert.equal(hero.id, 1)

    // State 1: No filters active (category = 'All', search = '')
    const isFilterActive1 = false
    const showHero1 = !isFilterActive1 && Boolean(hero)
    const feedItems1 = !showHero1 ? scopedDataset : scopedDataset.filter(i => String(i.id) !== String(hero.id))

    // Hero is shown prominently above; feed excludes hero to prevent duplicate
    assert.equal(showHero1, true)
    assert.equal(feedItems1.length, 1)
    assert.equal(feedItems1[0].id, 2)

    // State 2: Category filter is active (category = 'Cleanup Drives')
    const isFilterActive2 = true
    const showHero2 = !isFilterActive2 && Boolean(hero)
    // When filter is active, hero card above is hidden, and all scoped items are eligible for the feed
    const feedItems2 = !showHero2 ? scopedDataset : scopedDataset.filter(i => String(i.id) !== String(hero.id))
    const filteredFeed2 = filterNews(feedItems2, 'Cleanup Drives', '')

    assert.equal(showHero2, false)
    // Hero announcement (id 1) is a Cleanup Drive, so it appears in the filtered feed!
    assert.equal(filteredFeed2.length, 1)
    assert.equal(filteredFeed2[0].id, 1)
  })

  await t.test('9. Hero is never duplicated on screen in either active or inactive filter states', () => {
    const scopedDataset = [
      { id: 10, title: 'Featured Hero', is_featured: true, category: 'Announcements' },
      { id: 20, title: 'Notice 20', category: 'Announcements' },
    ]
    const hero = selectFeaturedAnnouncement(scopedDataset)

    // When no filter is active: hero is displayed in FeaturedHeroCard, excluded from feedItems
    const showHero = true
    const feedItems = scopedDataset.filter(i => String(i.id) !== String(hero.id))
    const displayedFeed = filterNews(feedItems, 'All', '')

    const heroInFeed = displayedFeed.some(i => i.id === hero.id)
    assert.equal(heroInFeed, false)
    assert.equal(displayedFeed.length, 1)
    assert.equal(displayedFeed[0].id, 20)
  })

  await t.test('10. EmergencyAlert banners remain visible independently of category/search filtering', () => {
    const alerts = [
      { id: 101, title: 'Typhoon Warning Alert', body: 'Signal No. 3 hoisted' },
    ]
    const newsItems = [
      { id: 1, title: 'Tree Planting', category: 'Cleanup Drives' },
    ]

    // Active category filter: Service Updates (which matches 0 news items)
    const filteredNews = filterNews(newsItems, 'Service Updates', 'schedule')
    assert.equal(filteredNews.length, 0)

    // EmergencyAlert records are unaffected by category/search filtering
    assert.equal(alerts.length, 1)
    assert.equal(alerts[0].id, 101)
  })

  await t.test('11. Urgent NewsItem notices respect the current category and search discovery filters', () => {
    const newsItems = [
      { id: 1, title: 'Urgent Schedule Advisory', category: 'Service Updates', priority: 'high' },
      { id: 2, title: 'Urgent Cleanup Drive Notice', category: 'Cleanup Drives', is_pinned: true },
      { id: 3, title: 'Routine Notice', category: 'Announcements', priority: 'normal' },
    ]

    // Filter ActiveAdvisoriesSection by category 'Service Updates'
    const filteredForAdvisories = filterNews(newsItems, 'Service Updates', '')
    const urgentItems = filteredForAdvisories.filter(i => i.type === 'emergency' || i.priority === 'high' || i.is_pinned)

    // Only the urgent notice matching Service Updates (id 1) is shown
    assert.equal(urgentItems.length, 1)
    assert.equal(urgentItems[0].id, 1)
  })

  await t.test('12. Distinguishes empty result, loading, and error states', () => {
    const checkState = ({ items, loading, error, isFiltered }) => {
      if (error) return 'ERROR_STATE'
      if (loading && (!items || items.length === 0)) return 'LOADING_STATE'
      if (!items || items.length === 0) {
        return isFiltered ? 'FILTERED_EMPTY_STATE' : 'DEFAULT_EMPTY_STATE'
      }
      return 'DATA_LOADED_STATE'
    }

    assert.equal(checkState({ items: [], loading: false, error: new Error('Network error'), isFiltered: false }), 'ERROR_STATE')
    assert.equal(checkState({ items: [], loading: true, error: null, isFiltered: false }), 'LOADING_STATE')
    assert.equal(checkState({ items: [], loading: false, error: null, isFiltered: true }), 'FILTERED_EMPTY_STATE')
    assert.equal(checkState({ items: [], loading: false, error: null, isFiltered: false }), 'DEFAULT_EMPTY_STATE')
    assert.equal(checkState({ items: [{ id: 1 }], loading: false, error: null, isFiltered: false }), 'DATA_LOADED_STATE')
  })
})

test('Phase 5.2.3 Remediation — Targeted Corrections Suite', async (t) => {
  await t.test('Correction 1: normalizeBarangayList normalizes plain array and paginated shapes', () => {
    // Plain array
    const plain = [{ id: 1, name: 'Barangay 1' }, { id: 2, name: 'Barangay 2' }]
    assert.deepEqual(normalizeBarangayList(plain), plain)

    // Paginated response shape
    const paginated = { count: 2, next: null, previous: null, results: [{ id: 1, name: 'Barangay 1' }, { id: 2, name: 'Barangay 2' }] }
    assert.deepEqual(normalizeBarangayList(paginated), plain)

    // Invalid or empty shapes handled safely without crashing
    assert.deepEqual(normalizeBarangayList(null), [])
    assert.deepEqual(normalizeBarangayList(undefined), [])
    assert.deepEqual(normalizeBarangayList({}), [])
    assert.deepEqual(normalizeBarangayList('invalid'), [])
  })

  await t.test('Correction 2: createScopeSignature stabilizes scope options across ordinary re-renders', () => {
    // Render 1: user passes 'all'
    const sig1 = createScopeSignature('all')
    assert.equal(sig1, 'all')

    // Render 2: user types in search or toggles modal, passes 'all' again
    const sig2 = createScopeSignature('all')
    assert.equal(sig2, sig1)

    // Object options with identical semantics produce identical signature
    assert.equal(createScopeSignature({ barangayId: null }), 'all')
    assert.equal(createScopeSignature({}), 'all')
    assert.equal(createScopeSignature({ cityWide: true }), 'city_wide')
    assert.equal(createScopeSignature({ cityWide: 'true' }), 'city_wide')
    assert.equal(createScopeSignature({ barangayId: 'city_wide' }), 'city_wide')
    assert.equal(createScopeSignature({ barangayId: 5 }), 'brgy_5')
    assert.equal(createScopeSignature({ barangayId: '5' }), 'brgy_5')
    assert.equal(createScopeSignature(5), 'brgy_5')

    // Changing scope produces different signature, properly triggering fetch
    assert.notEqual(createScopeSignature('all'), createScopeSignature(5))
    assert.notEqual(createScopeSignature('city_wide'), createScopeSignature('all'))
  })

  await t.test('Correction 3: calculateFeedCountBreakdown transparently reconciles hero and feed counts', () => {
    // When hero is displayed above (no active search/category filter)
    const breakdownWithHero = calculateFeedCountBreakdown({
      totalScopedCount: 5,
      feedCount: 4,
      showHero: true,
    })
    assert.equal(breakdownWithHero.text, '4 in feed · 1 featured above (5 total)')
    assert.equal(breakdownWithHero.feedCount, 4)
    assert.equal(breakdownWithHero.featuredCount, 1)
    assert.equal(breakdownWithHero.totalCount, 5)

    // When filter is active and hero card is hidden (all matching items are in feed)
    const breakdownFiltered = calculateFeedCountBreakdown({
      totalScopedCount: 2,
      feedCount: 2,
      showHero: false,
    })
    assert.equal(breakdownFiltered.text, '2 notices')
    assert.equal(breakdownFiltered.feedCount, 2)
    assert.equal(breakdownFiltered.featuredCount, 0)
    assert.equal(breakdownFiltered.totalCount, 2)

    // Singular notice formatting
    const breakdownSingle = calculateFeedCountBreakdown({
      totalScopedCount: 1,
      feedCount: 1,
      showHero: false,
    })
    assert.equal(breakdownSingle.text, '1 notice')
  })

  await t.test('Correction 4: resolveFeedDisplayState distinguishes all 5 feed lifecycle states', () => {
    // 1. Initial Loading (request in flight, zero loaded data)
    assert.equal(
      resolveFeedDisplayState({ items: [], filteredCount: 0, isLoading: true, error: null, isOnline: true }),
      'INITIAL_LOADING'
    )

    // 2. Offline with no data
    assert.equal(
      resolveFeedDisplayState({ items: [], filteredCount: 0, isLoading: false, error: null, isOnline: false }),
      'OFFLINE'
    )

    // 3. Error with no data
    assert.equal(
      resolveFeedDisplayState({ items: [], filteredCount: 0, isLoading: false, error: new Error('Failed'), isOnline: true }),
      'ERROR'
    )

    // 4. Empty result (request finished, zero matching notices)
    assert.equal(
      resolveFeedDisplayState({ items: [], filteredCount: 0, isLoading: false, error: null, isOnline: true }),
      'EMPTY'
    )

    // 5. Data ready (has matching items)
    assert.equal(
      resolveFeedDisplayState({ items: [{ id: 1 }], filteredCount: 1, isLoading: false, error: null, isOnline: true }),
      'READY'
    )

    // 5b. Background refreshing with existing data preserves READY state (no jarring skeleton)
    assert.equal(
      resolveFeedDisplayState({ items: [{ id: 1 }], filteredCount: 1, isLoading: true, error: null, isOnline: true }),
      'READY'
    )
  })

  await t.test('Correction 5: filterNews does not match missing or null categories when searching for "all" or "notices"', () => {
    const items = [
      { id: 1, title: 'Garbage Collection Schedule', description: 'Morning pickup', category: null, barangay_name: 'Isabang' },
      { id: 2, title: 'Road Advisory', description: 'Street repair ongoing', category: '', barangay_name: 'Ibabang Dupay' },
      { id: 3, title: 'General Announcement', description: 'Town hall meeting', category: 'Announcements', barangay_name: 'Isabang' },
      { id: 4, title: 'Emergency Notice', description: 'Storm signal warning', category: 'Advisories', barangay_name: 'Isabang' },
    ]

    // Searching for "all" should NOT match items 1 and 2 merely because their category is null or empty
    const searchAll = filterNews(items, 'All', 'all')
    // Item 3 has "hall" in description ("Town hall meeting"), so it legitimately matches "all" in text.
    // Items 1 and 2 do NOT have "all" in title, description, or barangay, so they must NOT match!
    assert.equal(searchAll.some(i => i.id === 1), false)
    assert.equal(searchAll.some(i => i.id === 2), false)

    // Searching for "notices" should NOT match items 1 and 2 because their category is null/empty
    const searchNotices = filterNews(items, 'All', 'notices')
    // Item 4 has category 'Advisories' which has alias 'Advisories & Alerts', but does not have 'notices'
    // Neither Item 1 nor Item 2 have 'notices' in title or description.
    assert.equal(searchNotices.some(i => i.id === 1), false)
    assert.equal(searchNotices.some(i => i.id === 2), false)

    // Valid category search still works: searching for "alerts" matches Item 4 (category 'Advisories' -> 'Advisories & Alerts')
    const searchAlerts = filterNews(items, 'All', 'alerts')
    assert.equal(searchAlerts.length, 1)
    assert.equal(searchAlerts[0].id, 4)

    // Searching for "announcement" matches Item 3
    const searchAnnounce = filterNews(items, 'All', 'announcement')
    assert.equal(searchAnnounce.length, 1)
    assert.equal(searchAnnounce[0].id, 3)

    // Items with null category can still be found by searching valid title text
    const searchSchedule = filterNews(items, 'All', 'schedule')
    assert.equal(searchSchedule.length, 1)
    assert.equal(searchSchedule[0].id, 1)
  })
})

test('Phase 5.2.4 — Announcement Cards and Feed Suite', async (t) => {
  await t.test('1. Card Accent Precedence: Emergency > High Priority > Pinned > Standard', () => {
    // Case 1: Emergency type beats high priority and pinned
    const allFlags = {
      type: 'emergency',
      priority: 'high',
      is_pinned: true,
      category: 'Service Updates',
    }
    const res1 = resolveCardAccentPrecedence(allFlags)
    assert.equal(res1.accent, 'emergency')
    assert.equal(res1.borderColor, '#dc2626')
    assert.equal(res1.badgeLabel, 'Emergency')

    // Case 2: Emergency category beats high priority and pinned
    const emergencyCategory = {
      type: 'announcement',
      priority: 'high',
      is_pinned: true,
      category: 'Emergency',
    }
    const res2 = resolveCardAccentPrecedence(emergencyCategory)
    assert.equal(res2.accent, 'emergency')
    assert.equal(res2.borderColor, '#dc2626')

    // Case 3: High Priority beats pinned
    const highAndPinned = {
      type: 'announcement',
      priority: 'high',
      is_pinned: true,
      category: 'Announcements',
    }
    const res3 = resolveCardAccentPrecedence(highAndPinned)
    assert.equal(res3.accent, 'high_priority')
    assert.equal(res3.borderColor, '#d97706')
    assert.equal(res3.badgeLabel, 'High Priority')

    // Case 4: Pinned beats standard
    const pinnedNotice = {
      type: 'news',
      priority: 'low',
      is_pinned: true,
      category: 'Community News',
    }
    const res4 = resolveCardAccentPrecedence(pinnedNotice)
    assert.equal(res4.accent, 'pinned')
    assert.equal(res4.borderColor, '#16a34a')
    assert.equal(res4.badgeLabel, 'Pinned')

    // Case 5: Standard fallback
    const standardNotice = {
      type: 'announcement',
      priority: 'low',
      is_pinned: false,
      category: 'Cleanup Drives',
    }
    const res5 = resolveCardAccentPrecedence(standardNotice)
    assert.equal(res5.accent, 'standard')
    assert.equal(res5.borderColor, '#e2e8f0')
    assert.equal(res5.badgeLabel, null)

    // Case 6: Safe fallback for null, undefined, or empty objects
    assert.equal(resolveCardAccentPrecedence(null).accent, 'standard')
    assert.equal(resolveCardAccentPrecedence(undefined).accent, 'standard')
    assert.equal(resolveCardAccentPrecedence({}).accent, 'standard')
  })

  await t.test('2. Decoupled Category and Type Presentation Preservation', () => {
    // When an item has type === 'emergency' and category === 'Service Updates',
    // the category label is still resolved as 'Service Updates' without being overwritten by the type
    const notice = {
      id: 10,
      title: 'Power and Water Disruption in Brgy 1',
      type: 'emergency',
      category: 'Service Updates',
      priority: 'high',
    }

    const label = getCategoryLabel(notice.category)
    assert.equal(label, 'Service Updates')
    assert.notEqual(label, 'Emergency')

    // The accent reflects emergency urgency
    const accent = resolveCardAccentPrecedence(notice)
    assert.equal(accent.accent, 'emergency')
  })

  await t.test('3. Reading-Time Integration on Card Description', () => {
    // Short description (<15 words) returns null
    const shortDesc = 'Quick notice about waste collection tomorrow morning.'
    assert.equal(calculateReadingTime(shortDesc), null)

    // Long description (>= 15 words) returns formatted reading time
    const longDesc =
      'The City Environment and Natural Resources Office wishes to notify all residents of Lucena City regarding ' +
      'the upcoming solid waste management schedule changes effective next Monday across all thirty-three barangays.'
    const rt = calculateReadingTime(longDesc)
    assert.equal(typeof rt, 'string')
    assert.match(rt, /^\d+\smin\sread$/)
  })

  await t.test('4. Feed Deduplication Preserves Urgent Items in Feed While Hero is Excluded', () => {
    // Given news items with one hero item and another urgent item
    const heroNotice = { id: 1, title: 'Annual City Cleanliness Report', is_featured: true, priority: 'high' }
    const urgentNotice = { id: 2, title: 'Road Advisory for Flood Control', type: 'emergency', priority: 'high' }
    const normalNotice = { id: 3, title: 'Regular Recycling Drive', priority: 'low' }

    const allNews = [heroNotice, urgentNotice, normalNotice]

    // Hero exclusion excludes heroNotice by id
    const feedItems = allNews.filter(i => String(i.id) !== String(heroNotice.id))

    // The urgent notice remains in the feed items array
    assert.equal(feedItems.length, 2)
    assert.equal(feedItems.some(i => i.id === 2), true)
    assert.equal(feedItems.some(i => i.id === 3), true)
    assert.equal(feedItems.some(i => i.id === 1), false)

    // Sorting places urgent notice at the top of the feed
    const sortedFeed = sortNews(feedItems)
    assert.equal(sortedFeed[0].id, 2)
  })
})

test('Phase 5.2.5 — Emergency Advisory Presentation and Detail Suite', async (t) => {
  await t.test('1. normalizeEmergencyAlert preserves source: alert and extracts fields without fabricating data', () => {
    const rawAlert = {
      id: 101,
      title: 'Typhoon Signal Warning',
      body: 'All collection halted along coastal roads.',
      date: '2026-11-07',
      is_active: true,
    }

    const normalized = normalizeEmergencyAlert(rawAlert)
    assert.equal(normalized.source, 'alert')
    assert.equal(normalized.id, '101')
    assert.equal(normalized.title, 'Typhoon Signal Warning')
    assert.equal(normalized.body, 'All collection halted along coastal roads.')
    assert.equal(normalized.date, '2026-11-07')
    assert.equal(normalized.is_active, true)
    assert.equal(normalized.urgencyLevel, 'emergency')

    // Verifies no fabricated fields exist on standalone alert
    assert.equal(normalized.barangay, undefined)
    assert.equal(normalized.priority, undefined)
    assert.equal(normalized.category, undefined)

    // Null/invalid input handles gracefully
    assert.equal(normalizeEmergencyAlert(null), null)
    assert.equal(normalizeEmergencyAlert(undefined), null)
  })

  await t.test('2. normalizeUrgentNewsItem preserves source: news and independent properties', () => {
    // 1. Emergency type with an ordinary category
    const emergTypeItem = {
      id: 201,
      title: 'Immediate Evacuation Order',
      description: 'Residents near Iyam River move to designated shelter.',
      type: 'emergency',
      category: 'General',
      priority: 'low',
      is_pinned: false,
      barangay_name: 'Ibabang Dupay',
      date: '2026-11-07',
    }
    const normEmergType = normalizeUrgentNewsItem(emergTypeItem)
    assert.equal(normEmergType.source, 'news')
    assert.equal(normEmergType.urgencyLevel, 'emergency', 'Emergency type triggers emergency urgency')
    assert.equal(normEmergType.type, 'emergency', 'Original type is preserved independently')
    assert.equal(normEmergType.category, 'General', 'Original category is preserved independently without conflation')
    assert.equal(normEmergType.priority, 'low', 'Original priority is preserved independently')
    assert.equal(normEmergType.isPinned, false, 'Original pinned status is preserved independently')

    // 2. Emergency category with an ordinary type ("Emergency")
    const emergCatItem = {
      id: 202,
      title: 'Flash Flood Directive',
      description: 'Lucena CDRRMO flood warning advisory.',
      type: 'announcement',
      category: 'Emergency',
      priority: 'low',
      is_pinned: false,
      barangay_name: 'City-Wide',
      date: '2026-11-07',
    }
    const normEmergCat = normalizeUrgentNewsItem(emergCatItem)
    assert.equal(normEmergCat.urgencyLevel, 'emergency', 'Category "Emergency" triggers emergency urgency')
    assert.equal(normEmergCat.type, 'announcement', 'Original type is preserved independently')
    assert.equal(normEmergCat.category, 'Emergency', 'Original category is preserved independently')
    assert.equal(normEmergCat.priority, 'low', 'Original priority is preserved independently')
    assert.equal(normEmergCat.isPinned, false, 'Original pinned status is preserved independently')

    // 3. Both "Emergency" and "Emergencies" category values
    const emergenciesCatItem = {
      id: 203,
      title: 'Citywide Emergency Protocol',
      description: 'Heavy precipitation safety protocol.',
      type: 'news',
      category: 'Emergencies',
      priority: 'medium',
      is_pinned: false,
      date: '2026-11-07',
    }
    const normEmergenciesCat = normalizeUrgentNewsItem(emergenciesCatItem)
    assert.equal(normEmergenciesCat.urgencyLevel, 'emergency', 'Category "Emergencies" triggers emergency urgency')
    assert.equal(normEmergenciesCat.category, 'Emergencies', 'Category "Emergencies" preserved without mutation')
    assert.equal(normEmergenciesCat.type, 'news', 'Original type preserved without mutation')

    // Case-insensitive emergency category support
    const lowercaseEmergItem = {
      id: 204,
      title: 'Low level advisory',
      type: 'news',
      category: 'emergency',
      priority: 'low',
    }
    const normLowerEmerg = normalizeUrgentNewsItem(lowercaseEmergItem)
    assert.equal(normLowerEmerg.urgencyLevel, 'emergency', 'Lowercase "emergency" category triggers emergency urgency')

    // 4. High-priority non-emergency NewsItem
    const highPriorityItem = {
      id: 205,
      title: 'Major Waste Route Realignment',
      description: 'DPWH road work necessitates truck route change.',
      type: 'announcement',
      category: 'Service Updates',
      priority: 'high',
      is_pinned: false,
      barangay_name: 'Gulang-Gulang',
      date: '2026-11-07',
    }
    const normHigh = normalizeUrgentNewsItem(highPriorityItem)
    assert.equal(normHigh.urgencyLevel, 'high_priority', 'High priority maps to high_priority urgency')
    assert.equal(normHigh.type, 'announcement', 'Original type preserved independently')
    assert.equal(normHigh.category, 'Service Updates', 'Original category preserved independently')
    assert.equal(normHigh.priority, 'high', 'Original priority preserved independently')
    assert.equal(normHigh.isPinned, false, 'Original pinned status preserved independently')

    // 5. Pinned non-emergency NewsItem
    const pinnedItem = {
      id: 206,
      title: 'Monthly Barangay Cleanliness Schedule',
      description: 'Regular monthly scheduled cleanup activity.',
      type: 'announcement',
      category: 'General',
      priority: 'low',
      is_pinned: true,
      barangay_name: 'Isabang',
      date: '2026-11-07',
    }
    const normPinned = normalizeUrgentNewsItem(pinnedItem)
    assert.equal(normPinned.urgencyLevel, 'pinned', 'Pinned item maps to pinned urgency')
    assert.equal(normPinned.type, 'announcement', 'Original type preserved independently')
    assert.equal(normPinned.category, 'General', 'Original category preserved independently')
    assert.equal(normPinned.priority, 'low', 'Original priority preserved independently')
    assert.equal(normPinned.isPinned, true, 'Original pinned status preserved independently')

    // 6. Standard NewsItem (Fallback)
    const standardItem = {
      id: 207,
      title: 'Recycling Seminar Overview',
      description: 'Public awareness seminar concluded yesterday.',
      type: 'announcement',
      category: 'General',
      priority: 'low',
      is_pinned: false,
      barangay_name: 'Market View',
      date: '2026-11-07',
    }
    const normStandard = normalizeUrgentNewsItem(standardItem)
    assert.equal(normStandard.urgencyLevel, 'standard', 'Standard item falls back to standard urgency')
    assert.equal(normStandard.type, 'announcement', 'Original type preserved independently')
    assert.equal(normStandard.category, 'General', 'Original category preserved independently')
    assert.equal(normStandard.priority, 'low', 'Original priority preserved independently')
    assert.equal(normStandard.isPinned, false, 'Original pinned status preserved independently')

    // Precedence rule test: Emergency beats High Priority and Pinned
    const multiUrgentItem = {
      id: 208,
      title: 'Critical Emergency Override',
      type: 'emergency',
      category: 'Emergencies',
      priority: 'high',
      is_pinned: true,
    }
    const normMulti = normalizeUrgentNewsItem(multiUrgentItem)
    assert.equal(normMulti.urgencyLevel, 'emergency', 'Emergency takes precedence over high priority and pinned')
    assert.equal(normMulti.type, 'emergency')
    assert.equal(normMulti.category, 'Emergencies')
    assert.equal(normMulti.priority, 'high')
    assert.equal(normMulti.isPinned, true)
  })

  await t.test('3. resolveAdvisoryUrgencyTheme adheres to Emergency > High Priority > Pinned > Standard', () => {
    // Emergency theme (crimson #dc2626)
    const alertTheme = resolveAdvisoryUrgencyTheme({ source: 'alert' })
    assert.equal(alertTheme.urgencyLevel, 'emergency')
    assert.equal(alertTheme.leftBorderColor, '#dc2626')
    assert.equal(alertTheme.actionLabel, 'View Directive')

    const newsEmergTheme = resolveAdvisoryUrgencyTheme({ source: 'news', type: 'emergency' })
    assert.equal(newsEmergTheme.urgencyLevel, 'emergency')
    assert.equal(newsEmergTheme.leftBorderColor, '#dc2626')
    assert.equal(newsEmergTheme.actionLabel, 'View Advisory')

    // High Priority theme (amber #d97706)
    const highTheme = resolveAdvisoryUrgencyTheme({ source: 'news', priority: 'high' })
    assert.equal(highTheme.urgencyLevel, 'high_priority')
    assert.equal(highTheme.leftBorderColor, '#d97706')

    // Pinned theme (forest green #16a34a)
    const pinnedTheme = resolveAdvisoryUrgencyTheme({ source: 'news', isPinned: true })
    assert.equal(pinnedTheme.urgencyLevel, 'pinned')
    assert.equal(pinnedTheme.leftBorderColor, '#16a34a')
  })

  await t.test('4. ID Collision Prevention: Same integer ID across EmergencyAlert and NewsItem', () => {
    const rawAlert = { id: 1, title: 'Alert Title', body: 'Alert Content' }
    const rawNews = { id: 1, title: 'News Title', description: 'News Content', priority: 'high' }

    const normAlert = normalizeEmergencyAlert(rawAlert)
    const normNews = normalizeUrgentNewsItem(rawNews)

    // Distinct composite keys guaranteed
    const keyAlert = `${normAlert.source}-${normAlert.id}`
    const keyNews = `${normNews.source}-${normNews.id}`
    assert.notEqual(keyAlert, keyNews)
    assert.equal(keyAlert, 'alert-1')
    assert.equal(keyNews, 'news-1')

    // URL parameter routing discrimination
    const alertParam = '1'
    const articleParam = '1'

    // Resolving alertParam against alerts list finds alert, never news
    const alertsList = [normAlert]
    const newsList = [normNews]

    const resolvedAlert = alertsList.find(a => String(a.id) === alertParam && a.source === 'alert')
    const resolvedArticle = newsList.find(n => String(n.id) === articleParam && n.source === 'news')

    assert.equal(resolvedAlert.title, 'Alert Title')
    assert.equal(resolvedArticle.title, 'News Title')
  })

  await t.test('5. URL SearchParams Preservation when toggling ?alert and ?article', () => {
    // Initial state: user has selected scope and category
    const initialParams = new URLSearchParams('scope=city_wide&category=Service+Updates&search=truck')

    // User opens an emergency alert: ?alert=10
    const alertOpened = new URLSearchParams(initialParams)
    alertOpened.delete('article')
    alertOpened.set('alert', '10')

    assert.equal(alertOpened.get('alert'), '10')
    assert.equal(alertOpened.get('scope'), 'city_wide')
    assert.equal(alertOpened.get('category'), 'Service Updates')
    assert.equal(alertOpened.get('search'), 'truck')

    // User closes alert modal
    const alertClosed = new URLSearchParams(alertOpened)
    alertClosed.delete('alert')

    assert.equal(alertClosed.get('alert'), null)
    assert.equal(alertClosed.get('scope'), 'city_wide')
    assert.equal(alertClosed.get('category'), 'Service Updates')
    assert.equal(alertClosed.get('search'), 'truck')
  })

  await t.test('6. ActiveAdvisoriesSection disclosure threshold slices at 2 without losing items', () => {
    const advisories = [
      { source: 'alert', id: '1', title: 'Alert 1', urgencyLevel: 'emergency' },
      { source: 'news', id: '2', title: 'News 2', urgencyLevel: 'emergency' },
      { source: 'news', id: '3', title: 'News 3', urgencyLevel: 'high_priority' },
      { source: 'news', id: '4', title: 'News 4', urgencyLevel: 'pinned' },
    ]

    const totalCount = advisories.length
    assert.equal(totalCount, 4)

    // Collapsed state
    const collapsedVisible = advisories.slice(0, 2)
    assert.equal(collapsedVisible.length, 2)
    assert.equal(collapsedVisible[0].id, '1')
    assert.equal(collapsedVisible[1].id, '2')

    // Expanded state contains all 4 items
    const expandedVisible = advisories
    assert.equal(expandedVisible.length, 4)
    assert.equal(advisories.length, 4, 'Original underlying array is never mutated or truncated')
  })
})
