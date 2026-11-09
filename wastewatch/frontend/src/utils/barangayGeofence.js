/**
 * utils/barangayGeofence.js
 * -------------------------
 * Client-side coordinate geofencing against Lucena City barangay boundaries
 * (`/data/lucena_barangays.geojson` — the same GeoJSON rendered in MapView.jsx).
 *
 * Ensures every waste report is geo-tagged to the Barangay its (lat, lng)
 * coordinates physically fall inside — regardless of whether the reporter is
 * anonymous or has a different home Barangay set on their profile.
 */

const GEOJSON_URL = '/data/lucena_barangays.geojson'
const EDGE_TOLERANCE_DEG = 0.00045 // ~50m shoreline / boundary edge tolerance

let cachedGeoJson = null
let cachedPreparedFeatures = null
let inflightPromise = null

export function pointInRing(x, y, ring) {
  const n = ring?.length || 0
  if (n < 3) return false
  let inside = false
  let p1x = ring[0][0]
  let p1y = ring[0][1]

  for (let i = 1; i <= n; i++) {
    const p2 = ring[i % n]
    const p2x = p2[0]
    const p2y = p2[1]
    if (y > Math.min(p1y, p2y)) {
      if (y <= Math.max(p1y, p2y)) {
        if (x <= Math.max(p1x, p2x)) {
          let xinters = null
          if (p1y !== p2y) {
            xinters = ((y - p1y) * (p2x - p1x)) / (p2y - p1y) + p1x
          }
          if (p1x === p2x || (xinters !== null && x <= xinters)) {
            inside = !inside
          }
        }
      }
    }
    p1x = p2x
    p1y = p2y
  }
  return inside
}

function pointInPolygonCoords(x, y, polyCoords) {
  if (!polyCoords || polyCoords.length === 0) return false
  if (!pointInRing(x, y, polyCoords[0])) return false
  for (let i = 1; i < polyCoords.length; i++) {
    if (pointInRing(x, y, polyCoords[i])) return false
  }
  return true
}

function minDistSqToRing(x, y, ring) {
  let minD2 = Infinity
  const n = ring?.length || 0
  for (let i = 0; i < n; i++) {
    const ax = ring[i][0]
    const ay = ring[i][1]
    const bx = ring[(i + 1) % n][0]
    const by = ring[(i + 1) % n][1]
    const dx = bx - ax
    const dy = by - ay
    let d2
    if (dx === 0 && dy === 0) {
      d2 = (x - ax) ** 2 + (y - ay) ** 2
    } else {
      let t = ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)
      t = Math.max(0, Math.min(1, t))
      const px = ax + t * dx
      const py = ay + t * dy
      d2 = (x - px) ** 2 + (y - py) ** 2
    }
    if (d2 < minD2) minD2 = d2
  }
  return minD2
}

function prepareFeatures(geoJson) {
  if (!geoJson?.features) return []
  const prepared = []
  for (const feature of geoJson.features) {
    const props = feature.properties || {}
    const barangayName = (props.brgy_name || props.name || '').trim()
    const brgyCode = props.brgy_code || null
    const geom = feature.geometry || {}
    if (!barangayName || !geom.coordinates) continue

    const polygons =
      geom.type === 'Polygon'
        ? [geom.coordinates]
        : geom.type === 'MultiPolygon'
          ? geom.coordinates
          : null
    if (!polygons) continue

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const poly of polygons) {
      const outer = poly?.[0] || []
      for (const pt of outer) {
        if (pt[0] < minX) minX = pt[0]
        if (pt[0] > maxX) maxX = pt[0]
        if (pt[1] < minY) minY = pt[1]
        if (pt[1] > maxY) maxY = pt[1]
      }
    }

    prepared.push({
      barangayName,
      brgyCode,
      polygons,
      bbox: [minX, minY, maxX, maxY],
      feature,
    })
  }
  return prepared
}

/**
 * Loads `/data/lucena_barangays.geojson` once and caches it in memory.
 */
export async function loadBarangayGeoJson() {
  if (cachedGeoJson) return cachedGeoJson
  if (inflightPromise) return inflightPromise

  inflightPromise = fetch(GEOJSON_URL)
    .then((r) => {
      if (!r.ok) throw new Error(`Failed to fetch ${GEOJSON_URL}: ${r.status}`)
      return r.json()
    })
    .then((data) => {
      cachedGeoJson = data
      cachedPreparedFeatures = prepareFeatures(data)
      return data
    })
    .catch((err) => {
      console.warn('[barangayGeofence] Could not load GeoJSON:', err)
      return null
    })
    .finally(() => {
      inflightPromise = null
    })

  return inflightPromise
}

/**
 * Synchronous point-in-polygon lookup against an already-loaded GeoJSON object
 * (or the cached GeoJSON if already loaded).
 *
 * Returns `{ barangayName, brgyCode, feature }` or `null` if outside Lucena City.
 */
export function detectBarangayFromCoords(lat, lng, geoJson = cachedGeoJson) {
  if (lat == null || lng == null) return null
  const y = Number(lat)
  const x = Number(lng)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null

  const features =
    geoJson && geoJson === cachedGeoJson && cachedPreparedFeatures
      ? cachedPreparedFeatures
      : prepareFeatures(geoJson)

  if (!features.length) return null

  // 1. Exact point-in-polygon check
  for (const item of features) {
    const [minX, minY, maxX, maxY] = item.bbox
    if (x < minX || x > maxX || y < minY || y > maxY) continue
    for (const poly of item.polygons) {
      if (pointInPolygonCoords(x, y, poly)) {
        return {
          barangayName: item.barangayName,
          brgyCode: item.brgyCode,
          feature: item.feature,
        }
      }
    }
  }

  // 2. Boundary tolerance (~50m) for shoreline / border GPS drift
  const tolSq = EDGE_TOLERANCE_DEG * EDGE_TOLERANCE_DEG
  let best = null
  let bestD2 = tolSq
  for (const item of features) {
    const [minX, minY, maxX, maxY] = item.bbox
    if (
      x < minX - EDGE_TOLERANCE_DEG ||
      x > maxX + EDGE_TOLERANCE_DEG ||
      y < minY - EDGE_TOLERANCE_DEG ||
      y > maxY + EDGE_TOLERANCE_DEG
    ) {
      continue
    }
    for (const poly of item.polygons) {
      if (!poly?.[0]) continue
      const d2 = minDistSqToRing(x, y, poly[0])
      if (d2 <= bestD2) {
        bestD2 = d2
        best = item
      }
    }
  }

  return best
    ? {
        barangayName: best.barangayName,
        brgyCode: best.brgyCode,
        feature: best.feature,
      }
    : null
}

/**
 * Async convenience helper: ensures GeoJSON is loaded, then detects the barangay.
 */
export async function detectBarangayAsync(lat, lng) {
  const geo = cachedGeoJson || (await loadBarangayGeoJson())
  if (!geo) return null
  return detectBarangayFromCoords(lat, lng, geo)
}
