/**
 * driverSchedule.test.js
 * ----------------------
 * Regression tests for Round 5B.2 B4-03: resolveDriverSchedule must accept
 * backend-scoped team, override, and allocation schedules even when s.driver
 * is null or belongs to another legacy driver.
 *
 * Run with:
 *   node --test src/utils/__tests__/driverSchedule.test.js
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  extractArray,
  isScheduleForDate,
  resolveDriverSchedule,
} from '../driverSchedule.js'

test('Round 5B.2 B4-03 — resolveDriverSchedule supports team/override/allocation schedules', async (t) => {
  const fixedNow = new Date('2026-11-19T08:30:00') // Thursday

  await t.test('1. Resolves team/allocation schedule when s.driver is null', () => {
    const schedules = [
      {
        id: 101,
        driver: null,
        default_team: 5,
        status: 'PENDING',
        days: ['Thursday'],
        start_time: '08:00:00',
        end_time: '12:00:00',
      },
    ]

    const match = resolveDriverSchedule(schedules, 42, null, fixedNow)
    assert.equal(match?.id, 101)
  })

  await t.test('2. Resolves override/allocation schedule when s.driver differs from userId', () => {
    const schedules = {
      count: 1,
      results: [
        {
          id: 202,
          driver: 999,
          status: 'PENDING',
          date: '2026-11-19',
          start_time: '07:00:00',
          end_time: '11:00:00',
        },
      ],
    }

    assert.equal(extractArray(schedules).length, 1)
    const match = resolveDriverSchedule(schedules, 42, null, fixedNow)
    assert.equal(match?.id, 202)
  })

  await t.test('3. Excludes CANCELLED schedules and prioritizes activeScheduleId', () => {
    const schedules = [
      {
        id: 301,
        driver: null,
        status: 'CANCELLED',
        days: ['Thursday'],
        start_time: '08:00:00',
        end_time: '12:00:00',
      },
      {
        id: 302,
        driver: null,
        status: 'PENDING',
        days: ['Thursday'],
        start_time: '08:00:00',
        end_time: '12:00:00',
      },
      {
        id: 303,
        driver: null,
        status: 'PENDING',
        days: ['Monday'],
        start_time: '08:00:00',
        end_time: '12:00:00',
      },
    ]

    const todayMatch = resolveDriverSchedule(schedules, 42, null, fixedNow)
    assert.equal(todayMatch?.id, 302)

    const activeOverride = resolveDriverSchedule(schedules, 42, 303, fixedNow)
    assert.equal(activeOverride?.id, 303)
  })

  await t.test('4. Prefers unfinished in-window schedule over upcoming or completed ones', () => {
    const schedules = [
      {
        id: 401,
        driver: null,
        status: 'PENDING',
        truck_status: 'completed',
        days: ['Thursday'],
        start_time: '08:00:00',
        end_time: '10:00:00',
      },
      {
        id: 402,
        driver: null,
        status: 'PENDING',
        truck_status: 'off_duty',
        days: ['Thursday'],
        start_time: '13:00:00',
        end_time: '16:00:00',
      },
      {
        id: 403,
        driver: null,
        status: 'PENDING',
        truck_status: 'off_duty',
        days: ['Thursday'],
        start_time: '08:00:00',
        end_time: '12:00:00',
      },
    ]

    const match = resolveDriverSchedule(schedules, 42, null, fixedNow)
    assert.equal(match?.id, 403)
    assert.equal(isScheduleForDate(schedules[0], fixedNow), true)
  })
})
