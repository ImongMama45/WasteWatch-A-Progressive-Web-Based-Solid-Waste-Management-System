import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  createCalendarEntriesSession,
  evaluateCalendarCallerContext,
} from '../useCalendarEntries.js'
import { CalendarServiceError } from '../../api/calendarService.js'

describe('useCalendarEntries — Hook & Session Manager Baseline Tests', () => {
  it('handles successful fetch lifecycle and updates state', async () => {
    const states = []
    const mockFetcher = async () => ({
      results: [
        { id: 'event_1', title: 'Community Cleanup', category: 'cleanup' },
        { id: 'event_2', title: 'Orientation', category: 'workshop' },
      ],
      count: 2,
      totalPages: 1,
      currentPage: 1,
      pageSize: 20,
      next: null,
      previous: null,
      paginated: true,
    })

    const session = createCalendarEntriesSession({
      fetcher: mockFetcher,
      cacheReader: async () => null,
      cacheWriter: async () => null,
      onStateChange: (s) => states.push({ ...s }),
    })

    const result = await session.fetch({
      startDate: '2026-11-10',
      endDate: '2026-11-16',
      source: 'municipal_event',
    })

    assert.equal(result.entries.length, 2)
    assert.equal(result.loading, false)
    assert.equal(result.error, null)

    // State 1: loading=true
    assert.equal(states[0].loading, true)
    assert.equal(states[0].entries.length, 0)

    // State 2: loading=false with results
    assert.equal(states[1].loading, false)
    assert.equal(states[1].entries.length, 2)
    assert.equal(states[1].entries[0].title, 'Community Cleanup')
  })

  it('handles error state and distinguishes network vs capacity errors', async () => {
    const capacityErr = new CalendarServiceError('Capacity reached', {
      status: 503,
      code: 'capacity_limit_exceeded',
    })

    const session503 = createCalendarEntriesSession({
      fetcher: async () => {
        throw capacityErr
      },
      cacheReader: async () => null,
      cacheWriter: async () => null,
    })

    const res503 = await session503.fetch({ startDate: '2026-11-10', endDate: '2026-11-16' })
    assert.equal(res503.loading, false)
    assert.equal(res503.error, capacityErr)
    assert.equal(res503.isCapacityError, true)
    assert.equal(res503.isNetworkError, false)

    const networkErr = new CalendarServiceError('Network connection failed', {
      status: null,
      code: 'network_error',
    })

    const sessionNet = createCalendarEntriesSession({
      fetcher: async () => {
        throw networkErr
      },
      cacheReader: async () => null,
      cacheWriter: async () => null,
    })

    const resNet = await sessionNet.fetch({ startDate: '2026-11-10', endDate: '2026-11-16' })
    assert.equal(resNet.error, networkErr)
    assert.equal(resNet.isNetworkError, true)
    assert.equal(resNet.isCapacityError, false)
  })

  it('stale request protection: slower older requests cannot overwrite newer ones', async () => {
    const states = []
    let resolveFirst
    const firstPromise = new Promise((resolve) => {
      resolveFirst = resolve
    })

    const session = createCalendarEntriesSession({
      fetcher: async (opts) => {
        if (opts.category === 'first') {
          return firstPromise
        }
        return {
          results: [{ id: 'event_new', title: 'Newer Request' }],
          count: 1,
          totalPages: 1,
          currentPage: 1,
          pageSize: 20,
          next: null,
          previous: null,
          paginated: true,
        }
      },
      cacheReader: async () => null,
      cacheWriter: async () => null,
      onStateChange: (s) => states.push({ ...s }),
    })

    // Start first request (slow)
    const p1 = session.fetch({
      startDate: '2026-11-10',
      endDate: '2026-11-16',
      category: 'first',
    })

    // Immediately start second request (fast)
    const p2 = session.fetch({
      startDate: '2026-11-10',
      endDate: '2026-11-16',
      category: 'second',
    })

    await p2

    // Second request resolved
    assert.equal(session.getState().entries[0].title, 'Newer Request')

    // Now resolve first slow request
    resolveFirst({
      results: [{ id: 'event_old', title: 'Stale Outdated Request' }],
      count: 1,
      totalPages: 1,
      currentPage: 1,
      pageSize: 20,
      next: null,
      previous: null,
      paginated: true,
    })
    await p1

    // State MUST NOT be overwritten by stale first request
    assert.equal(session.getState().entries[0].title, 'Newer Request')
  })

  it('preserves existing entries during background refresh', async () => {
    let callCount = 0

    const session = createCalendarEntriesSession({
      fetcher: async () => {
        callCount++
        return {
          results: [{ id: `event_${callCount}`, title: `Event ${callCount}` }],
          count: 1,
          totalPages: 1,
          currentPage: 1,
          pageSize: 20,
          next: null,
          previous: null,
          paginated: true,
        }
      },
      cacheReader: async () => null,
      cacheWriter: async () => null,
    })

    // Initial fetch
    await session.fetch({ startDate: '2026-11-10', endDate: '2026-11-16' })
    assert.equal(session.getState().entries[0].title, 'Event 1')

    // Background refresh
    const refreshPromise = session.refresh({ startDate: '2026-11-10', endDate: '2026-11-16' })
    // While refreshing: isRefreshing is true, loading is false, previous entries preserved
    assert.equal(session.getState().isRefreshing, true)
    assert.equal(session.getState().loading, false)
    assert.equal(session.getState().entries.length, 1)

    await refreshPromise
    assert.equal(session.getState().isRefreshing, false)
    assert.equal(session.getState().entries[0].title, 'Event 2')
  })

  it('unmount cancellation ignores in-flight responses safely', async () => {
    let resolvePending
    const pendingPromise = new Promise((resolve) => {
      resolvePending = resolve
    })

    let stateUpdates = 0
    const session = createCalendarEntriesSession({
      fetcher: () => pendingPromise,
      cacheReader: async () => null,
      cacheWriter: async () => null,
      onStateChange: () => {
        stateUpdates++
      },
    })

    session.fetch({ startDate: '2026-11-10', endDate: '2026-11-16' })
    assert.equal(stateUpdates, 1) // initial loading state

    // Component unmounts
    session.cancel()

    // Response arrives later
    resolvePending({
      results: [{ id: 'event_late', title: 'Late Event' }],
      count: 1,
      paginated: false,
    })
    await pendingPromise

    // No further state updates after cancel
    assert.equal(stateUpdates, 1)
  })
})

