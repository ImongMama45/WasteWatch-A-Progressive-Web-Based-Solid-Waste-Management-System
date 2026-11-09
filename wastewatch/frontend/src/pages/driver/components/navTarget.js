/**
 * navTarget.js - Pure active navigation target resolver for WasteWatch.
 *
 * Implements deterministic target selection for driver navigation:
 * - Priority: activeMissedStop takes precedence over regular scheduled stops.
 * - Binding Owner Decision A1: If the current scheduled stop is non-routable,
 *   do NOT look ahead or route to a later stop. Report isRoutable: false while
 *   retaining the current stop identity for fallback display and legacy cache keys.
 * - Pure function: no React state mutation or network calls.
 */

import { isRoutableStopStatus, normalizeStopStatus } from '../../../utils/pickupStatusSync.js'

/**
 * Validates that latitude and longitude are finite numbers within valid geographic ranges.
 * @param {*} lat
 * @param {*} lng
 * @returns {boolean}
 */
export function isValidCoordinate(lat, lng) {
  if (lat == null || lng == null || lat === '' || lng === '') return false
  const numLat = Number(lat)
  const numLng = Number(lng)
  return (
    Number.isFinite(numLat) &&
    Number.isFinite(numLng) &&
    numLat >= -90 &&
    numLat <= 90 &&
    numLng >= -180 &&
    numLng <= 180
  )
}

/**
 * Formats a legacy ORS cache key matching existing ShiftRouteModule conventions: "${lat},${lng}".
 * @param {number|string} lat
 * @param {number|string} lng
 * @returns {string|null}
 */
export function makeLegacyCacheKey(lat, lng) {
  if (!isValidCoordinate(lat, lng)) return null
  return `${lat},${lng}`
}

/**
 * Extracts a normalized stop status from a Map or plain object.
 * @param {Map|object|null|undefined} stopStatuses
 * @param {number} stopIndex
 * @returns {string}
 */
export function getResolvedStopStatus(stopStatuses, stopIndex) {
  if (!stopStatuses) return 'PENDING_INSPECTION'
  let raw = null
  if (typeof stopStatuses.get === 'function') {
    raw = stopStatuses.get(stopIndex)
  } else if (typeof stopStatuses === 'object') {
    raw = stopStatuses[stopIndex]
  }
  return raw ? normalizeStopStatus(raw) : 'PENDING_INSPECTION'
}

/**
 * Dynamic routing: picks the nearest routable (uncollected) stop to the given GPS
 * position by great-circle distance. Falls back to the lowest routable index when
 * GPS is unavailable. Returns null when no routable stop remains.
 */
export function pickNearestRoutableIndex({ waypoints = [], stopStatuses = null, gps = null, excludeIndex = null } = {}) {
  const wps = Array.isArray(waypoints) ? waypoints : []
  let best = null
  let bestDist = Infinity
  for (let i = 1; i < wps.length; i += 1) {
    if (i === excludeIndex) continue
    const wp = wps[i]
    if (!wp || !isValidCoordinate(wp.lat, wp.lng)) continue
    if (!isRoutableStopStatus(getResolvedStopStatus(stopStatuses, i))) continue
    if (!gps || !isValidCoordinate(gps.lat, gps.lng)) return i
    const R = 6371000
    const toRad = (d) => (d * Math.PI) / 180
    const dLat = toRad(Number(wp.lat) - Number(gps.lat))
    const dLng = toRad(Number(wp.lng) - Number(gps.lng))
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(Number(gps.lat))) * Math.cos(toRad(Number(wp.lat))) * Math.sin(dLng / 2) ** 2
    const d = 2 * R * Math.asin(Math.sqrt(a))
    if (d < bestDist) { bestDist = d; best = i }
  }
  return best
}

/**
 * Resolves the single authoritative navigation target for the active leg.
 *
 * @param {object} params
 * @param {Array<object>} [params.waypoints=[]] - Full schedule waypoints (index 0 = depot/base)
 * @param {number} [params.currentStopIndex=1] - Current active stop index
 * @param {Map<number, string>|object} [params.stopStatuses] - Map of stopIndex -> status string
 * @param {object|null} [params.activeMissedStop=null] - Currently active missed stop record
 * @returns {object} Resolved target metadata:
 *   - targetWp: { lat, lng, label, ... } | null
 *   - targetKey: legacy cache key string ("${lat},${lng}") | null
 *   - targetId: unique target identity string ("missed:ID" or "stop:INDEX") | null
 *   - stopIndex: numeric index in waypoints or null if missed stop
 *   - isMissedStop: boolean
 *   - isRoutable: boolean (true if ORS route can be requested; false otherwise)
 *   - hasValidCoords: boolean
 *   - coords: [lng, lat] for ORS GeoJSON requests | null
 *   - isEndOfRoute: boolean (true if all scheduled stops have been visited or index exceeds bounds)
 */
