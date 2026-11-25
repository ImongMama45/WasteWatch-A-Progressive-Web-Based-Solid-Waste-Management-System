/**
 * routeBaseHelpers.js
 * Pure operational route, Assigned Dumpsite base/return, closed-loop optimization,
 * readiness validation, and GPS arrival accuracy helpers.
 */

export const BASE_ARRIVAL_RADIUS_M = 150
export const MAX_ARRIVAL_GPS_ACCURACY_M = 50
export const LUCENA_DEFAULT_VIEW_CENTER = Object.freeze([13.9373, 121.617])

export function isValidCoord(lat, lng) {
  if (lat == null || lng == null || lat === '' || lng === '') return false
  const nLat = Number(lat)
  const nLng = Number(lng)
  return (
    Number.isFinite(nLat) &&
    Number.isFinite(nLng) &&
    nLat >= -90 &&
    nLat <= 90 &&
    nLng >= -180 &&
    nLng <= 180
  )
}

export function haversineMeters(lat1, lng1, lat2, lng2) {
  if (!isValidCoord(lat1, lng1) || !isValidCoord(lat2, lng2)) return null
  const R = 6371000
  const toRad = (deg) => (deg * Math.PI) / 180
  const dLat = toRad(Number(lat2) - Number(lat1))
  const dLng = toRad(Number(lng2) - Number(lng1))
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(Number(lat1))) *
      Math.cos(toRad(Number(lat2))) *
      Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/**
 * Validates GPS arrival against the Assigned Dumpsite geofence and strict accuracy threshold.
 * Rejects missing/null GPS accuracy in all non-mock checks.
 */
export function validateGpsArrival({
  gpsPos,
  gpsAccuracy,
  target,
  isMock = false,
  radiusM = BASE_ARRIVAL_RADIUS_M,
  maxAccuracyM = MAX_ARRIVAL_GPS_ACCURACY_M,
}) {
  if (!target || !isValidCoord(target.lat ?? target.latitude, target.lng ?? target.longitude)) {
    return {
      valid: false,
      withinRadius: false,
      accuracyOk: false,
      distanceM: null,
      reason: 'missing_target',
    }
  }
  if (!gpsPos || !isValidCoord(gpsPos.lat, gpsPos.lng)) {
    return {
      valid: false,
      withinRadius: false,
      accuracyOk: false,
      distanceM: null,
      reason: 'missing_gps',
    }
  }

  const targetLat = Number(target.lat ?? target.latitude)
  const targetLng = Number(target.lng ?? target.longitude)
  const distanceM = haversineMeters(gpsPos.lat, gpsPos.lng, targetLat, targetLng)
  const withinRadius = distanceM != null && distanceM <= radiusM

  const numericAccuracy =
    gpsAccuracy != null && gpsAccuracy !== '' ? Number(gpsAccuracy) : null
  const accuracyOk = isMock
    ? true
    : numericAccuracy != null && Number.isFinite(numericAccuracy) && numericAccuracy <= maxAccuracyM

  let reason = null
  if (!accuracyOk) reason = 'poor_gps_accuracy'
  else if (!withinRadius) reason = 'outside_geofence'

  return {
    valid: Boolean(withinRadius && accuracyOk),
    withinRadius,
    accuracyOk,
    distanceM,
    reason,
  }
}

export function dumpsiteToOriginPoint(dumpsite) {
  if (!dumpsite) return null
  const lat = dumpsite.lat ?? dumpsite.latitude
  const lng = dumpsite.lng ?? dumpsite.longitude
  if (!isValidCoord(lat, lng)) return null
  return {
    type: 'dumpsite',
    dumpsite_id: dumpsite.id ?? dumpsite.dumpsite_id ?? null,
    label: dumpsite.label || dumpsite.name || 'Assigned Dumpsite',
    lat: Number(lat),
    lng: Number(lng),
  }
}

/**
 * Resolves the authoritative Assigned Dumpsite origin for a schedule.
 * Returns null if the schedule has no assigned dumpsite (never falls back to City Hall / Home Base).
 */