describe('useCalendarEntries — Group A: Cache-First Behavior Tests', () => {
  it('A1. Fresh cached data appears immediately before network fetch completes', async () => {
    const states = []
    let resolveNetwork
    const networkPromise = new Promise((resolve) => {
      resolveNetwork = resolve
    })

    const cachedData = {
      entries: [{ id: 'cached_1', title: 'Cached Cleanup', status: 'published' }],
      count: 1,
      isFresh: true,
      isStale: false,
      cachedAt: 1000000,
    }

    const session = createCalendarEntriesSession({
      user: null, // anonymous public caller
      cacheReader: async () => cachedData,
      cacheWriter: async () => null,
      fetcher: () => networkPromise,
      onStateChange: (s) => states.push({ ...s }),
    })

    const fetchPromise = session.fetch({ startDate: '2026-11-10', endDate: '2026-11-16' })

    // Give microtask queue opportunity to complete async cache read
    await new Promise((r) => setTimeout(r, 10))

    // While network is in flight:
    const interim = session.getState()
    assert.equal(interim.entries.length, 1)
    assert.equal(interim.entries[0].title, 'Cached Cleanup')
    assert.equal(interim.isFromCache, true)
    assert.equal(interim.isStale, false)
    assert.equal(interim.isRefreshing, true)
    assert.equal(interim.loading, false)

    // Complete network fetch with fresh data
    resolveNetwork({
      results: [{ id: 'fresh_1', title: 'Fresh Network Cleanup', status: 'published' }],
      count: 1,
      totalPages: 1,
      currentPage: 1,
      pageSize: 20,
      next: null,
      previous: null,
      paginated: true,
    })
    await fetchPromise

    // After network resolves:
    const finalState = session.getState()
    assert.equal(finalState.entries.length, 1)
    assert.equal(finalState.entries[0].title, 'Fresh Network Cleanup')
    assert.equal(finalState.isFromCache, false)
    assert.equal(finalState.isStale, false)
    assert.equal(finalState.isRefreshing, false)
    assert.equal(finalState.loading, false)
  })

  it('A2. Stale cached data appears immediately with isStale=true before network completes', async () => {
    let resolveNetwork
    const networkPromise = new Promise((resolve) => {
      resolveNetwork = resolve
    })

    const cachedData = {
      entries: [{ id: 'stale_1', title: 'Old Seminar', status: 'published' }],
      count: 1,
      isFresh: false,
      isStale: true,
      cachedAt: 500000,
    }

    const session = createCalendarEntriesSession({
      user: null,
      cacheReader: async () => cachedData,
      cacheWriter: async () => null,
      fetcher: () => networkPromise,
    })

    const fetchPromise = session.fetch({ startDate: '2026-11-10', endDate: '2026-11-16' })
    await new Promise((r) => setTimeout(r, 10))

    // Stale cached data is shown while refreshing
    const interim = session.getState()
    assert.equal(interim.entries[0].title, 'Old Seminar')
    assert.equal(interim.isFromCache, true)
    assert.equal(interim.isStale, true)
    assert.equal(interim.isRefreshing, true)

    // Network resolves
    resolveNetwork({
      results: [{ id: 'new_1', title: 'New Seminar', status: 'published' }],
      count: 1,
      totalPages: 1,
      currentPage: 1,
      pageSize: 20,
      next: null,
      previous: null,
      paginated: true,
    })
    await fetchPromise

    const finalState = session.getState()
    assert.equal(finalState.entries[0].title, 'New Seminar')
    assert.equal(finalState.isFromCache, false)
    assert.equal(finalState.isStale, false)
    assert.equal(finalState.isRefreshing, false)
  })

  it('A3. Cache miss transitions to ordinary loading state then displays fresh API results', async () => {
    const states = []
    const session = createCalendarEntriesSession({
      user: null,
      cacheReader: async () => null, // Cache miss
      cacheWriter: async () => null,
      fetcher: async () => ({
        results: [{ id: 'api_1', title: 'Fresh Event', status: 'published' }],
        count: 1,
        totalPages: 1,
        currentPage: 1,
        pageSize: 20,
        next: null,
        previous: null,
        paginated: true,
      }),
      onStateChange: (s) => states.push({ ...s }),
    })

    await session.fetch({ startDate: '2026-11-10', endDate: '2026-11-16' })

    const finalState = session.getState()
    assert.equal(finalState.entries.length, 1)
    assert.equal(finalState.entries[0].title, 'Fresh Event')
    assert.equal(finalState.isFromCache, false)
    assert.equal(finalState.loading, false)

    // Initial state before network resolution was loading=true
    assert.equal(states[0].loading, true)
    assert.equal(states[0].isFromCache, false)
  })

  it('A4. Preserves and restores pagination metadata from cache and updates from network', async () => {
    let writtenMetadata = null
    const cachedData = {
      entries: [{ id: 'cached_p1' }],
      count: 45,
      isFresh: true,
      isStale: false,
      entry: {
        page: 1,
        pageSize: 20,
        paginate: true,
        metadata: {
          pagination: {
            count: 45,
            totalPages: 3,
            currentPage: 1,
            pageSize: 20,
            next: 2,
            previous: null,
            paginated: true,
          },
        },
      },
    }

    const session = createCalendarEntriesSession({
      user: null,
      cacheReader: async () => cachedData,
      cacheWriter: async (opts, results, meta) => {
        writtenMetadata = meta
      },
      fetcher: async () => ({
        results: [{ id: 'net_p1' }, { id: 'net_p2' }],
        count: 50,
        totalPages: 3,
        currentPage: 1,
        pageSize: 20,
        next: 2,
        previous: null,
        paginated: true,
      }),
    })

    await session.fetch({ startDate: '2026-11-10', endDate: '2026-11-16', page: 1, pageSize: 20 })

    const finalState = session.getState()
    assert.equal(finalState.pagination.count, 50)
    assert.equal(finalState.pagination.totalPages, 3)
    assert.equal(finalState.pagination.currentPage, 1)
    assert.equal(writtenMetadata.count, 50)
    assert.equal(writtenMetadata.pagination.totalPages, 3)
  })
})