export function resolveActiveNavTarget({
  waypoints = [],
  currentStopIndex = 1,
  stopStatuses = null,
  activeMissedStop = null,
} = {}) {
  // 1. High-Priority Branch: Active Missed Stop (Extended Mode / Floating Stop)
  if (activeMissedStop && typeof activeMissedStop === 'object') {
    const rawLat = activeMissedStop.lat
    const rawLng = activeMissedStop.lng
    const hasValidCoords = isValidCoordinate(rawLat, rawLng)
    const lat = hasValidCoords ? Number(rawLat) : null
    const lng = hasValidCoords ? Number(rawLng) : null

    // Unique identity using missed stop ID (or fallback to stop_order / coords)
    const rawId = activeMissedStop.id ?? activeMissedStop.missed_stop_id ?? activeMissedStop.stop_order
    const targetId = rawId != null ? `missed:${rawId}` : (hasValidCoords ? `missed:${rawLat},${rawLng}` : null)
    const targetKey = hasValidCoords ? makeLegacyCacheKey(rawLat, rawLng) : null

    return {
      targetWp: activeMissedStop,
      targetKey,
      targetId,
      stopIndex: null,
      isMissedStop: true,
      // A missed stop is considered routable if its coordinates are valid and not marked collected
      isRoutable: hasValidCoords && activeMissedStop.status !== 'COLLECTED' && activeMissedStop.status !== 'RESOLVED',
      hasValidCoords,
      coords: hasValidCoords ? [lng, lat] : null,
      isEndOfRoute: false,
    }
  }

  // 2. Normal Scheduled Stop Branch
  const wps = Array.isArray(waypoints) ? waypoints : []
  const totalWaypoints = wps.length

    // Boundary check: Index bounds [0 .. totalWaypoints - 1]
    if (totalWaypoints === 0 || currentStopIndex < 0 || currentStopIndex >= totalWaypoints) {
      return {
        targetWp: null,
        targetKey: null,
        targetId: null,
        stopIndex: currentStopIndex,
        isMissedStop: false,
        isRoutable: false,
        hasValidCoords: false,
        coords: null,
        isEndOfRoute: true,
      }
    }

    const effectiveIndex = currentStopIndex
    const targetWp = wps[effectiveIndex] || null

    if (!targetWp) {
      return {
        targetWp: null,
        targetKey: null,
        targetId: null,
        stopIndex: effectiveIndex,
        isMissedStop: false,
        isRoutable: false,
        hasValidCoords: false,
        coords: null,
        isEndOfRoute: effectiveIndex >= totalWaypoints,
      }
    }

    const rawLat = targetWp.lat
    const rawLng = targetWp.lng
    const hasValidCoords = isValidCoordinate(rawLat, rawLng)
    const lat = hasValidCoords ? Number(rawLat) : null
    const lng = hasValidCoords ? Number(rawLng) : null

    const targetKey = hasValidCoords ? makeLegacyCacheKey(rawLat, rawLng) : null
    const stopUniqueId = targetWp.id ?? targetWp.stop_order ?? `${rawLat},${rawLng}`
    const targetId = `stop:${effectiveIndex}:${stopUniqueId}`

    // Check routability of the current stop
    const status = getResolvedStopStatus(stopStatuses, effectiveIndex)
    const isRoutableStatus = isRoutableStopStatus(status)

    // Owner Decision A1: If current stop is non-routable, DO NOT route to a subsequent stop.
    // Report isRoutable = false while preserving target identity and targetKey.
    const isRoutable = hasValidCoords && isRoutableStatus

    return {
      targetWp,
      targetKey,
      targetId,
      stopIndex: effectiveIndex,
      isMissedStop: false,
      isRoutable,
      hasValidCoords,
      coords: hasValidCoords ? [lng, lat] : null,
      isEndOfRoute: false,
    }
  }
