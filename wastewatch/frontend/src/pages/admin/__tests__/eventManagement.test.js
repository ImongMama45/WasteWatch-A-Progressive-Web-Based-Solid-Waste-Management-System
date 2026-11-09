import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

describe('Admin Event Management — Lifecycle Transitions', () => {
  const VALID_EVENT_TRANSITIONS = {
    draft: ['published', 'archived'],
    published: ['cancelled', 'completed', 'archived', 'draft'],
    cancelled: ['archived', 'draft'],
    completed: ['archived'],
    archived: ['draft'],
  }

  function canTransition(currentStatus, targetStatus) {
    if (currentStatus === targetStatus) return false
    return (VALID_EVENT_TRANSITIONS[currentStatus] || []).includes(targetStatus)
  }

  it('permits valid lifecycle transitions', () => {
    assert.equal(canTransition('draft', 'published'), true)
    assert.equal(canTransition('draft', 'archived'), true)
    assert.equal(canTransition('published', 'cancelled'), true)
    assert.equal(canTransition('published', 'completed'), true)
    assert.equal(canTransition('published', 'archived'), true)
    assert.equal(canTransition('published', 'draft'), true) // unpublish
    assert.equal(canTransition('cancelled', 'archived'), true)
    assert.equal(canTransition('cancelled', 'draft'), true) // restore
    assert.equal(canTransition('completed', 'archived'), true)
    assert.equal(canTransition('archived', 'draft'), true) // restore
  })

  it('rejects invalid lifecycle jumps', () => {
    assert.equal(canTransition('completed', 'published'), false)
    assert.equal(canTransition('completed', 'draft'), false)
    assert.equal(canTransition('cancelled', 'completed'), false)
    assert.equal(canTransition('cancelled', 'published'), false)
    assert.equal(canTransition('archived', 'published'), false)
    assert.equal(canTransition('draft', 'completed'), false)
    assert.equal(canTransition('draft', 'cancelled'), false)
  })
})

describe('Admin Event Management — Scope and Date Validation', () => {
  function validateEventForm({ title, description, startDatetime, endDatetime, location, scopeMode, selectedBarangays }) {
    const errors = {}
    if (!title?.trim()) errors.title = 'Title is required'
    if (!description?.trim()) errors.description = 'Description is required'
    if (!location?.trim()) errors.location = 'Location is required'
    if (!startDatetime) errors.startDatetime = 'Start time is required'
    if (!endDatetime) errors.endDatetime = 'End time is required'

    if (startDatetime && endDatetime) {
      const s = new Date(startDatetime)
      const e = new Date(endDatetime)
      if (e <= s) {
        errors.endDatetime = 'End date/time must be strictly after the start date/time.'
      }
    }

    if (scopeMode === 'specific' && (!selectedBarangays || selectedBarangays.length === 0)) {
      errors.barangays = 'Please select at least one barangay or choose Citywide.'
    }

    return {
      isValid: Object.keys(errors).length === 0,
      errors,
    }
  }

  it('validates inverted or identical event datetimes', () => {
    const inverted = validateEventForm({
      title: 'Cleanup Drive',
      description: 'Event details',
      location: 'Perez Park',
      startDatetime: '2026-11-15T10:00',
      endDatetime: '2026-11-15T09:00',
      scopeMode: 'citywide',
    })
    assert.equal(inverted.isValid, false)
    assert.match(inverted.errors.endDatetime, /strictly after/i)

    const identical = validateEventForm({
      title: 'Cleanup Drive',
      description: 'Event details',
      location: 'Perez Park',
      startDatetime: '2026-11-15T10:00',
      endDatetime: '2026-11-15T10:00',
      scopeMode: 'citywide',
    })
    assert.equal(identical.isValid, false)
    assert.match(identical.errors.endDatetime, /strictly after/i)

    const valid = validateEventForm({
      title: 'Cleanup Drive',
      description: 'Event details',
      location: 'Perez Park',
      startDatetime: '2026-11-15T08:00',
      endDatetime: '2026-11-15T11:00',
      scopeMode: 'citywide',
    })
    assert.equal(valid.isValid, true)
  })

  it('correctly handles citywide vs barangay-specific scope', () => {
    function normalizeEventPayload({ title, description, startDatetime, endDatetime, location, scopeMode, selectedBarangays, category }) {
      return {
        title: title.trim(),
        description: description.trim(),
        location: location.trim(),
        start_datetime: new Date(startDatetime).toISOString(),
        end_datetime: new Date(endDatetime).toISOString(),
        category,
        barangays: scopeMode === 'citywide' ? [] : selectedBarangays,
        is_citywide: scopeMode === 'citywide' || !selectedBarangays || selectedBarangays.length === 0,
      }
    }

    const citywidePayload = normalizeEventPayload({
      title: 'City River Cleanup',
      description: 'Annual river campaign',
      location: 'Iyam River',
      startDatetime: '2026-11-20T08:00',
      endDatetime: '2026-11-20T12:00',
      category: 'cleanup',
      scopeMode: 'citywide',
      selectedBarangays: [],
    })
    assert.deepEqual(citywidePayload.barangays, [])
    assert.equal(citywidePayload.is_citywide, true)

    const scopedPayload = normalizeEventPayload({
      title: 'Isabang Orientation',
      description: 'Barangay solid waste meeting',
      location: 'Isabang Hall',
      startDatetime: '2026-11-22T09:00',
      endDatetime: '2026-11-22T11:00',
      category: 'community_meeting',
      scopeMode: 'specific',
      selectedBarangays: [24, 12],
    })
    assert.deepEqual(scopedPayload.barangays, [24, 12])
    assert.equal(scopedPayload.is_citywide, false)
  })

  it('rejects recycling category and accepts approved municipal categories', () => {
    const APPROVED_CATEGORIES = [
      'cleanup',
      'community_meeting',
      'hazardous_waste',
      'tree_planting',
      'workshop',
      'general',
    ]

    function isCategoryApproved(cat) {
      return APPROVED_CATEGORIES.includes(cat)
    }

    assert.equal(isCategoryApproved('cleanup'), true)
    assert.equal(isCategoryApproved('community_meeting'), true)
    assert.equal(isCategoryApproved('hazardous_waste'), true)
    assert.equal(isCategoryApproved('tree_planting'), true)
    assert.equal(isCategoryApproved('workshop'), true)
    assert.equal(isCategoryApproved('general'), true)
    assert.equal(isCategoryApproved('recycling'), false)
  })
})