describe('useCalendarEntries — Group B: Offline & Error Fallback Tests', () => {
  it('B1. Fresh cache remains displayed when network fails with network error', async () => {
    const cachedData = {
      entries: [{ id: 'offline_fresh', title: 'Offline Event', status: 'published' }],
      count: 1,
      isFresh: true,
      isStale: false,
      cachedAt: 10000,
    }

    const networkErr = new CalendarServiceError('Connection refused', {
      status: null,
      code: 'network_error',
    })

    const session = createCalendarEntriesSession({
      user: null,
      cacheReader: async () => cachedData,
      cacheWriter: async () => null,
      fetcher: async () => {
        throw networkErr
      },
    })

    const result = await session.fetch({ startDate: '2026-11-10', endDate: '2026-11-16' })

    // Cached entries remain visible
    assert.equal(result.entries.length, 1)
    assert.equal(result.entries[0].title, 'Offline Event')
    assert.equal(result.isFromCache, true)
    // Within TTL remains fresh
    assert.equal(result.isStale, false)
    assert.equal(result.isNetworkError, true)
    assert.equal(result.error, networkErr)
  })

  it('B2. Stale cache remains displayed with isStale=true when network fails', async () => {
    const cachedData = {
      entries: [{ id: 'offline_stale', title: 'Old Event', status: 'published' }],
      count: 1,
      isFresh: false,
      isStale: true,
      cachedAt: 1000,
    }

    const networkErr = new CalendarServiceError('Network unavailable', {
      status: null,
      code: 'network_error',
    })

    const session = createCalendarEntriesSession({
      user: null,
      cacheReader: async () => cachedData,
      cacheWriter: async () => null,
      fetcher: async () => {
        throw networkErr
      },
    })

    const result = await session.fetch({ startDate: '2026-11-10', endDate: '2026-11-16' })

    assert.equal(result.entries.length, 1)
    assert.equal(result.entries[0].title, 'Old Event')
    assert.equal(result.isFromCache, true)
    assert.equal(result.isStale, true)
    assert.equal(result.isNetworkError, true)
  })

  it('B3. Cache miss plus network failure produces expected empty state and error', async () => {
    const networkErr = new CalendarServiceError('Network unavailable', {
      status: null,
      code: 'network_error',
    })

    const session = createCalendarEntriesSession({
      user: null,
      cacheReader: async () => null, // Cache miss
      cacheWriter: async () => null,
      fetcher: async () => {
        throw networkErr
      },
    })

    const result = await session.fetch({ startDate: '2026-11-10', endDate: '2026-11-16' })

    assert.equal(result.entries.length, 0)
    assert.equal(result.isFromCache, false)
    assert.equal(result.error, networkErr)
    assert.equal(result.isNetworkError, true)
  })

  it('B4. Cache read failure does not block network fetching', async () => {
    let networkFetched = false
    const session = createCalendarEntriesSession({
      user: null,
      cacheReader: async () => {
        throw new Error('IndexedDB disk corrupted')
      },
      cacheWriter: async () => null,
      fetcher: async () => {
        networkFetched = true
        return {
          results: [{ id: 'recovered_1', title: 'Recovered Event' }],
          count: 1,
          totalPages: 1,
          currentPage: 1,
          pageSize: 20,
          next: null,
          previous: null,
          paginated: true,
        }
      },
    })

    const result = await session.fetch({ startDate: '2026-11-10', endDate: '2026-11-16' })

    assert.equal(networkFetched, true)
    assert.equal(result.entries.length, 1)
    assert.equal(result.entries[0].title, 'Recovered Event')
    assert.equal(result.isFromCache, false)
    assert.equal(result.error, null)
  })

  it('B5. Cache write failure does not discard successful API response', async () => {
    const session = createCalendarEntriesSession({
      user: null,
      cacheReader: async () => null,
      cacheWriter: async () => {
        throw new Error('QuotaExceededError: storage full')
      },
      fetcher: async () => ({
        results: [{ id: 'write_fail_1', title: 'Protected Event' }],
        count: 1,
        totalPages: 1,
        currentPage: 1,
        pageSize: 20,
        next: null,
        previous: null,
        paginated: true,
      }),
    })

    const result = await session.fetch({ startDate: '2026-11-10', endDate: '2026-11-16' })

    // Response must be presented normally despite write failure
    assert.equal(result.entries.length, 1)
    assert.equal(result.entries[0].title, 'Protected Event')
    assert.equal(result.error, null)
    assert.equal(result.isFromCache, false)
  })
})

