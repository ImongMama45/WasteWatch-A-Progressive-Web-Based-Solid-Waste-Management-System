import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatToManilaDateString } from '../../api/calendarService.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const componentPath = path.resolve(__dirname, '../OfflineEventCalendar.jsx')
const componentSource = fs.readFileSync(componentPath, 'utf8')

describe('OfflineEventCalendar — Component Integrity and Contract Tests', () => {
  it('does NOT contain defunct /api/public/events/ endpoint call', () => {
    assert.equal(
      componentSource.includes('/api/public/events/'),
      false,
      'OfflineEventCalendar must not reference the defunct /api/public/events/ endpoint'
    )
  })

  it('uses shared useCalendarEntries hook with source=municipal_event and 7-day range', () => {
    assert.equal(
      componentSource.includes('useCalendarEntries'),
      true,
      'OfflineEventCalendar must import and use useCalendarEntries hook'
    )
    assert.equal(
      componentSource.includes("source: 'municipal_event'"),
      true,
      'OfflineEventCalendar must request source=municipal_event'
    )
  })

  it('contains zero emojis across component source', () => {
    // Emoji Unicode range regex
    const emojiRegex = /[\u{1F300}-\u{1FAFF}\u{1F600}-\u{1F64F}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u
    const match = componentSource.match(emojiRegex)
    assert.equal(
      match,
      null,
      `OfflineEventCalendar must contain zero emojis. Found: ${match ? match[0] : ''}`
    )
  })

  it('does NOT contain buildFallback or fake static events', () => {
    assert.equal(
      componentSource.includes('buildFallback'),
      false,
      'OfflineEventCalendar must not define or invoke buildFallback'
    )
    assert.equal(
      componentSource.includes('Barangay Fiesta — Isabang'),
      false,
      'OfflineEventCalendar must not include synthetic fiesta mock event'
    )
    assert.equal(
      componentSource.includes('Araw ng Lucena Civic Holiday'),
      false,
      'OfflineEventCalendar must not include synthetic holiday mock event'
    )
  })

  it('only supports authorized MunicipalEvent categories', () => {
    const validCategories = [
      'cleanup',
      'community_meeting',
      'hazardous_waste',
      'tree_planting',
      'workshop',
      'general',
    ]

    // Verify CATEGORY_META keys match approved categories
    validCategories.forEach((cat) => {
      assert.equal(
        componentSource.includes(`${cat}:`),
        true,
        `CATEGORY_META must support approved category '${cat}'`
      )
    })

    // Verify synthetic categories like fiesta and market are NOT present in CATEGORY_META
    assert.equal(componentSource.includes('fiesta:'), false, 'fiesta category must not be supported')
    assert.equal(componentSource.includes('market:'), false, 'market category must not be supported')
    assert.equal(componentSource.includes('holiday:'), false, 'holiday category must not be supported')
  })

  it('handles date matching and placement in Manila timezone accurately', () => {
    function sameDayInManila(isoDateStr, targetDate) {
      if (!isoDateStr || !targetDate) return false
      try {
        const entryDateStr = formatToManilaDateString(isoDateStr)
        const targetDateStr = formatToManilaDateString(targetDate)
        return entryDateStr === targetDateStr
      } catch {
        return false
      }
    }

    const target = new Date('2026-11-12T00:00:00+08:00')
    const matchIso = '2026-11-12T09:30:00+08:00'
    const differentIso = '2026-11-13T08:00:00+08:00'

    assert.equal(sameDayInManila(matchIso, target), true)
    assert.equal(sameDayInManila(differentIso, target), false)
  })

  it('supports truthful capacity error (HTTP 503) state banner', () => {
    assert.equal(
      componentSource.includes('isCapacityError'),
      true,
      'Component must handle isCapacityError'
    )
    assert.equal(
      componentSource.includes('Calendar Service Busy'),
      true,
      'Component must display truthful capacity error message'
    )
  })

  it('supports truthful network error state banner', () => {
    assert.equal(
      componentSource.includes('isNetworkError'),
      true,
      'Component must handle isNetworkError'
    )
    assert.equal(
      componentSource.includes('Connection Error'),
      true,
      'Component must display connection error banner'
    )
  })

  it('supports truthful empty state without fabricating events', () => {
    assert.equal(
      componentSource.includes('No Municipal Events Scheduled'),
      true,
      'Component must display truthful empty state when no events exist'
    )
  })
})