export function resolveScheduleDumpsiteOrigin(schedule) {
  if (!schedule || typeof schedule !== 'object') return null

  if (schedule.origin && isValidCoord(schedule.origin.lat, schedule.origin.lng)) {
    return {
      type: 'dumpsite',
      dumpsite_id: schedule.origin.dumpsite_id ?? schedule.dumpsite ?? null,
      label: schedule.origin.label || schedule.dumpsite_name || 'Assigned Dumpsite',
      lat: Number(schedule.origin.lat),
      lng: Number(schedule.origin.lng),
    }
  }

  if (schedule.dumpsite_detail) {
    const pt = dumpsiteToOriginPoint(schedule.dumpsite_detail)
    if (pt) return pt
  }

  if (schedule.dumpsite && typeof schedule.dumpsite === 'object') {
    const pt = dumpsiteToOriginPoint(schedule.dumpsite)
    if (pt) return pt
  }

  return null
}

/**
 * Resolves the authoritative return destination for a schedule (always the same Assigned Dumpsite).
 */
export function resolveScheduleReturnDestination(schedule) {
  if (!schedule || typeof schedule !== 'object') return null
  if (
    schedule.return_destination &&
    isValidCoord(schedule.return_destination.lat, schedule.return_destination.lng)
  ) {
    return {
      type: 'dumpsite',
      dumpsite_id: schedule.return_destination.dumpsite_id ?? schedule.dumpsite ?? null,
      label:
        schedule.return_destination.label ||
        schedule.dumpsite_name ||
        'Assigned Dumpsite',
      lat: Number(schedule.return_destination.lat),
      lng: Number(schedule.return_destination.lng),
    }
  }
  return resolveScheduleDumpsiteOrigin(schedule)
}

/**
 * Extracts ordered collection stops (1..N) excluding the index-0 origin base.
 */
export function resolveScheduleStops(schedule) {
  if (!schedule || typeof schedule !== 'object') return []

  if (Array.isArray(schedule.stops) && schedule.stops.length > 0) {
    return schedule.stops
      .filter((s) => s && isValidCoord(s.lat, s.lng))
      .map((s, idx) => ({
        ...s,
        stop_order: s.stop_order ?? idx + 1,
        lat: Number(s.lat),
        lng: Number(s.lng),
      }))
  }

  const wps = Array.isArray(schedule.waypoints) ? schedule.waypoints : []
  if (wps.length <= 1) return []
  return wps
    .slice(1)
    .filter((s) => s && isValidCoord(s.lat, s.lng))
    .map((s, idx) => ({
      ...s,
      stop_order: s.stop_order ?? idx + 1,
      lat: Number(s.lat),
      lng: Number(s.lng),
    }))
}

/**
 * Builds the canonical waypoints JSON ([origin_dumpsite, ...stops]) and closed-loop
 * coordinate sequence ([origin_dumpsite, ...stops, origin_dumpsite]) for rendering/ORS.
 */
export function buildClosedLoopWaypoints({ dumpsite, stops = [] }) {
  const origin = dumpsiteToOriginPoint(dumpsite)
  const validStops = (Array.isArray(stops) ? stops : [])
    .filter((s) => s && isValidCoord(s.lat, s.lng))
    .map((s, i) => ({
      ...s,
      stop_order: i + 1,
      lat: Number(s.lat),
      lng: Number(s.lng),
    }))

  if (!origin) {
    return {
      origin: null,
      stops: validStops,
      waypoints: validStops,
      closedLoopPoints: validStops,
    }
  }

  return {
    origin,
    stops: validStops,
    waypoints: [origin, ...validStops],
    closedLoopPoints: validStops.length > 0 ? [origin, ...validStops, origin] : [origin],
  }
}

/**
 * Deterministic signature of (dumpsite, ordered stops) used to invalidate stale geometry
 * whenever Admin changes the assigned dumpsite or modifies/reorders stops.
 */
export function computeRouteInputSignature({ dumpsite, stops = [] }) {
  const origin = dumpsiteToOriginPoint(dumpsite)
  const dsKey = origin
    ? `${origin.dumpsite_id ?? ''}:${origin.lat.toFixed(6)},${origin.lng.toFixed(6)}`
    : 'none'
  const stopsKey = (Array.isArray(stops) ? stops : [])
    .filter((s) => s && isValidCoord(s.lat, s.lng))
    .map((s) => `${s.stop_id ?? ''}:${Number(s.lat).toFixed(6)},${Number(s.lng).toFixed(6)}`)
    .join('|')
  return `${dsKey}>>${stopsKey}`
}