describe('useCalendarEntries — Group C: Security & Role Boundary Tests', () => {
  it('C1. Admin caller skips public cache reads and writes completely', async () => {
    let cacheReadCount = 0
    let cacheWriteCount = 0

    const session = createCalendarEntriesSession({
      user: { id: 1, role: 'admin', is_staff: true },
      cacheReader: async () => {
        cacheReadCount++
        return { entries: [{ id: 'should_not_read' }] }
      },
      cacheWriter: async () => {
        cacheWriteCount++
      },
      fetcher: async () => ({
        results: [{ id: 'admin_event', title: 'Admin Draft Event', status: 'draft' }],
        count: 1,
        paginated: false,
      }),
    })

    const result = await session.fetch({ startDate: '2026-11-10', endDate: '2026-11-16' })

    // Must NOT read from shared public cache
    assert.equal(cacheReadCount, 0, 'Admin request must never read from public cache')
    // Must NOT write to shared public cache
    assert.equal(cacheWriteCount, 0, 'Admin response must never write to public cache')

    // Result comes strictly from network
    assert.equal(result.entries[0].title, 'Admin Draft Event')
    assert.equal(result.isFromCache, false)
  })

  it('C2. Staff caller (is_staff=true) skips public cache even if role is not admin', async () => {
    let cacheReadCount = 0
    let cacheWriteCount = 0

    const session = createCalendarEntriesSession({
      user: { id: 2, role: 'custom_operator', is_staff: true },
      cacheReader: async () => {
        cacheReadCount++
        return { entries: [] }
      },
      cacheWriter: async () => {
        cacheWriteCount++
      },
      fetcher: async () => ({
        results: [{ id: 'staff_event', title: 'Staff Item' }],
        count: 1,
        paginated: false,
      }),
    })

    await session.fetch({ startDate: '2026-11-10', endDate: '2026-11-16' })

    assert.equal(cacheReadCount, 0)
    assert.equal(cacheWriteCount, 0)
  })

  it('C3. Anonymous caller (user=null) is positively verified as public', async () => {
    const auth = evaluateCalendarCallerContext(null)
    assert.equal(auth.isPublic, true)
    assert.equal(auth.isAdmin, false)
    assert.equal(auth.isVerified, true)
    assert.equal(auth.user, null)

    let writeUser = undefined
    const session = createCalendarEntriesSession({
      user: null,
      cacheReader: async () => null,
      cacheWriter: async (opts, res, meta, writeOpts) => {
        writeUser = writeOpts.user
      },
      fetcher: async () => ({
        results: [{ id: 'pub_event', title: 'Public Event' }],
        count: 1,
        paginated: false,
      }),
    })

    await session.fetch({ startDate: '2026-11-10', endDate: '2026-11-16' })
    assert.equal(writeUser, null, 'Cache writer must receive user=null')
  })

  it('C4. Authorized operational and citizen roles read and write to public cache safely', async () => {
    const publicRoles = ['citizen', 'watcher', 'driver', 'dumpsite', 'brgy_official']

    for (const role of publicRoles) {
      const user = { id: 99, role, is_staff: false }
      const auth = evaluateCalendarCallerContext(user)
      assert.equal(auth.isPublic, true, `Role ${role} must be public`)
      assert.equal(auth.isAdmin, false, `Role ${role} must not be admin`)
      assert.equal(auth.isVerified, true)

      let writeOccurred = false
      const session = createCalendarEntriesSession({
        user,
        cacheReader: async () => null,
        cacheWriter: async () => {
          writeOccurred = true
        },
        fetcher: async () => ({
          results: [{ id: `event_${role}`, title: `Event for ${role}` }],
          count: 1,
          paginated: false,
        }),
      })

      await session.fetch({ startDate: '2026-11-10', endDate: '2026-11-16' })
      assert.equal(writeOccurred, true, `Cache write must occur for verified role ${role}`)
    }
  })

  it('C5. Unknown or unverified caller context (user=undefined) fails closed', async () => {
    const auth = evaluateCalendarCallerContext(undefined)
    assert.equal(auth.isPublic, false, 'Unverified context must not be marked public')
    assert.equal(auth.isVerified, false)

    let writeOccurred = false
    const session = createCalendarEntriesSession({
      user: undefined, // unverified
      cacheReader: async () => null,
      cacheWriter: async () => {
        writeOccurred = true
      },
      fetcher: async () => ({
        results: [{ id: 'ev_unverified', title: 'Unverified Caller Result' }],
        count: 1,
        paginated: false,
      }),
    })

    const result = await session.fetch({ startDate: '2026-11-10', endDate: '2026-11-16' })

    // Write must fail closed
    assert.equal(writeOccurred, false, 'Cache write must NOT occur for unverified caller')
    // Network still resolves normally
    assert.equal(result.entries[0].title, 'Unverified Caller Result')
  })

  it('C6. Requests for privileged lifecycle status (status=draft/archived) bypass caching', async () => {
    let writeOccurred = false
    const session = createCalendarEntriesSession({
      user: null,
      cacheReader: async () => null,
      cacheWriter: async () => {
        writeOccurred = true
      },
      fetcher: async () => ({
        results: [{ id: 'draft_ev', title: 'Draft Event', status: 'draft' }],
        count: 1,
        paginated: false,
      }),
    })

    await session.fetch({
      startDate: '2026-11-10',
      endDate: '2026-11-16',
      status: 'draft',
    })

    assert.equal(writeOccurred, false, 'status=draft request must bypass public cache write')
  })

  it('C7. Non-canonical dumpsite_operator role fails closed and is rejected as unknown role', async () => {
    const legacyUser = { id: 10, role: 'dumpsite_operator', is_staff: false }
    const auth = evaluateCalendarCallerContext(legacyUser)
    assert.equal(auth.isPublic, false, 'dumpsite_operator must not be treated as canonical public role')
    assert.equal(auth.isAdmin, false)
    assert.equal(auth.isVerified, false)
    assert.equal(auth.reason, 'unknown_caller_role')

    let cacheReadCount = 0
    let cacheWriteCount = 0
    const session = createCalendarEntriesSession({
      user: legacyUser,
      cacheReader: async () => {
        cacheReadCount++
        return null
      },
      cacheWriter: async () => {
        cacheWriteCount++
      },
      fetcher: async () => ({
        results: [{ id: 'ev_dumpsite_op', title: 'Dumpsite Op Event' }],
        count: 1,
        paginated: false,
      }),
    })

    const res = await session.fetch({ startDate: '2026-11-10', endDate: '2026-11-16' })
    assert.equal(cacheReadCount, 0, 'Non-canonical role must not read cache')
    assert.equal(cacheWriteCount, 0, 'Non-canonical role must not write cache')
    assert.equal(res.entries[0].title, 'Dumpsite Op Event')
  })

  it('C8. Unknown or missing roles fail closed with unknown_caller_role', async () => {
    const testCases = [
      { role: 'moderator' },
      { role: 'volunteer' },
      { role: 'guest' },
      { role: 'SUPERUSER' },
      {},
    ]

    for (const u of testCases) {
      const auth = evaluateCalendarCallerContext(u)
      assert.equal(auth.isPublic, false, `Role "${u.role}" must fail closed`)
      assert.equal(auth.isVerified, false)
      assert.equal(auth.reason, 'unknown_caller_role')
    }
  })

  it('C9. Authenticated public role with is_staff=true is classified as staff/admin and excluded from cache', async () => {
    const staffCitizen = { id: 77, role: 'citizen', is_staff: true }
    const auth = evaluateCalendarCallerContext(staffCitizen)
    assert.equal(auth.isPublic, false, 'Citizen with is_staff must not be public')
    assert.equal(auth.isAdmin, true, 'Citizen with is_staff must be classified as admin/staff')
    assert.equal(auth.isVerified, true)
    assert.equal(auth.reason, 'caller_is_admin')

    let cacheReadCount = 0
    let cacheWriteCount = 0
    const session = createCalendarEntriesSession({
      user: staffCitizen,
      cacheReader: async () => {
        cacheReadCount++
        return null
      },
      cacheWriter: async () => {
        cacheWriteCount++
      },
      fetcher: async () => ({
        results: [{ id: 'ev_staff_cit', title: 'Staff Citizen Result' }],
        count: 1,
        paginated: false,
      }),
    })

    await session.fetch({ startDate: '2026-11-10', endDate: '2026-11-16' })
    assert.equal(cacheReadCount, 0)
    assert.equal(cacheWriteCount, 0)
  })

  it('C10. Restoring auth session (auth.loading=true) fails closed and skips cache read and write', async () => {
    let cacheReadCount = 0
    let cacheWriteCount = 0

    // Loading session where user is currently null during bootstrap
    const session = createCalendarEntriesSession({
      auth: { loading: true, user: null },
      cacheReader: async () => {
        cacheReadCount++
        return { entries: [{ id: 'cached_ev' }], isFresh: true }
      },
      cacheWriter: async () => {
        cacheWriteCount++
      },
      fetcher: async () => ({
        results: [{ id: 'ev_restoring', title: 'Restoring Network Result' }],
        count: 1,
        paginated: false,
      }),
    })

    const res = await session.fetch({ startDate: '2026-11-10', endDate: '2026-11-16' })

    // Caller identity is unresolved, so public cache is neither read nor written
    assert.equal(cacheReadCount, 0, 'Must not read public cache while auth is restoring')
    assert.equal(cacheWriteCount, 0, 'Must not write public cache while auth is restoring')
    assert.equal(res.isFromCache, false)
    assert.equal(res.entries[0].title, 'Restoring Network Result')
  })

  it('C11. Restoring Admin session (auth.loading=true, user=admin) skips public cache before and after', async () => {
    let cacheReadCount = 0
    let cacheWriteCount = 0

    const session = createCalendarEntriesSession({
      auth: { loading: true, user: { role: 'admin', is_staff: true } },
      cacheReader: async () => {
        cacheReadCount++
        return null
      },
      cacheWriter: async () => {
        cacheWriteCount++
      },
      fetcher: async () => ({
        results: [{ id: 'ev_admin_draft', title: 'Admin Draft', status: 'draft' }],
        count: 1,
        paginated: false,
      }),
    })

    await session.fetch({ startDate: '2026-11-10', endDate: '2026-11-16' })
    assert.equal(cacheReadCount, 0)
    assert.equal(cacheWriteCount, 0)
  })
})

