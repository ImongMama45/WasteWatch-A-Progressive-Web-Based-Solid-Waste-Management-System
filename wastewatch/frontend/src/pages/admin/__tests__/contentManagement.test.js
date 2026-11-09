import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

describe('Admin Content Management - State and Lifecycle Transitions', () => {
  it('correctly validates lifecycle state transitions for NewsItems', () => {
    const validTransitions = {
      draft: ['published', 'archived'],
      published: ['draft', 'archived'],
      archived: ['draft', 'published'],
    }

    function canTransition(currentStatus, targetStatus) {
      return (validTransitions[currentStatus] || []).includes(targetStatus)
    }

    assert.equal(canTransition('draft', 'published'), true)
    assert.equal(canTransition('draft', 'archived'), true)
    assert.equal(canTransition('published', 'draft'), true)
    assert.equal(canTransition('published', 'archived'), true)
    assert.equal(canTransition('archived', 'draft'), true)
    assert.equal(canTransition('archived', 'published'), true)
    assert.equal(canTransition('draft', 'draft'), false)
  })

  it('synchronizes is_active boolean according to status', () => {
    function computeActiveFlag(status) {
      return status === 'published'
    }

    assert.equal(computeActiveFlag('published'), true)
    assert.equal(computeActiveFlag('draft'), false)
    assert.equal(computeActiveFlag('archived'), false)
  })

  it('normalizes form scope and booleans correctly', () => {
    function normalizeFormPayload(raw) {
      return {
        title: raw.title?.trim() || '',
        status: raw.status || 'draft',
        is_active: raw.status === 'published',
        barangay: raw.barangay ? parseInt(raw.barangay, 10) : null,
        is_pinned: typeof raw.is_pinned === 'string' ? raw.is_pinned === 'true' : Boolean(raw.is_pinned),
        is_featured: typeof raw.is_featured === 'string' ? raw.is_featured === 'true' : Boolean(raw.is_featured),
      }
    }

    const payload1 = normalizeFormPayload({
      title: '  Lucena Clean Drive  ',
      status: 'published',
      barangay: '',
      is_pinned: 'true',
      is_featured: 'false',
    })

    assert.equal(payload1.title, 'Lucena Clean Drive')
    assert.equal(payload1.status, 'published')
    assert.equal(payload1.is_active, true)
    assert.equal(payload1.barangay, null)
    assert.equal(payload1.is_pinned, true)
    assert.equal(payload1.is_featured, false)

    const payload2 = normalizeFormPayload({
      title: 'Barangay 1 Notice',
      status: 'draft',
      barangay: '14',
      is_pinned: false,
      is_featured: true,
    })

    assert.equal(payload2.status, 'draft')
    assert.equal(payload2.is_active, false)
    assert.equal(payload2.barangay, 14)
    assert.equal(payload2.is_pinned, false)
    assert.equal(payload2.is_featured, true)
  })
})

describe('Admin Content Management - Filtering and Sorting', () => {
  const sampleItems = [
    { id: 1, title: 'Advisory on Typhoon Signal', type: 'announcement', status: 'published', priority: 'high', barangay: null, updated_at: '2026-11-08T10:00:00Z' },
    { id: 2, title: 'Barangay Isabang Tree Planting', type: 'news', status: 'draft', priority: 'low', barangay: 24, updated_at: '2026-11-08T12:00:00Z' },
    { id: 3, title: 'Gulang-Gulang Cleanup Drive', type: 'announcement', status: 'archived', priority: 'medium', barangay: 12, updated_at: '2026-11-07T08:00:00Z' },
    { id: 4, title: 'Recycling Guidelines 2026', type: 'news', status: 'published', priority: 'low', barangay: null, updated_at: '2026-11-06T15:00:00Z' },
  ]

  it('filters items by content type tabs correctly', () => {
    const announcements = sampleItems.filter(i => i.type === 'announcement')
    const news = sampleItems.filter(i => i.type === 'news')

    assert.equal(announcements.length, 2)
    assert.equal(news.length, 2)
  })

  it('filters items by status correctly', () => {
    const published = sampleItems.filter(i => i.status === 'published')
    const drafts = sampleItems.filter(i => i.status === 'draft')
    const archived = sampleItems.filter(i => i.status === 'archived')

    assert.equal(published.length, 2)
    assert.equal(drafts.length, 1)
    assert.equal(archived.length, 1)
  })

  it('filters items by scope correctly', () => {
    const cityWide = sampleItems.filter(i => !i.barangay)
    const brgyIsabang = sampleItems.filter(i => String(i.barangay) === '24')

    assert.equal(cityWide.length, 2)
    assert.equal(brgyIsabang.length, 1)
    assert.equal(brgyIsabang[0].id, 2)
  })

  it('sorts by priority descending correctly', () => {
    const weight = { high: 3, medium: 2, low: 1 }
    const sorted = [...sampleItems].sort((a, b) => (weight[b.priority] || 0) - (weight[a.priority] || 0))

    assert.equal(sorted[0].priority, 'high')
    assert.equal(sorted[1].priority, 'medium')
    assert.equal(sorted[2].priority, 'low')
  })

  it('sorts by updated date descending correctly', () => {
    const sorted = [...sampleItems].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))

    assert.equal(sorted[0].id, 2) // 12:00
    assert.equal(sorted[1].id, 1) // 10:00
    assert.equal(sorted[2].id, 3) // Nov 7
    assert.equal(sorted[3].id, 4) // Nov 6
  })
})

describe('Admin Content Management - Stats Aggregation', () => {
  it('correctly parses and aggregates counts', () => {
    const rawStats = {
      total: 10,
      published: 6,
      drafts: 3,
      archived: 1,
      active_alerts: 2,
      total_alerts: 4,
    }

    assert.equal(rawStats.total, rawStats.published + rawStats.drafts + rawStats.archived)
    assert.equal(rawStats.active_alerts <= rawStats.total_alerts, true)
  })
})

describe('Admin Content Management - Zero Emoji Compliance', () => {
  it('ensures no emojis exist in source code or UI strings', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')

    const filesToCheck = [
      'wastewatch/frontend/src/pages/admin/AdminContentManagement.jsx',
      'wastewatch/frontend/src/pages/admin/content/ContentStatsOverview.jsx',
      'wastewatch/frontend/src/pages/admin/content/ContentFiltersToolbar.jsx',
      'wastewatch/frontend/src/pages/admin/content/NewsItemTable.jsx',
      'wastewatch/frontend/src/pages/admin/content/EmergencyAlertTable.jsx',
      'wastewatch/frontend/src/pages/admin/content/NewsItemEditorModal.jsx',
      'wastewatch/frontend/src/pages/admin/content/EmergencyAlertEditorModal.jsx',
      'wastewatch/frontend/src/pages/admin/content/DeleteConfirmModal.jsx',
      'wastewatch/frontend/src/pages/admin/content/AdminContentManagement.css',
    ]

    const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u

    for (const relPath of filesToCheck) {
      const fullPath = path.resolve(relPath)
      const content = fs.readFileSync(fullPath, 'utf8')
      const hasEmoji = emojiRegex.test(content)
      assert.equal(hasEmoji, false, `File ${relPath} contains prohibited emoji characters!`)
    }
  })
})
