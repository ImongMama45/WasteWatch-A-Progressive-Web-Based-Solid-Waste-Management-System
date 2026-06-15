const LUCENA_CENTER = [13.9373, 121.617]

export function normalizeBarangayName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/^barangay\s+/i, '')
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function getUserBarangayId(user) {
  return user?.barangay ?? user?.barangay_id ?? null
}

export function getUserBarangayName(user) {
  return user?.barangay_name || user?.barangayName || user?.barangay?.name || ''
}

export function isAdminRole(user) {
  const role = String(user?.role || '').toLowerCase()
  return role === 'admin' || role === 'superadmin'
}

export function matchesUserBarangay(item, user) {
  if (!item || !user || isAdminRole(user)) return true

  const userBarangayId = getUserBarangayId(user)
  const itemBarangayId = item.barangay ?? item.barangay_id ?? item.barangayId
  if (userBarangayId != null && itemBarangayId != null && String(userBarangayId) === String(itemBarangayId)) {
    return true
  }

  const userBarangay = normalizeBarangayName(getUserBarangayName(user))
  if (!userBarangay) return true

  const itemNames = [
    item.barangay_name,
    item.barangayName,
    item.barangay,
    item.address,
    item.location,
  ].filter(Boolean)

  if (item.barangay_names) {
    itemNames.push(...String(item.barangay_names).split(','))
  }

  return itemNames.some(name => normalizeBarangayName(name).includes(userBarangay))
}

export function filterBarangayItems(items, user) {
  if (!Array.isArray(items)) return []
  if (!user || isAdminRole(user)) return items
  return items.filter(item => matchesUserBarangay(item, user))
}

export function formatRouteSchedule(route) {
  const days = Array.isArray(route.days) ? route.days.join(', ') : route.days || route.day || 'Scheduled'
  const start = route.start_time?.slice?.(0, 5) || route.start || ''
  const end = route.end_time?.slice?.(0, 5) || route.end || ''
  return {
    id: route.id,
    day: days,
    zone: route.barangay_names || route.area || route.zone || route.barangay_name || 'Route',
    time: start && end ? `${start} - ${end}` : start || route.time || 'N/A',
    truck_plate: route.truck_plate,
    driver_name: route.driver_name,
    raw: route,
  }
}

function collectCoordinates(geometry) {
  const points = []
  const walk = value => {
    if (!Array.isArray(value)) return
    if (typeof value[0] === 'number' && typeof value[1] === 'number') {
      points.push([value[1], value[0]])
      return
    }
    value.forEach(walk)
  }
  walk(geometry?.coordinates)
  return points
}

export async function getBarangayCenter(barangayName) {
  const target = normalizeBarangayName(barangayName)
  if (!target) return LUCENA_CENTER

  try {
    const res = await fetch('/data/lucena_barangays.geojson')
    const geo = await res.json()
    const feature = geo?.features?.find(f => {
      const props = f.properties || {}
      return [props.brgy_name, props.barangay_name, props.name].some(name => normalizeBarangayName(name) === target)
    })
    const points = collectCoordinates(feature?.geometry)
    if (!points.length) return LUCENA_CENTER
    const sum = points.reduce((acc, [lat, lng]) => [acc[0] + lat, acc[1] + lng], [0, 0])
    return [sum[0] / points.length, sum[1] / points.length]
  } catch {
    return LUCENA_CENTER
  }
}