describe('Admin Event Management — Filtering & Searching', () => {
  const sampleEvents = [
    { id: 1, title: 'Coastal Cleanup', category: 'cleanup', status: 'published', barangays: [], location: 'Dalahican Port', start_datetime: '2026-11-20T08:00:00Z' },
    { id: 2, title: 'Hazardous Waste Drop-off', category: 'hazardous_waste', status: 'draft', barangays: [24], location: 'Isabang Court', start_datetime: '2026-11-22T09:00:00Z' },
    { id: 3, title: 'Barangay Orientation', category: 'community_meeting', status: 'cancelled', barangays: [12], location: 'Gulang-Gulang Hall', start_datetime: '2026-11-25T14:00:00Z' },
    { id: 4, title: 'River Cleanup Assembly', category: 'cleanup', status: 'completed', barangays: [], location: 'Iyam River', start_datetime: '2026-11-01T08:00:00Z' },
    { id: 5, title: 'Archived Tree Planting', category: 'tree_planting', status: 'archived', barangays: [], location: 'Eco Park', start_datetime: '2025-06-15T08:00:00Z' },
  ]

  it('filters events by status correctly', () => {
    assert.equal(sampleEvents.filter(e => e.status === 'published').length, 1)
    assert.equal(sampleEvents.filter(e => e.status === 'draft').length, 1)
    assert.equal(sampleEvents.filter(e => e.status === 'cancelled').length, 1)
    assert.equal(sampleEvents.filter(e => e.status === 'completed').length, 1)
    assert.equal(sampleEvents.filter(e => e.status === 'archived').length, 1)
  })

  it('filters events by category correctly', () => {
    const cleanups = sampleEvents.filter(e => e.category === 'cleanup')
    assert.equal(cleanups.length, 2)
  })

  it('filters events by scope correctly', () => {
    const citywide = sampleEvents.filter(e => !e.barangays || e.barangays.length === 0)
    assert.equal(citywide.length, 3)

    const isabangOnly = sampleEvents.filter(e => (e.barangays || []).includes(24))
    assert.equal(isabangOnly.length, 1)
    assert.equal(isabangOnly[0].id, 2)
  })

  it('searches events by keyword in title and location', () => {
    function searchEvents(query) {
      const q = query.toLowerCase()
      return sampleEvents.filter(e =>
        e.title.toLowerCase().includes(q) || e.location.toLowerCase().includes(q)
      )
    }

    assert.equal(searchEvents('cleanup').length, 2)
    assert.equal(searchEvents('isabang').length, 1)
    assert.equal(searchEvents('river').length, 1)
    assert.equal(searchEvents('port').length, 1)
    assert.equal(searchEvents('nonexistent').length, 0)
  })
})

describe('Admin Event Management — Zero Emoji Compliance', () => {
  it('ensures zero emojis exist across all Event Management source files', () => {
    const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u
    const eventsDir = path.resolve(__dirname, '../events')

    const files = fs.readdirSync(eventsDir).filter(f => f.endsWith('.jsx') || f.endsWith('.css'))
    assert.ok(files.length >= 6, `Expected at least 6 files in ${eventsDir}, found ${files.length}`)

    for (const file of files) {
      const content = fs.readFileSync(path.join(eventsDir, file), 'utf8')
      const match = content.match(emojiRegex)
      assert.equal(
        match,
        null,
        `Found emoji '${match?.[0]}' in ${file}. Rules strictly prohibit emojis.`
      )
    }
  })
})
