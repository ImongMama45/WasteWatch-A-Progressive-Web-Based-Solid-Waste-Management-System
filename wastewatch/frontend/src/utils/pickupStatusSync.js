const SYNC_EVENT_NAME = 'ww:pickup-status-sync'
const SYNC_STORAGE_KEY = 'ww_pickup_status_sync'
const ALLOWED_STATUSES = new Set(['collected', 'current', 'upcoming', 'missed', 'pending', 'none'])

export const normalizeStopStatus = (status) =>
  ALLOWED_STATUSES.has(status) ? status : 'upcoming'

export const resolveStopVisualStatus = (stop, fallback = 'upcoming') => {
  const rawCandidates = [
    stop?.status,
    stop?.watcher_status,
    stop?.confirmation_status,
    stop?.confirmationStatus,
  ]

  const hasExplicitPendingFlag =
    stop?.confirmed_by_watcher === false ||
    stop?.watcher_confirmed === false ||
    stop?.is_confirmed === false

  if (hasExplicitPendingFlag) return 'pending'

  for (const raw of rawCandidates) {
    if (raw == null || raw === '') continue
    const status = String(raw).trim().toLowerCase()
    if (status === 'completed') return 'collected'
    if (status === 'failed') return 'missed'
    if (status === 'en_route') return 'upcoming'
    if (status === 'arrived') return 'current'
    if (ALLOWED_STATUSES.has(status)) return status
  }

  return fallback
}

export const pickupScheduleId = (pickupStatus) => {
  const schedule = pickupStatus?.schedule
  if (schedule && typeof schedule === 'object') return schedule.id ?? schedule.pk
  return schedule ?? pickupStatus?.schedule_id
}

export const pickupStatusKey = (pickupStatus) => {
  const scheduleId = pickupScheduleId(pickupStatus)
  const stopOrder = Number(pickupStatus?.stop_order ?? pickupStatus?.stopOrder)
  if (scheduleId == null || Number.isNaN(stopOrder)) return null
  return `${scheduleId}:${stopOrder}`
}

export const buildPickupStatusSnapshot = (pickupStatuses = []) => {
  const bySchedule = new Map()
  const detailsMap = new Map()
  let latestUpdatedAt = null

  pickupStatuses.forEach(ps => {
    const scheduleId = pickupScheduleId(ps)
    const stopOrder = Number(ps.stop_order ?? ps.stopOrder)
    if (scheduleId == null || Number.isNaN(stopOrder)) return

    const scheduleKey = String(scheduleId)
    const row = { ...ps, scheduleId: scheduleKey, stopOrder }

    if (!bySchedule.has(scheduleKey)) bySchedule.set(scheduleKey, [])
    bySchedule.get(scheduleKey).push(row)

    const key = `${scheduleKey}:${stopOrder}`
    let collectedAt = ''
    try {
      if (ps.collected_at) {
        const d = new Date(ps.collected_at)
        if (!Number.isNaN(d.getTime())) {
          collectedAt = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      }
    } catch {
      collectedAt = ''
    }

    detailsMap.set(key, {
      collectedAt,
      truck: ps.truck_plate || ps.truck || '',
      scheduleId: scheduleKey,
      scheduledTime: ps.scheduledTime || '',
      updatedAt: ps.updated_at || ps.updatedAt || null,
    })

    const updatedAt = ps.updated_at || ps.updatedAt || null
    if (updatedAt) {
      const updatedAtMs = new Date(updatedAt).getTime()
      if (!Number.isNaN(updatedAtMs)) {
        if (!latestUpdatedAt || updatedAtMs > latestUpdatedAt.getTime()) {
          latestUpdatedAt = new Date(updatedAtMs)
        }
      }
    }
  })

  const statusMap = new Map()
  bySchedule.forEach(rows => {
    rows.sort((a, b) => a.stopOrder - b.stopOrder)

    let foundCurrent = false
    rows.forEach(row => {
      const key = `${row.scheduleId}:${row.stopOrder}`
      const rowStatus = String(row.status || '').toUpperCase()

      if (rowStatus === 'COMPLETED') {
        statusMap.set(key, 'collected')
      } else if (rowStatus === 'FAILED') {
        statusMap.set(key, 'missed')
      } else if (!foundCurrent) {
        statusMap.set(key, 'current')
        foundCurrent = true
      } else {
        statusMap.set(key, 'upcoming')
      }
    })
  })

  return {
    statusMap,
    detailsMap,
    latestUpdatedAt,
  }
}

export const broadcastPickupStatusSync = (detail = {}) => {
  if (typeof window === 'undefined') return

  const payload = {
    ...detail,
    ts: Date.now(),
    nonce: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  }

  try {
    window.dispatchEvent(new CustomEvent(SYNC_EVENT_NAME, { detail: payload }))
  } catch {
    // Ignore custom event failures in older browsers.
  }

  try {
    window.localStorage.setItem(SYNC_STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // Ignore storage failures in private mode / locked-down browsers.
  }
}

export const subscribePickupStatusSync = (handler) => {
  if (typeof window === 'undefined') return () => {}

  const onEvent = (event) => handler(event.detail || {})
  const onStorage = (event) => {
    if (event.key !== SYNC_STORAGE_KEY || !event.newValue) return
    try {
      handler(JSON.parse(event.newValue))
    } catch {
      // Ignore malformed sync payloads.
    }
  }

  window.addEventListener(SYNC_EVENT_NAME, onEvent)
  window.addEventListener('storage', onStorage)

  return () => {
    window.removeEventListener(SYNC_EVENT_NAME, onEvent)
    window.removeEventListener('storage', onStorage)
  }
}
