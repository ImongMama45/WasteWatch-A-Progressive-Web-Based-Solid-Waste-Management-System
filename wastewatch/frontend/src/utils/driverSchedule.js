/**
 * driverSchedule.js
 * -----------------
 * Shared utilities for unwrapping paginated/unpaginated schedule responses,
 * resolving a driver's active or today-applicable collection schedule,
 * and evaluating schedule day & off-schedule ("Start Late") timing.
 */

const DAY_PREFIXES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

/**
 * Safely extract an array from either an unpaginated array response
 * or a DRF paginated `{ count, results: [...] }` payload.
 */
export function extractArray(data) {
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.results)) return data.results
  return []
}

/**
 * Parse a time string ("HH:MM:SS", "HH:MM", or "H:MM AM/PM") into minutes since midnight.
 * Returns null if unparseable.
 */
export function parseTimeToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null
  const trimmed = timeStr.trim()
  if (!trimmed || trimmed === '—' || trimmed === 'N/A') return null

  const ampmMatch = trimmed.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i)
  if (ampmMatch) {
    let hours = parseInt(ampmMatch[1], 10)
    const minutes = parseInt(ampmMatch[2], 10)
    const meridiem = ampmMatch[3].toUpperCase()
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return null
    if (meridiem === 'PM' && hours < 12) hours += 12
    if (meridiem === 'AM' && hours === 12) hours = 0
    return hours * 60 + minutes
  }

  const parts = trimmed.split(':')
  if (parts.length < 2) return null
  const hours = parseInt(parts[0], 10)
  const minutes = parseInt(parts[1], 10)
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null
  return hours * 60 + minutes
}

/**
 * Format a "HH:MM[:SS]" string into 12-hour "H:MM AM/PM" display format.
 */