/**
 * Closed-loop route optimizer: starts at `origin` (Assigned Dumpsite), visits all stops,
 * and returns to `origin` (same Assigned Dumpsite).
 * Uses nearest-neighbor seeding followed by 2-opt closed-loop improvement.
 */
export function optimizeStopsClosedLoop(origin, stops = []) {
  const list = Array.isArray(stops) ? [...stops] : []
  if (list.length <= 1 || !origin || !isValidCoord(origin.lat, origin.lng)) {
    return list
  }

  const dist = (a, b) => {
    const d = haversineMeters(a.lat, a.lng, b.lat, b.lng)
    return d != null ? d : Math.hypot(Number(a.lat) - Number(b.lat), Number(a.lng) - Number(b.lng))
  }

  // Nearest-neighbor initial tour from origin
  const remaining = [...list]
  const ordered = []
  let current = { lat: Number(origin.lat), lng: Number(origin.lng) }
  while (remaining.length > 0) {
    let bestIdx = 0
    let bestDist = Infinity
    for (let i = 0; i < remaining.length; i += 1) {
      const d = dist(current, remaining[i])
      if (d < bestDist) {
        bestDist = d
        bestIdx = i
      }
    }
    const chosen = remaining.splice(bestIdx, 1)[0]
    ordered.push(chosen)
    current = chosen
  }

  // 2-opt closed-loop refinement: loop is [origin, ...ordered, origin]
  if (ordered.length >= 3) {
    let improved = true
    let passes = 0
    while (improved && passes < 20) {
      improved = false
      passes += 1
      for (let i = 0; i < ordered.length - 1; i += 1) {
        for (let j = i + 1; j < ordered.length; j += 1) {
          const prevA = i === 0 ? origin : ordered[i - 1]
          const nodeA = ordered[i]
          const nodeB = ordered[j]
          const nextB = j === ordered.length - 1 ? origin : ordered[j + 1]

          const currentCost = dist(prevA, nodeA) + dist(nodeB, nextB)
          const swappedCost = dist(prevA, nodeB) + dist(nodeA, nextB)
          if (swappedCost + 0.01 < currentCost) {
            const slice = ordered.slice(i, j + 1).reverse()
            ordered.splice(i, j - i + 1, ...slice)
            improved = true
          }
        }
      }
    }
  }

  return ordered
}

export function validateScheduleReadinessForSave({
  truck,
  driver,
  selectedBarangays = [],
  days = [],
  startTime,
  endTime,
  dumpsite,
  stops = [],
}) {
  const errors = []
  if (!truck) errors.push('missing_truck')
  if (!driver) errors.push('missing_driver')
  if (!Array.isArray(selectedBarangays) || selectedBarangays.length === 0) errors.push('missing_barangays')
  if (!Array.isArray(days) || days.length === 0) errors.push('missing_days')
  if (!startTime || !endTime || startTime >= endTime) errors.push('invalid_time_window')
  if (!dumpsite) errors.push('missing_dumpsite')
  if (!Array.isArray(stops) || stops.length < 1) errors.push('missing_stops')
  return {
    isValid: errors.length === 0,
    errors,
  }
}

export function formatReadinessErrorLabel(code) {
  switch (code) {
    case 'missing_dumpsite':
      return 'No assigned dumpsite configured for this schedule.'
    case 'missing_stops':
      return 'At least one collection stop must be configured.'
    case 'stale_route_geometry':
      return 'Route geometry is out of date and needs recalculation.'
    case 'invalid_route':
      return 'Route configuration is invalid.'
    case 'truck_on_hold':
    case 'operational_hold':
      return 'Assigned truck is currently on operational hold.'
    case 'truck_retired':
      return 'Assigned truck has been retired.'
    case 'truck_unavailable':
      return 'Assigned truck is unavailable.'
    default:
      return String(code || 'Schedule is not operationally ready.')
  }
}
