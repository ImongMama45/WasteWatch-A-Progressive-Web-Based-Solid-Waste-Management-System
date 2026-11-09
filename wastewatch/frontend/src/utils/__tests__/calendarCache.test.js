import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  DB_NAME,
  DB_VERSION,
  STORES,
  CALENDAR_CACHE_STORE,
  openDB,
  closeDB,
} from '../idbSchema.js'

import {
  DEFAULT_CALENDAR_TTL_MS,
  normalizeCalendarParams,
  buildCalendarCacheKey,
  isCacheablePublicQuery,
  verifyPublicVisibilityContext,
  verifyEntriesContainOnlyPublicData,
  getCalendarCacheEntry,
  setCalendarCacheEntry,
  deleteCalendarCacheEntry,
  pruneExpiredCalendarCache,
  clearCalendarCache,
} from '../calendarCache.js'

// ─── Lightweight In-Memory IndexedDB Simulation for Node.js ──────────────────

function createIndexedDBMock() {
  const dbs = new Map() // dbName -> { version, stores: Map<string, { keyPath, indexes: Map, records: Map }> }
  const openConnections = new Set()

  class MockIDBIndex {
    constructor(name, keyPath, store) {
      this.name = name
      this.keyPath = keyPath
      this.store = store
    }
  }

  class MockIDBObjectStore {
    constructor(name, keyPath, storeData, tx) {
      this.name = name
      this.keyPath = keyPath
      this.storeData = storeData
      this.tx = tx
    }

    createIndex(name, keyPath, options = {}) {
      const idx = new MockIDBIndex(name, keyPath, this)
      this.storeData.indexes.set(name, { keyPath, options, idx })
      return idx
    }

    get indexNames() {
      const names = Array.from(this.storeData.indexes.keys())
      names.contains = (n) => this.storeData.indexes.has(n)
      return names
    }

    index(name) {
      const idxData = this.storeData.indexes.get(name)
      if (!idxData) throw new Error(`Index not found: ${name}`)
      return idxData.idx
    }

    get(key) {
      const req = { onsuccess: null, onerror: null, result: undefined }
      queueMicrotask(() => {
        req.result = this.storeData.records.get(key)
        if (req.onsuccess) req.onsuccess({ target: req })
      })
      return req
    }

    put(record) {
      const req = { onsuccess: null, onerror: null, result: undefined }
      const key = record[this.keyPath]
      queueMicrotask(() => {
        this.storeData.records.set(key, JSON.parse(JSON.stringify(record)))
        req.result = key
        if (req.onsuccess) req.onsuccess({ target: req })
      })
      return req
    }

    delete(key) {
      const req = { onsuccess: null, onerror: null, result: undefined }
      queueMicrotask(() => {
        this.storeData.records.delete(key)
        req.result = undefined
        if (req.onsuccess) req.onsuccess({ target: req })
      })
      return req
    }

    getAll() {
      const req = { onsuccess: null, onerror: null, result: undefined }
      queueMicrotask(() => {
        req.result = Array.from(this.storeData.records.values()).map(r => JSON.parse(JSON.stringify(r)))
        if (req.onsuccess) req.onsuccess({ target: req })
      })
      return req
    }

    clear() {
      const req = { onsuccess: null, onerror: null, result: undefined }
      queueMicrotask(() => {
        this.storeData.records.clear()
        req.result = undefined
        if (req.onsuccess) req.onsuccess({ target: req })
      })
      return req
    }
  }

  class MockIDBTransaction {
    constructor(db, storeNames, mode) {
      this.db = db
      this.mode = mode
      this.storeNames = Array.isArray(storeNames) ? storeNames : [storeNames]
      this.oncomplete = null
      this.onerror = null
      this.onabort = null

      queueMicrotask(() => {
        if (this.oncomplete) this.oncomplete({ target: this })
      })
    }

    objectStore(name) {
      const storeData = this.db.dbData.stores.get(name)
      if (!storeData) throw new Error(`Object store not found: ${name}`)
      return new MockIDBObjectStore(name, storeData.keyPath, storeData, this)
    }
  }

  class MockIDBDatabase {
    constructor(name, dbData) {
      this.name = name
      this.dbData = dbData
      this.onversionchange = null
      this.onclose = null
    }

    get version() {
      return this.dbData.version
    }

    get objectStoreNames() {
      const names = Array.from(this.dbData.stores.keys())
      names.contains = (n) => this.dbData.stores.has(n)
      return names
    }

    createObjectStore(name, { keyPath }) {
      const storeData = {
        keyPath,
        indexes: new Map(),
        records: new Map(),
      }
      this.dbData.stores.set(name, storeData)
      return new MockIDBObjectStore(name, keyPath, storeData, null)
    }

    transaction(storeNames, mode = 'readonly') {
      return new MockIDBTransaction(this, storeNames, mode)
    }

    close() {
      openConnections.delete(this)
      if (this.onclose) this.onclose({ target: this })
    }
  }

  function open(name, version) {
    const req = {
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null,
      onblocked: null,
      result: null,
    }

    let dbData = dbs.get(name)
    const oldVersion = dbData ? dbData.version : 0

    if (!dbData) {
      dbData = { version: version || 1, stores: new Map() }
      dbs.set(name, dbData)
    }

    const dbInstance = new MockIDBDatabase(name, dbData)

    queueMicrotask(() => {
      if (version > oldVersion) {
        // Check for open blocking connections
        for (const conn of openConnections) {
          if (conn.name === name) {
            if (conn.onversionchange) {
              conn.onversionchange({ target: conn, oldVersion, newVersion: version })
            }
          }
        }

        dbData.version = version
        if (req.onupgradeneeded) {
          req.onupgradeneeded({
            target: { result: dbInstance },
            oldVersion,
            newVersion: version,
          })
        }
      }

      openConnections.add(dbInstance)
      req.result = dbInstance
      if (req.onsuccess) {
        req.onsuccess({ target: req })
      }
    })

    return req
  }

  return {
    open,
    dbs,
    openConnections,
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('IndexedDB Version 8 Upgrade & Schema Tests', () => {
  let mockIDB

  beforeEach(() => {
    mockIDB = createIndexedDBMock()
    globalThis.indexedDB = mockIDB
  })

  afterEach(async () => {
    await closeDB()
    delete globalThis.indexedDB
  })

  it('1. Upgrades from version 7 to version 8 preserving all 6 existing stores and records', async () => {
    // Step A: Seed version-7 database with existing queues and records
    const v7Data = {
      version: 7,
      stores: new Map(),
    }
    STORES.forEach((name) => {
      v7Data.stores.set(name, {
        keyPath: 'id',
        indexes: new Map([
          ['status', { keyPath: 'status' }],
          ['createdAt', { keyPath: 'createdAt' }],
          ['priority', { keyPath: 'priority' }],
        ]),
        records: new Map([
          ['rec_1', { id: 'rec_1', status: 'pending', createdAt: '2026-11-08T10:00:00Z', priority: 1 }],
          ['rec_2', { id: 'rec_2', status: 'synced', createdAt: '2026-11-08T11:00:00Z', priority: 2 }],
        ]),
      })
    })
    mockIDB.dbs.set(DB_NAME, v7Data)

    // Verify v7 state before upgrade
    assert.equal(v7Data.version, 7)
    assert.equal(v7Data.stores.has(CALENDAR_CACHE_STORE), false)
    assert.equal(v7Data.stores.get('reports').records.size, 2)

    // Step B: Open through openDB() which targets DB_VERSION = 8
    const db = await openDB()

    // Step C: Verify version 8
    assert.equal(db.version, 8)

    // Step D: Verify all six v7 stores exist and preserved their existing records
    STORES.forEach((storeName) => {
      assert.equal(db.objectStoreNames.contains(storeName), true, `Store ${storeName} must remain present`)
      const recs = v7Data.stores.get(storeName).records
      assert.equal(recs.has('rec_1'), true, `Record rec_1 in ${storeName} must be preserved`)
      assert.equal(recs.has('rec_2'), true, `Record rec_2 in ${storeName} must be preserved`)
    })

    // Step E: Verify calendar_entries_cache was created with keyPath 'cacheKey'
    assert.equal(db.objectStoreNames.contains(CALENDAR_CACHE_STORE), true)
    const calStoreData = v7Data.stores.get(CALENDAR_CACHE_STORE)
    assert.equal(calStoreData.keyPath, 'cacheKey')

    // Step F: Verify expected indexes on calendar_entries_cache
    const expectedIndexes = ['cachedAt', 'expiresAt', 'scope', 'startDate', 'endDate']
    expectedIndexes.forEach((idx) => {
      assert.equal(calStoreData.indexes.has(idx), true, `Index ${idx} must be present on calendar_entries_cache`)
    })
  })

  it('2. Reopening the version-8 database does not recreate or clear stores', async () => {
    const db1 = await openDB()
    assert.equal(db1.version, 8)
    await closeDB()

    // Reopen
    const db2 = await openDB()
    assert.equal(db2.version, 8)
    assert.equal(db2.objectStoreNames.contains(CALENDAR_CACHE_STORE), true)
  })

  it('3. Handles versionchange event by closing connection gracefully', async () => {
    const db = await openDB()
    let closed = false
    db.onclose = () => {
      closed = true
    }

    // Trigger versionchange (simulating another tab upgrading)
    db.onversionchange()
    assert.equal(closed, true, 'Database connection must close on versionchange')
  })
})

describe('calendarCache — Cache Key Normalization & Isolation Tests', () => {
  it('1. Generates deterministic cache key for identical parameters', () => {
    const paramsA = {
      startDate: '2026-11-10',
      endDate: '2026-11-16',
      barangayId: 5,
      source: 'municipal_event',
      includeNotices: true,
    }
    const paramsB = {
      start_date: '2026-11-10',
      end_date: '2026-11-16',
      barangay_id: '5',
      source: 'MUNICIPAL_EVENT',
      include_notices: 'true',
    }

    assert.equal(buildCalendarCacheKey(paramsA), buildCalendarCacheKey(paramsB))
  })

  it('2. Isolates different barangays into distinct cache keys', () => {
    const keyBrgy5 = buildCalendarCacheKey({ startDate: '2026-11-10', endDate: '2026-11-16', barangayId: 5 })
    const keyBrgy6 = buildCalendarCacheKey({ startDate: '2026-11-10', endDate: '2026-11-16', barangayId: 6 })

    assert.notEqual(keyBrgy5, keyBrgy6)
    assert.match(keyBrgy5, /b=5/)
    assert.match(keyBrgy6, /b=6/)
  })

  it('3. Strictly isolates citywide and barangay-specific scopes', () => {
    const keyCitywide = buildCalendarCacheKey({ startDate: '2026-11-10', endDate: '2026-11-16', barangayId: 'citywide' })
    const keyBrgy1 = buildCalendarCacheKey({ startDate: '2026-11-10', endDate: '2026-11-16', barangayId: 1 })

    assert.notEqual(keyCitywide, keyBrgy1)
    assert.match(keyCitywide, /b=citywide/)
    assert.match(keyBrgy1, /b=1/)
  })

  it('4. Isolates different date ranges into distinct cache keys', () => {
    const keyRange1 = buildCalendarCacheKey({ startDate: '2026-11-01', endDate: '2026-11-07' })
    const keyRange2 = buildCalendarCacheKey({ startDate: '2026-11-08', endDate: '2026-11-14' })

    assert.notEqual(keyRange1, keyRange2)
  })

  it('5. Isolates sources, categories, and notice flags', () => {
    const keyAll = buildCalendarCacheKey({ startDate: '2026-11-10', endDate: '2026-11-16', source: 'all' })
    const keyEvents = buildCalendarCacheKey({ startDate: '2026-11-10', endDate: '2026-11-16', source: 'municipal_event' })
    const keyCleanup = buildCalendarCacheKey({ startDate: '2026-11-10', endDate: '2026-11-16', category: 'cleanup' })
    const keyNotices = buildCalendarCacheKey({ startDate: '2026-11-10', endDate: '2026-11-16', includeNotices: true })

    assert.notEqual(keyAll, keyEvents)
    assert.notEqual(keyEvents, keyCleanup)
    assert.notEqual(keyAll, keyNotices)
  })

  it('6. Isolates pagination parameters', () => {
    const keyPage1 = buildCalendarCacheKey({ startDate: '2026-11-01', endDate: '2026-11-30', page: 1, pageSize: 20 })
    const keyPage2 = buildCalendarCacheKey({ startDate: '2026-11-01', endDate: '2026-11-30', page: 2, pageSize: 20 })
    const keyUnpaginated = buildCalendarCacheKey({ startDate: '2026-11-01', endDate: '2026-11-07', paginate: false })

    assert.notEqual(keyPage1, keyPage2)
    assert.notEqual(keyPage1, keyUnpaginated)
  })
})

describe('calendarCache — CRUD, TTL, and Pruning Operations', () => {
  let mockIDB

  beforeEach(() => {
    mockIDB = createIndexedDBMock()
    globalThis.indexedDB = mockIDB
  })

  afterEach(async () => {
    await closeDB()
    delete globalThis.indexedDB
  })

  it('1. Writes, reads back, and verifies record structure', async () => {
    const params = {
      startDate: '2026-11-10',
      endDate: '2026-11-16',
      barangayId: 1,
      source: 'municipal_event',
    }

    const sampleEntries = [
      { id: 'event_1', title: 'Community Clean-up', category: 'cleanup', source: 'municipal_event', status: 'published' },
      { id: 'event_2', title: 'Recycling Seminar', category: 'workshop', source: 'municipal_event', status: 'published' },
    ]

    const stored = await setCalendarCacheEntry(params, sampleEntries, { count: 2 }, { now: 1000, visibility: 'public' })
    assert.equal(stored.count, 2)
    assert.equal(stored.entries.length, 2)
    assert.equal(stored.cachedAt, 1000)
    assert.equal(stored.expiresAt, 1000 + DEFAULT_CALENDAR_TTL_MS)

    const readBack = await getCalendarCacheEntry(params, { now: 1000 })
    assert.notEqual(readBack, null)
    assert.equal(readBack.isFresh, true)
    assert.equal(readBack.isStale, false)
    assert.equal(readBack.entries.length, 2)
    assert.equal(readBack.entries[0].title, 'Community Clean-up')
  })

  it('2. Returns null for missing cache entry', async () => {
    const missing = await getCalendarCacheEntry({
      startDate: '2026-12-01',
      endDate: '2026-12-07',
    })
    assert.equal(missing, null)
  })

  it('3. Fresh vs expired entries: expired entry remains available as stale fallback', async () => {
    const params = { startDate: '2026-11-10', endDate: '2026-11-16' }
    const entries = [{ id: 'event_1', title: 'Event 1', source: 'municipal_event', status: 'published' }]
    const baseTime = 1000000
    const ttlMs = 15 * 60 * 1000 // 15 mins

    await setCalendarCacheEntry(params, entries, {}, { now: baseTime, ttlMs, visibility: 'public' })

    // Check while fresh (10 minutes later)
    const freshCheck = await getCalendarCacheEntry(params, { now: baseTime + 10 * 60 * 1000 })
    assert.equal(freshCheck.isFresh, true)
    assert.equal(freshCheck.isStale, false)
    assert.equal(freshCheck.entries.length, 1)

    // Check when expired (20 minutes later)
    const expiredCheck = await getCalendarCacheEntry(params, { now: baseTime + 20 * 60 * 1000 })
    assert.notEqual(expiredCheck, null)
    assert.equal(expiredCheck.isFresh, false)
    assert.equal(expiredCheck.isStale, true)
    assert.equal(expiredCheck.entries.length, 1, 'Expired entries must remain available as fallback')
  })

  it('4. Deletes specific cache entry cleanly', async () => {
    const params = { startDate: '2026-11-10', endDate: '2026-11-16' }
    await setCalendarCacheEntry(params, [{ id: 'event_1', source: 'municipal_event', status: 'published' }], {}, { visibility: 'public' })

    const existsBefore = await getCalendarCacheEntry(params)
    assert.notEqual(existsBefore, null)

    const deleted = await deleteCalendarCacheEntry(params)
    assert.equal(deleted, true)

    const existsAfter = await getCalendarCacheEntry(params)
    assert.equal(existsAfter, null)
  })

  it('5. Prunes only expired records past threshold without affecting fresh records', async () => {
    const baseTime = 1000000
    const ttlMs = 1000

    // Stale entry: expired at baseTime + 1000
    await setCalendarCacheEntry(
      { startDate: '2026-11-01', endDate: '2026-11-07' },
      [{ id: 'stale', source: 'municipal_event', status: 'published' }],
      {},
      { now: baseTime, ttlMs, visibility: 'public' }
    )

    // Fresh entry: expires at baseTime + 100,000
    await setCalendarCacheEntry(
      { startDate: '2026-11-10', endDate: '2026-11-16' },
      [{ id: 'fresh', source: 'municipal_event', status: 'published' }],
      {},
      { now: baseTime, ttlMs: 100000, visibility: 'public' }
    )

    // Prune at baseTime + 5000 (first entry expired, second entry still fresh)
    const pruneResult = await pruneExpiredCalendarCache({ now: baseTime + 5000 })
    assert.equal(pruneResult.prunedCount, 1)

    // Verify stale entry is gone
    const staleCheck = await getCalendarCacheEntry({ startDate: '2026-11-01', endDate: '2026-11-07' })
    assert.equal(staleCheck, null)

    // Verify fresh entry remains
    const freshCheck = await getCalendarCacheEntry({ startDate: '2026-11-10', endDate: '2026-11-16' })
    assert.notEqual(freshCheck, null)
  })

  it('6. Clears calendar cache without touching existing version-7 queue stores', async () => {
    // Write to calendar cache
    await setCalendarCacheEntry({ startDate: '2026-11-10', endDate: '2026-11-16' }, [{ id: 'e1', source: 'municipal_event', status: 'published' }], {}, { visibility: 'public' })

    // Seed a v7 queue record directly
    const db = await openDB()
    const tx = db.transaction('reports', 'readwrite')
    tx.objectStore('reports').put({ id: 'report_xyz', status: 'pending', priority: 1, createdAt: '2026-11-08' })

    // Clear calendar cache
    const cleared = await clearCalendarCache()
    assert.equal(cleared, true)

    // Calendar cache is empty
    const calCheck = await getCalendarCacheEntry({ startDate: '2026-11-10', endDate: '2026-11-16' })
    assert.equal(calCheck, null)

    // Queue store still contains report_xyz intact!
    const queueTx = db.transaction('reports', 'readonly')
    const reportCheck = await new Promise((resolve) => {
      const req = queueTx.objectStore('reports').get('report_xyz')
      req.onsuccess = () => resolve(req.result)
    })
    assert.notEqual(reportCheck, null)
    assert.equal(reportCheck.id, 'report_xyz')
  })

  it('7. Rejects privileged queries (status=draft / status=archived) from public cache', async () => {
    const draftParams = {
      startDate: '2026-11-10',
      endDate: '2026-11-16',
      status: 'draft',
    }
    const archivedParams = {
      startDate: '2026-11-10',
      endDate: '2026-11-16',
      status: 'archived',
    }

    assert.equal(isCacheablePublicQuery(normalizeCalendarParams(draftParams)), false)
    assert.equal(isCacheablePublicQuery(normalizeCalendarParams(archivedParams)), false)

    const storedDraft = await setCalendarCacheEntry(draftParams, [{ id: 'draft_1', source: 'municipal_event', status: 'draft' }], {}, { visibility: 'public' })
    assert.equal(storedDraft, null, 'Privileged queries must not be stored')

    const storedArchived = await setCalendarCacheEntry(archivedParams, [{ id: 'archived_1', source: 'municipal_event', status: 'archived' }], {}, { visibility: 'public' })
    assert.equal(storedArchived, null, 'Privileged queries must not be stored')
  })
})

describe('calendarCache — Security Boundary & Admin Rejection Tests', () => {
  let mockIDB

  beforeEach(() => {
    mockIDB = createIndexedDBMock()
    globalThis.indexedDB = mockIDB
  })

  afterEach(async () => {
    await closeDB()
    delete globalThis.indexedDB
  })

  it('1. Rejects caching an Admin response even when no status filter is present', async () => {
    const params = {
      startDate: '2026-11-10',
      endDate: '2026-11-16',
    }
    const entries = [
      { id: 'ev_pub', title: 'Clean Up', source: 'municipal_event', status: 'published' },
    ]

    // Admin role caller
    const adminResult = await setCalendarCacheEntry(params, entries, {}, {
      user: { role: 'admin', is_staff: true, id: 1 },
    })
    assert.equal(adminResult, null, 'Admin response must never enter public cache')

    // is_staff caller
    const staffResult = await setCalendarCacheEntry(params, entries, {}, {
      user: { role: 'staff_member', is_staff: true, id: 2 },
    })
    assert.equal(staffResult, null, 'Staff response must never enter public cache')

    // Verify nothing was written to IndexedDB
    const check = await getCalendarCacheEntry(params)
    assert.equal(check, null, 'No entry should have been written to cache')
  })

  it('2. Deep inspection: Rejects responses containing draft or archived records even if caller claims public visibility', async () => {
    const params = {
      startDate: '2026-11-10',
      endDate: '2026-11-16',
    }

    // Response with draft municipal event
    const draftEntries = [
      { id: 'ev_pub', title: 'Clean Up', source: 'municipal_event', status: 'published' },
      { id: 'ev_draft', title: 'Internal Draft', source: 'municipal_event', status: 'draft' },
    ]
    const draftWrite = await setCalendarCacheEntry(params, draftEntries, {}, { visibility: 'public' })
    assert.equal(draftWrite, null, 'Payload with draft event must be rejected')

    // Response with archived municipal event
    const archivedEntries = [
      { id: 'ev_archived', title: 'Old Event', source: 'municipal_event', status: 'archived' },
    ]
    const archivedWrite = await setCalendarCacheEntry(params, archivedEntries, {}, { visibility: 'public' })
    assert.equal(archivedWrite, null, 'Payload with archived event must be rejected')

    // Response with unpublished news item
    const unpublishedNews = [
      { id: 'news_1', title: 'Draft News', source: 'news_item', metadata: { is_published: false } },
    ]
    const newsWrite = await setCalendarCacheEntry(params, unpublishedNews, {}, { visibility: 'public' })
    assert.equal(newsWrite, null, 'Payload with unpublished news item must be rejected')

    // Response with inactive emergency alert
    const inactiveAlert = [
      { id: 'alert_1', title: 'Expired Alert', source: 'emergency_alert', metadata: { is_active: false } },
    ]
    const alertWrite = await setCalendarCacheEntry(params, inactiveAlert, {}, { visibility: 'public' })
    assert.equal(alertWrite, null, 'Payload with inactive emergency alert must be rejected')

    // Response with cancelled collection schedule
    const cancelledSchedule = [
      { id: 'sched_1', title: 'Cancelled Route', source: 'collection_schedule', status: 'CANCELLED' },
    ]
    const schedWrite = await setCalendarCacheEntry(params, cancelledSchedule, {}, { visibility: 'public' })
    assert.equal(schedWrite, null, 'Payload with cancelled collection schedule must be rejected')
  })

  it('3. Fail-closed: Rejects write when caller visibility context is missing or unverified', async () => {
    const params = { startDate: '2026-11-10', endDate: '2026-11-16' }
    const validEntries = [
      { id: 'ev_1', title: 'Clean Up', source: 'municipal_event', status: 'published' },
    ]

    // Empty options (no visibility or user provided)
    const emptyOptionsWrite = await setCalendarCacheEntry(params, validEntries, {}, {})
    assert.equal(emptyOptionsWrite, null, 'Unverified context must fail closed')

    // Non-object / undefined user context
    const invalidUserWrite = await setCalendarCacheEntry(params, validEntries, {}, { user: 'not_an_object' })
    assert.equal(invalidUserWrite, null, 'Malformed user context must fail closed')

    // Context check direct unit assertions
    assert.equal(verifyPublicVisibilityContext({}).isPublic, false)
    assert.equal(verifyPublicVisibilityContext({ user: { role: 'admin' } }).isPublic, false)
    assert.equal(verifyPublicVisibilityContext({ user: { is_staff: true } }).isPublic, false)
    assert.equal(verifyPublicVisibilityContext({ user: { role: 'citizen', is_staff: true } }).isPublic, false)
    assert.equal(verifyPublicVisibilityContext({ user: { role: 'dumpsite_operator' } }).isPublic, false)
    assert.equal(verifyPublicVisibilityContext({ user: { role: 'dumpsite' } }).isPublic, true)
    assert.equal(verifyPublicVisibilityContext({ user: { loading: true } }).isPublic, false)
    assert.equal(verifyPublicVisibilityContext({ user: null }).isPublic, true)
    assert.equal(verifyPublicVisibilityContext({ visibility: 'public' }).isPublic, true)
    assert.equal(verifyPublicVisibilityContext({ isPublicCaller: true }).isPublic, true)
  })

  it('4. Positively established public caller responses are safely accepted', async () => {
    const params = { startDate: '2026-11-10', endDate: '2026-11-16' }
    const validEntries = [
      { id: 'ev_1', title: 'Clean Up', source: 'municipal_event', status: 'published' },
      { id: 'ev_2', title: 'Cancelled Event', source: 'municipal_event', status: 'cancelled' },
      { id: 'ev_3', title: 'Completed Event', source: 'municipal_event', status: 'completed' },
    ]

    // Anonymous visitor (user: null)
    const anonWrite = await setCalendarCacheEntry(params, validEntries, {}, { user: null })
    assert.notEqual(anonWrite, null, 'Anonymous visitor response must be accepted')

    // Citizen user
    const citizenWrite = await setCalendarCacheEntry(params, validEntries, {}, { user: { role: 'citizen', id: 10 } })
    assert.notEqual(citizenWrite, null, 'Citizen user response must be accepted')

    // Operational roles with public-only calendar visibility
    const watcherWrite = await setCalendarCacheEntry(params, validEntries, {}, { user: { role: 'watcher', id: 11 } })
    assert.notEqual(watcherWrite, null, 'Watcher user response must be accepted')

    const driverWrite = await setCalendarCacheEntry(params, validEntries, {}, { user: { role: 'driver', id: 12 } })
    assert.notEqual(driverWrite, null, 'Driver user response must be accepted')

    const dumpsiteWrite = await setCalendarCacheEntry(params, validEntries, {}, { user: { role: 'dumpsite', id: 13 } })
    assert.notEqual(dumpsiteWrite, null, 'Dumpsite operator response must be accepted')

    const brgyWrite = await setCalendarCacheEntry(params, validEntries, {}, { user: { role: 'brgy_official', id: 14 } })
    assert.notEqual(brgyWrite, null, 'Barangay official public calendar response must be accepted')

    // Explicit public visibility flag
    const explicitWrite = await setCalendarCacheEntry(params, validEntries, {}, { visibility: 'public' })
    assert.notEqual(explicitWrite, null, 'Explicit public visibility response must be accepted')
  })

  it('4b. Non-canonical dumpsite_operator and unknown roles are rejected by public cache', async () => {
    const params = { startDate: '2026-11-10', endDate: '2026-11-16' }
    const validEntries = [
      { id: 'ev_1', title: 'Clean Up', source: 'municipal_event', status: 'published' },
    ]

    const legacyDumpsiteWrite = await setCalendarCacheEntry(params, validEntries, {}, { user: { role: 'dumpsite_operator', id: 13 } })
    assert.equal(legacyDumpsiteWrite, null, 'Non-canonical dumpsite_operator role must be rejected')

    const unknownRoleWrite = await setCalendarCacheEntry(params, validEntries, {}, { user: { role: 'supervisor', id: 15 } })
    assert.equal(unknownRoleWrite, null, 'Unknown supervisor role must be rejected')

    const staffCitizenWrite = await setCalendarCacheEntry(params, validEntries, {}, { user: { role: 'citizen', is_staff: true, id: 16 } })
    assert.equal(staffCitizenWrite, null, 'Citizen with is_staff must be rejected')
  })

  it('5. Public entries remain accessible to public callers via getCalendarCacheEntry', async () => {
    const params = { startDate: '2026-11-10', endDate: '2026-11-16', barangayId: 1 }
    const validEntries = [
      { id: 'ev_pub_1', title: 'City-wide Cleanup', source: 'municipal_event', status: 'published' },
    ]

    await setCalendarCacheEntry(params, validEntries, { count: 1 }, { visibility: 'public' })

    const read = await getCalendarCacheEntry(params)
    assert.notEqual(read, null)
    assert.equal(read.entries.length, 1)
    assert.equal(read.entries[0].title, 'City-wide Cleanup')
    assert.equal(read.isFresh, true)
  })

  it('6. Integrity: A rejected privileged write attempt does NOT overwrite an existing valid public cache record', async () => {
    const params = { startDate: '2026-11-10', endDate: '2026-11-16' }
    const initialPublicEntries = [
      { id: 'ev_legit', title: 'Original Public Event', source: 'municipal_event', status: 'published' },
    ]

    // 1. Establish valid public cache entry
    const initialWrite = await setCalendarCacheEntry(params, initialPublicEntries, { count: 1 }, { visibility: 'public' })
    assert.notEqual(initialWrite, null)

    // 2. An Admin user makes a query for the same date window and gets privileged records
    const privilegedEntries = [
      { id: 'ev_legit', title: 'Original Public Event', source: 'municipal_event', status: 'published' },
      { id: 'ev_secret', title: 'Admin Draft Only', source: 'municipal_event', status: 'draft' },
    ]

    // Admin attempt with role
    const adminAttempt = await setCalendarCacheEntry(params, privilegedEntries, {}, {
      user: { role: 'admin' },
    })
    assert.equal(adminAttempt, null, 'Admin attempt must return null')

    // Spoofed attempt with draft payload but claiming public visibility
    const spoofedAttempt = await setCalendarCacheEntry(params, privilegedEntries, {}, {
      visibility: 'public',
    })
    assert.equal(spoofedAttempt, null, 'Draft payload attempt must return null')

    // 3. Verify original public cache entry remains completely intact and uncorrupted!
    const cachedRecord = await getCalendarCacheEntry(params)
    assert.notEqual(cachedRecord, null)
    assert.equal(cachedRecord.entries.length, 1)
    assert.equal(cachedRecord.entries[0].id, 'ev_legit')
    assert.equal(cachedRecord.entries[0].title, 'Original Public Event')
  })
})