describe('useCalendarEntries — Group D: Race Condition & Lifecycle Protection Tests', () => {
  it('D1. Late cache read cannot overwrite fresh network response', async () => {
    let resolveCache
    const cachePromise = new Promise((resolve) => {
      resolveCache = resolve
    })

    const session = createCalendarEntriesSession({
      user: null,
      cacheReader: () => cachePromise, // slow cache read
      cacheWriter: async () => null,
      fetcher: async () => ({
        // fast network response
        results: [{ id: 'fast_net', title: 'Fast Network Response' }],
        count: 1,
        paginated: false,
      }),
    })

    // Initiate fetch
    const fetchPromise = session.fetch({ startDate: '2026-11-10', endDate: '2026-11-16' })
    await fetchPromise

    // Network has already updated state
    assert.equal(session.getState().entries[0].title, 'Fast Network Response')
    assert.equal(session.getState().isFromCache, false)

    // Now late cache read resolves
    resolveCache({
      entries: [{ id: 'slow_cache', title: 'Slow Cached Response' }],
      isFresh: true,
      count: 1,
    })
    await new Promise((r) => setTimeout(r, 15))

    // State MUST NOT be replaced by late cache response!
    assert.equal(session.getState().entries[0].title, 'Fast Network Response')
    assert.equal(session.getState().isFromCache, false)
  })

  it('D2. Rapid parameter changes isolate requests and prevent cross-query cache contamination', async () => {
    const cacheMap = {
      1: { entries: [{ id: 'ev_brgy_1', title: 'Brgy 1 Event' }], isFresh: true, count: 1 },
      2: { entries: [{ id: 'ev_brgy_2', title: 'Brgy 2 Event' }], isFresh: true, count: 1 },
    }

    const session = createCalendarEntriesSession({
      user: null,
      cacheReader: async (params) => {
        return cacheMap[params.barangayId] || null
      },
      cacheWriter: async () => null,
      fetcher: async (params) => ({
        results: [{ id: `net_brgy_${params.barangayId}`, title: `Net Brgy ${params.barangayId}` }],
        count: 1,
        paginated: false,
      }),
    })

    // Fetch for Barangay 1
    await session.fetch({ startDate: '2026-11-10', endDate: '2026-11-16', barangayId: 1 })
    assert.equal(session.getState().entries[0].title, 'Net Brgy 1')

    // Switch to Barangay 2
    await session.fetch({ startDate: '2026-11-10', endDate: '2026-11-16', barangayId: 2 })
    assert.equal(session.getState().entries[0].title, 'Net Brgy 2')
  })

  it('D3. Cancelled requests do not update state or write results to cache', async () => {
    let writeCount = 0
    let resolveNetwork
    const netPromise = new Promise((resolve) => {
      resolveNetwork = resolve
    })

    const session = createCalendarEntriesSession({
      user: null,
      cacheReader: async () => null,
      cacheWriter: async () => {
        writeCount++
      },
      fetcher: () => netPromise,
    })

    const fetchPromise = session.fetch({ startDate: '2026-11-10', endDate: '2026-11-16' })

    // Cancel before response completes
    session.cancel()

    // Response completes later
    resolveNetwork({
      results: [{ id: 'cancelled_event', title: 'Cancelled Event' }],
      count: 1,
      paginated: false,
    })
    await fetchPromise

    // State not updated
    assert.equal(session.getState().entries.length, 0)
    // Cache not written
    assert.equal(writeCount, 0)
  })
})