export function formatTime12h(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return ''
  const trimmed = timeStr.trim()
  if (!trimmed || trimmed === '—') return ''
  if (/AM|PM/i.test(trimmed)) return trimmed

  const mins = parseTimeToMinutes(trimmed)
  if (mins == null) return trimmed
  const h24 = Math.floor(mins / 60) % 24
  const m = mins % 60
  const ampm = h24 >= 12 ? 'PM' : 'AM'
  const h12 = h24 % 12 || 12
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

/**
 * Format a schedule's days field into a clean comma-separated string.
 */
export function formatScheduleDays(days) {
  if (!days) return '—'
  if (Array.isArray(days)) return days.filter(Boolean).join(', ') || '—'
  return String(days).trim() || '—'
}

/**
 * Return local YYYY-MM-DD string for a Date instance.
 */
export function toLocalDateString(dateObj = new Date()) {
  const yyyy = dateObj.getFullYear()
  const mm = String(dateObj.getMonth() + 1).padStart(2, '0')
  const dd = String(dateObj.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/**
 * Determine whether a CollectionSchedule is scheduled for the given local date.
 */
export function isScheduleForDate(schedule, dateObj = new Date()) {
  if (!schedule || schedule.status === 'CANCELLED') return false

  if (schedule.date) {
    return String(schedule.date).slice(0, 10) === toLocalDateString(dateObj)
  }

  let rawDays = []
  if (Array.isArray(schedule.days)) {
    rawDays = schedule.days
  } else if (typeof schedule.days === 'string') {
    rawDays = schedule.days.split(',')
  }

  const normalizedDays = rawDays
    .map(d => String(d || '').trim().slice(0, 3).toLowerCase())
    .filter(Boolean)

  if (normalizedDays.length === 0) return false

  const todayPrefix = DAY_PREFIXES[dateObj.getDay()]
  return normalizedDays.includes(todayPrefix)
}

/**
 * Resolve the authoritative schedule for a driver:
 * 1. If `activeScheduleId` is provided (from an active shift), match that schedule first.
 * 2. Otherwise prefer a schedule assigned to `userId` that is scheduled for `now`
 *    (preferring unfinished in-window -> upcoming -> earliest today).
 * 3. Fall back to the driver's first assigned schedule (so UI can still display
 *    assigned route details & scheduled days when off-duty today).
 */
export function resolveDriverSchedule(schedulesData, userId, activeScheduleId = null, now = new Date()) {
  const list = extractArray(schedulesData)
  if (!userId) return null

  if (activeScheduleId != null) {
    const activeMatch = list.find(s => s && String(s.id) === String(activeScheduleId))
    if (activeMatch) return activeMatch
  }

  const driverSchedules = list.filter(
    s => s && String(s.driver) === String(userId) && s.status !== 'CANCELLED'
  )
  if (driverSchedules.length === 0) return null

  const todaysSchedules = driverSchedules.filter(s => isScheduleForDate(s, now))
  if (todaysSchedules.length === 0) {
    return driverSchedules[0]
  }

  if (todaysSchedules.length === 1) {
    return todaysSchedules[0]
  }

  const nowMins = now.getHours() * 60 + now.getMinutes()
  const unfinished = todaysSchedules.filter(
    s => s.truck_status !== 'completed' && s.truck_status !== 'returning_unfinished'
  )
  const pool = unfinished.length > 0 ? unfinished : todaysSchedules

  const inWindow = pool.find(s => {
    const start = parseTimeToMinutes(s.start_time)
    const end = parseTimeToMinutes(s.end_time)
    return start != null && end != null && nowMins >= start && nowMins <= end
  })
  if (inWindow) return inWindow

  const upcoming = pool
    .filter(s => {
      const start = parseTimeToMinutes(s.start_time)
      return start != null && start > nowMins
    })
    .sort((a, b) => parseTimeToMinutes(a.start_time) - parseTimeToMinutes(b.start_time))
  if (upcoming.length > 0) return upcoming[0]

  return pool[0]
}

/**
 * Evaluate whether a driver is on-schedule, late, or early for today's scheduled shift,
 * and produce standardized display strings for CTA buttons and status banners.
 */
export function evaluateScheduleShiftTiming(schedule, now = new Date()) {
  const hasScheduleToday = isScheduleForDate(schedule, now)
  const startMins = parseTimeToMinutes(schedule?.start_time)
  const endMins = parseTimeToMinutes(schedule?.end_time)
  const nowMins = now.getHours() * 60 + now.getMinutes()

  const formattedStart = formatTime12h(schedule?.start_time)
  const formattedEnd = formatTime12h(schedule?.end_time)
  const formattedWindow = formattedStart && formattedEnd
    ? `${formattedStart} – ${formattedEnd}`
    : formattedStart

  if (!hasScheduleToday || startMins == null) {
    return {
      hasScheduleToday,
      isLate: false,
      isPastEnd: false,
      isEarlyOffSchedule: false,
      isOffSchedule: false,
      minutesDelta: 0,
      formattedStart,
      formattedEnd,
      formattedWindow,
      ctaLabel: 'Start Duty',
      statusPanelCtaLabel: "Start Today's Shift",
      compactCtaLabel: 'Start Route',
    }
  }

  const minutesDelta = nowMins - startMins
  const isLate = nowMins > startMins
  const isPastEnd = endMins != null && nowMins > endMins
  const isEarlyOffSchedule = nowMins < startMins - 30
  const isOffSchedule = isLate || isEarlyOffSchedule

  const timeRef = formattedStart || 'scheduled time'

  let ctaLabel = 'Start Duty'
  let statusPanelCtaLabel = "Start Today's Shift"
  let compactCtaLabel = 'Start Route'

  if (isLate) {
    ctaLabel = `Start Late — You are scheduled for ${timeRef}`
    statusPanelCtaLabel = `Start Late — You are scheduled for ${timeRef}`
    compactCtaLabel = `Start Late (${timeRef})`
  } else if (isEarlyOffSchedule) {
    ctaLabel = `Start Early — You are scheduled for ${timeRef}`
    statusPanelCtaLabel = `Start Early — You are scheduled for ${timeRef}`
    compactCtaLabel = `Start Early (${timeRef})`
  }

  return {
    hasScheduleToday,
    isLate,
    isPastEnd,
    isEarlyOffSchedule,
    isOffSchedule,
    minutesDelta,
    formattedStart,
    formattedEnd,
    formattedWindow,
    ctaLabel,
    statusPanelCtaLabel,
    compactCtaLabel,
  }
}
