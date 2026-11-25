/**
 * watcherRouteHelpers.js
 * ----------------------
 * Pure helper utilities for deployment-scoped Watcher route task views.
 */

export function normalizeAuthorizedStops(allStops) {
  if (!Array.isArray(allStops)) return []
  return allStops.map((stop) => ({
    ...stop,
    lat: stop.lat ?? stop.pre_validation_latitude ?? null,
    lng: stop.lng ?? stop.pre_validation_longitude ?? null,
  }))
}

export function getRouteCoverageLabel(stops, fallback = 'Assigned Route') {
  if (!Array.isArray(stops) || stops.length === 0) return fallback

  const seen = new Set()
  const names = []

  const pushName = (raw) => {
    const trimmed = typeof raw === 'string' ? raw.trim() : ''
    if (!trimmed) return
    const key = trimmed.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    names.push(trimmed)
  }

  for (const stop of stops) {
    if (stop?.barangay_name) {
      pushName(stop.barangay_name)
    } else if (stop?.barangay_names) {
      String(stop.barangay_names)
        .split(',')
        .forEach(pushName)
    }
  }

  if (names.length === 0) {
    for (const stop of stops) {
      if (stop?.barangay_names) {
        String(stop.barangay_names)
          .split(',')
          .forEach(pushName)
      }
    }
  }

  if (names.length === 0) return fallback
  if (names.length <= 3) return names.join(', ')
  return `${names.slice(0, 2).join(', ')} +${names.length - 2} more`
}

export function extractStopActionError(err, fallback = 'Server error. Please try again.') {
  const data = err?.response?.data
  if (typeof data === 'string' && data.trim()) return data.trim()
  if (data && typeof data === 'object') {
    if (typeof data.error === 'string' && data.error.trim()) return data.error.trim()
    if (typeof data.detail === 'string' && data.detail.trim()) return data.detail.trim()
  }
  return fallback
}
