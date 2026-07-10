const SYNC_EVENT_NAME = 'ww:pickup-status-sync'
const SYNC_STORAGE_KEY = 'ww_pickup_status_sync'

export const STOP_VALIDATION_STATUSES = [
  'PENDING_INSPECTION',
  'READY_FOR_COLLECTION',
  'EMPTY_STOP',
  'COLLECTION_REPORTED',
  'VERIFIED_COLLECTED',
  'COLLECTION_DISPUTED',
  'DRIVER_MISSED',
]

const ALLOWED_STATUSES = new Set(STOP_VALIDATION_STATUSES)

export const STOP_STATUS_COLORS = {
  PENDING_INSPECTION: { bg: 'transparent', border: 'rgba(148,163,184,0.9)', shadow: 'none', label: '#94a3b8' },
  READY_FOR_COLLECTION: { bg: '#f59e0b', border: '#fff', shadow: 'rgba(245,158,11,0.4)', label: '#fff' },
  EMPTY_STOP: { bg: '#94a3b8', border: '#fff', shadow: 'rgba(148,163,184,0.4)', label: '#fff' },
  COLLECTION_REPORTED: { bg: '#eab308', border: '#fff', shadow: 'rgba(234,179,8,0.45)', label: '#fff' },
  VERIFIED_COLLECTED: { bg: '#16a34a', border: '#fff', shadow: 'rgba(22,163,74,0.5)', label: '#fff' },
  COLLECTION_DISPUTED: { bg: '#ef4444', border: '#fff', shadow: 'rgba(239,68,68,0.5)', label: '#fff' },
  DRIVER_MISSED: { bg: '#ef4444', border: '#fff', shadow: 'rgba(239,68,68,0.5)', label: '#fff' },
}

export const STOP_STATUS_LABELS = {
  PENDING_INSPECTION: 'Pending Inspection',
  READY_FOR_COLLECTION: 'Ready for Collection',
  EMPTY_STOP: 'Empty Stop',
  COLLECTION_REPORTED: 'Collection Reported',
  VERIFIED_COLLECTED: 'Verified Collected',
  // NOTE: DB constant kept as COLLECTION_DISPUTED to avoid migrations.
  // Only the display label is changed to 'Missed'. See backend/watcher/models.py.
  COLLECTION_DISPUTED: 'Missed',
  DRIVER_MISSED: 'Driver Missed',
}

export const normalizeStopStatus = (status) => {
  if (status == null || status === '') return 'PENDING_INSPECTION'
  const upper = String(status).trim().toUpperCase()
  if (ALLOWED_STATUSES.has(upper)) return upper

  const legacy = String(status).trim().toLowerCase()
  if (legacy === 'none') return 'PENDING_INSPECTION'
  if (legacy === 'upcoming') return 'READY_FOR_COLLECTION'
  if (legacy === 'collected') return 'VERIFIED_COLLECTED'
  if (legacy === 'missed') return 'COLLECTION_DISPUTED'
  if (legacy === 'pending') return 'COLLECTION_REPORTED'
  if (legacy === 'current') return 'READY_FOR_COLLECTION'

  return 'PENDING_INSPECTION'
}

export const resolveStopVisualStatus = (stop, fallback = 'PENDING_INSPECTION') => {
  const rawCandidates = [
    stop?.current_status,
    stop?.validation_status,
    stop?.status,
    stop?.watcher_status,
  ]

  for (const raw of rawCandidates) {
    if (raw == null || raw === '') continue
    const normalized = normalizeStopStatus(raw)
    if (ALLOWED_STATUSES.has(normalized)) return normalized
  }

  return normalizeStopStatus(fallback)
}

export const isRoutableStopStatus = (status) => {
  const norm = normalizeStopStatus(status)
  return norm === 'READY_FOR_COLLECTION'
}

// COLLECTION_REPORTED is included because the driver has submitted proof.
// If a watcher later disputes it → COLLECTION_DISPUTED, which is also
// in this set, so there is no double-count risk on the progress bar.
export const COMPLETED_STOP_STATUSES = new Set([
  'VERIFIED_COLLECTED',
  'EMPTY_STOP',
  'COLLECTION_REPORTED',
  'COLLECTION_DISPUTED',
])

export const isCompletedStopStatus = (status) =>
  COMPLETED_STOP_STATUSES.has(normalizeStopStatus(status))

export const MISSED_STOP_STATUSES = new Set([
  'PENDING_INSPECTION',
  'READY_FOR_COLLECTION',
])

export const isMissedStopStatus = (status) =>
  MISSED_STOP_STATUSES.has(normalizeStopStatus(status))

/** Shared stop marker HTML — used by MapView and ShiftRouteModule */
export function buildStopMarkerHtml(stopNumber, status, details = null, isActive = false) {
  const safeStatus = normalizeStopStatus(status)
  const c = STOP_STATUS_COLORS[safeStatus] || STOP_STATUS_COLORS.PENDING_INSPECTION
  const size = isActive ? 28 : 24
  const markerLabel = safeStatus === 'VERIFIED_COLLECTED' ? '✓'
    : safeStatus === 'COLLECTION_DISPUTED' ? '×'
    : safeStatus === 'COLLECTION_REPORTED' ? '?'
    : stopNumber

  const pulse = isActive ? `
    <span style="position:absolute;inset:-5px;border-radius:50%;
      border:2.5px solid ${c.bg === 'transparent' ? '#f59e0b' : c.bg};
      animation:wwPulse 1.8s ease infinite;pointer-events:none;"></span>
  ` : ''

  const glowShadow = ['VERIFIED_COLLECTED', 'COLLECTION_DISPUTED', 'COLLECTION_REPORTED'].includes(safeStatus)
    ? `0 2px 10px ${c.shadow}, 0 0 0 3px ${c.bg === 'transparent' ? 'rgba(148,163,184,0.3)' : `${c.bg}44`}`
    : `0 2px 10px ${c.shadow}`
  const fillColor = safeStatus === 'PENDING_INSPECTION' ? 'transparent' : c.bg
  const borderStyle = safeStatus === 'PENDING_INSPECTION' ? `2px dashed ${c.border}` : `2.5px solid ${c.border}`
  const textColor = safeStatus === 'PENDING_INSPECTION' ? '#94a3b8' : c.label

  return `
    <div style="position:relative;width:${size}px;height:${size}px;">
      ${pulse}
      <div style="
        position:absolute;inset:0;background:${fillColor};border:${borderStyle};
        border-radius:50%;display:flex;align-items:center;justify-content:center;
        color:${textColor};font-size:${isActive ? 12 : 10}px;font-weight:900;
        font-family:monospace;box-shadow:${glowShadow};
      ">${markerLabel}</div>
      ${details?.collectedAt ? `<div style="position:absolute;top:-6px;right:-6px;background:rgba(0,0,0,0.75);color:#fff;font-size:10px;padding:2px 6px;border-radius:10px;">${details.collectedAt}</div>` : ''}
    </div>`
}

export const validationScheduleId = (row) => {
  const schedule = row?.schedule
  if (schedule && typeof schedule === 'object') return schedule.id ?? schedule.pk
  return schedule ?? row?.schedule_id ?? row?.route_id
}

export const validationStatusKey = (row) => {
  const scheduleId = validationScheduleId(row)
  const stopOrder = Number(row?.stop_order ?? row?.stopOrder ?? row?.stop_id)
  if (scheduleId == null || Number.isNaN(stopOrder)) return null
  return `${scheduleId}:${stopOrder}`
}

export const pickupScheduleId = validationScheduleId
export const pickupStatusKey = validationStatusKey

export const buildStopValidationSnapshot = (validations = []) => {
  const statusMap = new Map()
  const detailsMap = new Map()
  let latestUpdatedAt = null

  validations.forEach((row) => {
    const scheduleId = validationScheduleId(row)
    const stopOrder = Number(row.stop_order ?? row.stopOrder ?? row.stop_id)
    if (scheduleId == null || Number.isNaN(stopOrder)) return

    const scheduleKey = String(scheduleId)
    const key = `${scheduleKey}:${stopOrder}`
    const visualStatus = resolveStopVisualStatus(row)
    statusMap.set(key, visualStatus)

    let collectedAt = ''
    try {
      const raw = row.collection_timestamp || row.collected_at
      if (raw) {
        const d = new Date(raw)
        if (!Number.isNaN(d.getTime())) {
          collectedAt = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      }
    } catch {
      collectedAt = ''
    }

    detailsMap.set(key, {
      collectedAt,
      truck: row.truck_plate || row.truck || '',
      scheduleId: scheduleKey,
      scheduledTime: row.scheduledTime || '',
      updatedAt: row.updated_at || row.updatedAt || null,
      label: row.label || '',
      currentStatus: visualStatus,
    })

    const updatedAt = row.updated_at || row.updatedAt || null
    if (updatedAt) {
      const updatedAtMs = new Date(updatedAt).getTime()
      if (!Number.isNaN(updatedAtMs)) {
        if (!latestUpdatedAt || updatedAtMs > latestUpdatedAt.getTime()) {
          latestUpdatedAt = new Date(updatedAtMs)
        }
      }
    }
  })

  return { statusMap, detailsMap, latestUpdatedAt }
}

export const buildPickupStatusSnapshot = buildStopValidationSnapshot

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
