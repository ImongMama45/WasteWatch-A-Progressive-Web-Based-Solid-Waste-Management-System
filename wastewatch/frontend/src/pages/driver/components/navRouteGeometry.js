/**
 * navRouteGeometry.js - Route geometry decoding, projection, and local progress tracking.
 *
 * Implements high-performance local route progress tracking for driver navigation:
 * - Decodes ORS GeoJSON or encoded polyline coordinates into standardized [lat, lng] points.
 * - Computes cumulative distances along the route.
 * - Filters GPS fixes using independent-fix gating (temporal and spatial separation).
 * - Projects vehicle location onto route polyline with windowed search and heading-awareness.
 * - Enforces monotonic forward progress while supporting stuck/reverse recovery.
 * - Evaluates off-route condition with dynamic accuracy-aware threshold and multi-fix confirmation.
 *
 * All parameters are declared as centralized, adjustable engineering parameters.
 */

// ── Initial Adjustable Engineering Parameters ────────────────────────────────

export const GEOMETRY_CONFIG = {
  // Off-route distance thresholds
  OFF_ROUTE_THRESHOLD_MIN_M: 35.0,
  OFF_ROUTE_THRESHOLD_MAX_M: 80.0,
  OFF_ROUTE_ACCURACY_MULTIPLIER: 1.5,
  MAX_ACCURACY_FOR_OFF_ROUTE_M: 50.0,
  UNKNOWN_ACCURACY_THRESHOLD_M: 35.0,
  DEFAULT_ACCURACY_FALLBACK_M: 35.0,

  // Independent GPS fix gating
  MIN_FIX_INTERVAL_MS: 700,
  MIN_FIX_DISPLACEMENT_M: 1.0,

  // Backward progress search window (meters behind last progress)
  BACKWARD_PROGRESS_MIN_M: 10.0,
  BACKWARD_PROGRESS_MAX_M: 50.0,
  BACKWARD_PROGRESS_DEFAULT_M: 15.0,

  // Forward progress search window (meters ahead of last progress)
  FORWARD_WINDOW_BASE_M: 150.0,
  FORWARD_WINDOW_SPEED_M_PER_S: 20.0,
  FORWARD_WINDOW_MAX_M: 450.0,

  // Heading awareness and penalties
  HEADING_MIN_SPEED_M_PER_S: 1.5,
  HEADING_PENALTY_THRESHOLD_DEG: 45.0,
  HEADING_PENALTY_SEVERE_DEG: 90.0,
  HEADING_PENALTY_M: 20.0,
  HEADING_PENALTY_SEVERE_M: 60.0,

  // Forward jump and reacquisition
  FORWARD_JUMP_THRESHOLD_M: 120.0,
  FORWARD_JUMP_CONFIRM_FIXES: 2,
  REACQUISITION_TIME_GAP_MS: 15000,
  REACQUISITION_IMPLIED_SPEED_MAX_M_PER_S: 45.0, // ~162 km/h

  // Stuck/reverse recovery: fixes behind backward window before declaring reverse/stuck
  REVERSE_RECOVERY_FIXES: 3,

  // Off-route confirmation rule
  OFF_ROUTE_CONFIRM_CONSECUTIVE_FIXES: 3,
  OFF_ROUTE_CONFIRM_TIME_MS: 4000,
  OFF_ROUTE_CONFIRM_MIN_TIME_FIXES: 2,
}

// ── Geospatial Helper Functions ──────────────────────────────────────────────

const EARTH_RADIUS_M = 6371008.8

/**
 * Standard Haversine distance in meters between two [lat, lng] coordinates.
 */
export function haversineDistance(lat1, lng1, lat2, lng2) {
  const dLat = ((lat2 - lat1) * Math.PI) / 180.0
  const dLng = ((lng2 - lng1) * Math.PI) / 180.0
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180.0) *
      Math.cos((lat2 * Math.PI) / 180.0) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2)
  return 2.0 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(a), Math.sqrt(1.0 - a))
}

/**
 * Initial compass bearing in degrees [0, 360) from point A to point B.
 */
export function calculateBearing(lat1, lng1, lat2, lng2) {
  const φ1 = (lat1 * Math.PI) / 180.0
  const φ2 = (lat2 * Math.PI) / 180.0
  const Δλ = ((lng2 - lng1) * Math.PI) / 180.0
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  const θ = Math.atan2(y, x)
  return ((θ * 180.0) / Math.PI + 360.0) % 360.0
}

/**
 * Shortest angular difference in degrees [0, 180] between two compass bearings.
 */
export function angularDifference(bearing1, bearing2) {
  const diff = Math.abs(bearing1 - bearing2) % 360.0
  return diff > 180.0 ? 360.0 - diff : diff
}

/**
 * Decodes an encoded polyline string (Google Polyline algorithm) into [[lat, lng], ...].
 */
export function decodePolyline(str, precision = 5) {
  if (!str || typeof str !== 'string') return []
  let index = 0,
    lat = 0,
    lng = 0
  const coordinates = []
  const factor = Math.pow(10, precision)

  try {
    while (index < str.length) {
      let b,
        shift = 0,
        result = 0
      do {
        if (index >= str.length) return [] // Truncated chunk
        b = str.charCodeAt(index++) - 63
        if (b < 0 || b > 63) return [] // Invalid ASCII range
        result |= (b & 0x1f) << shift
        shift += 5
        if (shift > 35) return [] // Arithmetic overflow / corrupted chunk
      } while (b >= 0x20)
      const dlat = (result & 1) !== 0 ? ~(result >> 1) : result >> 1
      lat += dlat

      shift = 0
      result = 0
      do {
        if (index >= str.length) return [] // Truncated chunk
        b = str.charCodeAt(index++) - 63
        if (b < 0 || b > 63) return [] // Invalid ASCII range
        result |= (b & 0x1f) << shift
        shift += 5
        if (shift > 35) return [] // Arithmetic overflow / corrupted chunk
      } while (b >= 0x20)
      const dlng = (result & 1) !== 0 ? ~(result >> 1) : result >> 1
      lng += dlng

      const finalLat = lat / factor
      const finalLng = lng / factor
      if (
        !Number.isFinite(finalLat) ||
        !Number.isFinite(finalLng) ||
        Math.abs(finalLat) > 90 ||
        Math.abs(finalLng) > 180
      ) {
        return [] // Out-of-bounds geographic coordinate
      }
      coordinates.push([finalLat, finalLng])
    }
  } catch {
    return []
  }
  return coordinates
}

/**
 * Normalizes an ORS geometry into standard [[lat, lng], ...] point array.
 * Accepts GeoJSON LineString coordinates [[lng, lat], ...] or encoded polyline string.
 */
export function normalizeRouteCoordinates(geometry) {
  if (!geometry) return []
  if (typeof geometry === 'string') {
    return decodePolyline(geometry)
  }
  if (Array.isArray(geometry)) {
    if (geometry.length === 0) return []
    // Detect GeoJSON [lng, lat] vs [lat, lng]
    // GeoJSON longitude in Philippines is ~120-125, latitude is ~13-15
    const first = geometry[0]
    if (Array.isArray(first) && first.length >= 2) {
      if (Math.abs(first[0]) > 90 && Math.abs(first[1]) <= 90) {
        // [lng, lat] GeoJSON format -> convert to [lat, lng]
        return geometry.map(([lng, lat]) => [lat, lng])
      }
      return geometry.map(([lat, lng]) => [lat, lng])
    }
  }
  if (geometry.type === 'LineString' && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates.map(([lng, lat]) => [lat, lng])
  }
  return []
}

/**
 * Projects a point P onto line segment A -> B.
 * Returns { projectedLat, projectedLng, t, distanceMeters, segmentBearing, segmentLengthMeters }
 */
export function projectPointOntoSegment(latP, lngP, latA, lngA, latB, lngB) {
  const segmentLength = haversineDistance(latA, lngA, latB, lngB)
  const segmentBearing = calculateBearing(latA, lngA, latB, lngB)

  if (segmentLength < 0.001) {
    const dist = haversineDistance(latP, lngP, latA, lngA)
    return {
      projectedLat: latA,
      projectedLng: lngA,
      t: 0,
      distanceMeters: dist,
      segmentBearing,
      segmentLengthMeters: 0,
    }
  }

  // Equirectangular projection for flat local approximation
  const latMidRad = (((latA + latB) / 2.0) * Math.PI) / 180.0
  const cosLatMid = Math.cos(latMidRad)

  const dx = (lngB - lngA) * cosLatMid
  const dy = latB - latA
  const px = (lngP - lngA) * cosLatMid
  const py = latP - latA

  const dot = px * dx + py * dy
  const lenSq = dx * dx + dy * dy
  const t = Math.max(0.0, Math.min(1.0, dot / lenSq))

  const projectedLat = latA + t * (latB - latA)
  const projectedLng = lngA + t * (lngB - lngA)
  const distanceMeters = haversineDistance(latP, lngP, projectedLat, projectedLng)

  return {
    projectedLat,
    projectedLng,
    t,
    distanceMeters,
    segmentBearing,
    segmentLengthMeters: segmentLength,
  }
}

// ── Independent Fix Gating ───────────────────────────────────────────────────

/**
 * Evaluates whether a new GPS fix qualifies as independent evidence relative to the previous fix.
 * Filters out duplicate reports and rapid consecutive fixes within MIN_FIX_INTERVAL_MS.
 */
export function isIndependentGpsFix(currFix, prevFix, now = Date.now()) {
  if (!currFix) return false
  if (!prevFix) return true

  const currTime = currFix.timestamp ?? now
  const prevTime = prevFix.timestamp ?? prevFix.receivedAt ?? now
  const dt = currTime - prevTime

  if (dt < GEOMETRY_CONFIG.MIN_FIX_INTERVAL_MS) {
    return false
  }

  const dist = haversineDistance(prevFix.lat, prevFix.lng, currFix.lat, currFix.lng)
  if (dist <= GEOMETRY_CONFIG.MIN_FIX_DISPLACEMENT_M) {
    return false
  }

  return true
}

// ── RouteProgressTracker Class ───────────────────────────────────────────────

export class RouteProgressTracker {
  constructor(geometry, options = {}) {
    this.config = { ...GEOMETRY_CONFIG, ...options }
    this.points = normalizeRouteCoordinates(geometry)
    this.segmentCount = Math.max(0, this.points.length - 1)

    // Precompute cumulative distances and segment properties
    this.cumulativeDistances = [0]
    this.segmentLengths = []
    this.segmentBearings = []

    for (let i = 0; i < this.segmentCount; i++) {
      const [latA, lngA] = this.points[i]
      const [latB, lngB] = this.points[i + 1]
      const len = haversineDistance(latA, lngA, latB, lngB)
      const brg = calculateBearing(latA, lngA, latB, lngB)
      this.segmentLengths.push(len)
      this.segmentBearings.push(brg)
      this.cumulativeDistances.push(this.cumulativeDistances[i] + len)
    }

    this.totalDistanceMeters = this.cumulativeDistances[this.cumulativeDistances.length - 1] || 0

    // Tracking state
    this.lastProgressMeters = 0
    this.lastOffRouteDist = 0
    this.lastProjectedPoint = null
    this.lastSegmentIndex = 0
    this.lastFix = null
    this.lastAcceptedFix = null

    // Off-route detection state
    this.consecutiveOffRouteFixes = 0
    this.firstOffRouteTimestamp = null
    this.status = 'on_route' // 'on_route' | 'off_route_pending' | 'off_route_confirmed'

    // Forward jump confirmation state
    this.pendingJumpProgress = null
    this.pendingJumpFixCount = 0

    // Reverse/stuck recovery counter
    this.consecutiveReverseFixes = 0
  }

  /**
   * Resets progress to 0 or a specified position along the route.
   */
  reset(progressMeters = 0) {
    this.lastProgressMeters = Math.max(0, Math.min(this.totalDistanceMeters, progressMeters))
    this.lastOffRouteDist = 0
    this.lastProjectedPoint = null
    this.lastSegmentIndex = 0
    this.lastFix = null
    this.lastAcceptedFix = null
    this.consecutiveOffRouteFixes = 0
    this.firstOffRouteTimestamp = null
    this.status = 'on_route'
    this.pendingJumpProgress = null
    this.pendingJumpFixCount = 0
    this.consecutiveReverseFixes = 0
  }

  /**
   * Updates tracking state with a new GPS fix.
   *
   * @param {object} fix - { lat, lng, accuracy, heading, speed, timestamp }
   * @param {number} [now=Date.now()] - Current wall clock timestamp
   * @returns {object} Progress summary:
   *   - progressMeters: distance along route in meters
   *   - distanceRemainingMeters: distance to route end in meters
   *   - fractionComplete: 0.0 to 1.0
   *   - offRouteDistanceMeters: perpendicular distance from GPS to projected route point
   *   - isOffRoute: boolean (true if confirmed off route)
   *   - offRouteStatus: 'on_route' | 'off_route_pending' | 'off_route_confirmed'
   *   - projectedPoint: [lat, lng]
   *   - segmentIndex: current segment index
   *   - isIndependent: boolean
   */
  update(fix, now = Date.now()) {
    if (!fix || !Number.isFinite(fix.lat) || !Number.isFinite(fix.lng) || this.points.length < 2) {
      return this._buildResult(
        this.lastProgressMeters,
        this.lastOffRouteDist,
        this.status,
        this.lastProjectedPoint,
        this.lastSegmentIndex,
        false
      )
    }

    const isIndependent = isIndependentGpsFix(fix, this.lastAcceptedFix, now)
    if (!isIndependent && this.lastAcceptedFix) {
      // Duplicate or rapid consecutive fix: return cached progress without advancing state or creating misleading null/0 projections
      return this._buildResult(
        this.lastProgressMeters,
        this.lastOffRouteDist,
        this.status,
        this.lastProjectedPoint,
        this.lastSegmentIndex,
        false
      )
    }

    // Determine accuracy validity (Item 3 & Item 4)
    const isMock = Boolean(fix.isMock)
    const rawAcc = fix.accuracy
    const isAccKnown =
      !isMock &&
      typeof rawAcc === 'number' &&
      Number.isFinite(rawAcc) &&
      rawAcc > 0
    const accuracy = isAccKnown ? rawAcc : null

    // Item 4: Poor-accuracy progress protection.
    // A fix with accuracy above 50 m must not advance committed route progress or become the last accepted progress fix.
    // It is also ignored for off-route evidence.
    if (isAccKnown && accuracy > this.config.MAX_ACCURACY_FOR_OFF_ROUTE_M) {
      return this._buildResult(
        this.lastProgressMeters,
        this.lastOffRouteDist,
        this.status,
        this.lastProjectedPoint,
        this.lastSegmentIndex,
        false
      )
    }

    const fixTime = fix.timestamp ?? now
    const lastTime = this.lastAcceptedFix?.timestamp ?? this.lastAcceptedFix?.receivedAt ?? fixTime
    const dtSeconds = Math.max(0.1, (fixTime - lastTime) / 1000.0)

    // Evaluate reacquisition condition: gap > 15s or first fix
    const isFirstFix = this.lastAcceptedFix == null
    const isLongGap = (fixTime - lastTime) > this.config.REACQUISITION_TIME_GAP_MS

    let windowStartM = 0
    let windowEndM = this.totalDistanceMeters

    if (!isFirstFix && !isLongGap) {
      const backwardAllowance = isAccKnown
        ? Math.max(
            this.config.BACKWARD_PROGRESS_MIN_M,
            Math.min(this.config.BACKWARD_PROGRESS_MAX_M, accuracy)
          )
        : this.config.BACKWARD_PROGRESS_DEFAULT_M

      const forwardAllowance = Math.min(
        this.config.FORWARD_WINDOW_MAX_M,
        this.config.FORWARD_WINDOW_BASE_M + dtSeconds * this.config.FORWARD_WINDOW_SPEED_M_PER_S
      )

      windowStartM = Math.max(0, this.lastProgressMeters - backwardAllowance)
      windowEndM = Math.min(this.totalDistanceMeters, this.lastProgressMeters + forwardAllowance)
    }

    // Project onto segments within search window
    let bestCandidate = null
    let minPenalizedDist = Infinity

    for (let i = 0; i < this.segmentCount; i++) {
      const segStartM = this.cumulativeDistances[i]
      const segEndM = this.cumulativeDistances[i + 1]

      if (segEndM < windowStartM || segStartM > windowEndM) continue

      const [latA, lngA] = this.points[i]
      const [latB, lngB] = this.points[i + 1]
      const proj = projectPointOntoSegment(fix.lat, fix.lng, latA, lngA, latB, lngB)

      const candidateProgressM = segStartM + proj.t * proj.segmentLengthMeters

      // Heading penalty: requires BOTH valid heading AND speed >= threshold
      let penalty = 0.0
      const hasUsableHeading =
        typeof fix.heading === 'number' &&
        !Number.isNaN(fix.heading) &&
        fix.heading >= 0 &&
        fix.heading < 360 &&
        typeof fix.speed === 'number' &&
        Number.isFinite(fix.speed) &&
        fix.speed >= this.config.HEADING_MIN_SPEED_M_PER_S

      if (hasUsableHeading) {
        const angleDiff = angularDifference(fix.heading, proj.segmentBearing)
        if (angleDiff > this.config.HEADING_PENALTY_SEVERE_DEG) {
          penalty = this.config.HEADING_PENALTY_SEVERE_M
        } else if (angleDiff > this.config.HEADING_PENALTY_THRESHOLD_DEG) {
          penalty = this.config.HEADING_PENALTY_M
        }
      }

      const penalizedDist = proj.distanceMeters + penalty
      if (penalizedDist < minPenalizedDist) {
        minPenalizedDist = penalizedDist
        bestCandidate = {
          segmentIndex: i,
          progressMeters: candidateProgressM,
          perpendicularDistMeters: proj.distanceMeters,
          projectedLat: proj.projectedLat,
          projectedLng: proj.projectedLng,
        }
      }
    }

    // Evaluate full route if window candidate is missing or far off-route
    let fullRouteCandidate = null
    let fullRouteMinDist = Infinity

    for (let i = 0; i < this.segmentCount; i++) {
      const [latA, lngA] = this.points[i]
      const [latB, lngB] = this.points[i + 1]
      const proj = projectPointOntoSegment(fix.lat, fix.lng, latA, lngA, latB, lngB)
      const candidateProgressM = this.cumulativeDistances[i] + proj.t * proj.segmentLengthMeters
      if (proj.distanceMeters < fullRouteMinDist) {
        fullRouteMinDist = proj.distanceMeters
        fullRouteCandidate = {
          segmentIndex: i,
          progressMeters: candidateProgressM,
          perpendicularDistMeters: proj.distanceMeters,
          projectedLat: proj.projectedLat,
          projectedLng: proj.projectedLng,
        }
      }
    }

    if (!bestCandidate) {
      bestCandidate = fullRouteCandidate
    } else if (
      fullRouteCandidate &&
      fullRouteCandidate.perpendicularDistMeters <= this.config.OFF_ROUTE_THRESHOLD_MIN_M &&
      bestCandidate.perpendicularDistMeters > this.config.OFF_ROUTE_THRESHOLD_MIN_M
    ) {
      if (fullRouteCandidate.progressMeters < this.lastProgressMeters) {
        this.consecutiveReverseFixes += 1
        if (this.consecutiveReverseFixes >= this.config.REVERSE_RECOVERY_FIXES) {
          bestCandidate = fullRouteCandidate
          this.consecutiveReverseFixes = 0
        }
      } else {
        bestCandidate = fullRouteCandidate
      }
    }

    let resolvedProgress = this.lastProgressMeters
    let offRouteDist = bestCandidate?.perpendicularDistMeters ?? 0
    let projectedPt = bestCandidate ? [bestCandidate.projectedLat, bestCandidate.projectedLng] : null
    let segIdx = bestCandidate?.segmentIndex ?? 0

    if (bestCandidate) {
      const deltaProgress = bestCandidate.progressMeters - this.lastProgressMeters

      // Reacquisition implied speed limit check
      if (deltaProgress > this.config.FORWARD_JUMP_THRESHOLD_M && !isFirstFix) {
        let isExcessiveSpeed = false
        if (isLongGap) {
          const impliedSpeed = deltaProgress / dtSeconds
          if (impliedSpeed > this.config.REACQUISITION_IMPLIED_SPEED_MAX_M_PER_S) {
            isExcessiveSpeed = true
          }
        }

        if (isExcessiveSpeed || !isLongGap) {
          // Require multi-fix confirmation before accepting excessive forward jump or short-gap jump
          if (
            this.pendingJumpProgress != null &&
            Math.abs(bestCandidate.progressMeters - this.pendingJumpProgress) < 50
          ) {
            this.pendingJumpFixCount += 1
            if (this.pendingJumpFixCount >= this.config.FORWARD_JUMP_CONFIRM_FIXES) {
              resolvedProgress = bestCandidate.progressMeters
              this.pendingJumpProgress = null
              this.pendingJumpFixCount = 0
            }
          } else {
            this.pendingJumpProgress = bestCandidate.progressMeters
            this.pendingJumpFixCount = 1
          }
        } else {
          // Long gap reacquisition with realistic speed: accept progress
          resolvedProgress = bestCandidate.progressMeters
          this.pendingJumpProgress = null
          this.pendingJumpFixCount = 0
        }
      } else {
        this.pendingJumpProgress = null
        this.pendingJumpFixCount = 0

        // Reverse / stuck recovery check
        const backwardAllowance = isFirstFix
          ? 0
          : (isAccKnown
              ? Math.max(
                  this.config.BACKWARD_PROGRESS_MIN_M,
                  Math.min(this.config.BACKWARD_PROGRESS_MAX_M, accuracy)
                )
              : this.config.BACKWARD_PROGRESS_DEFAULT_M)

        if (bestCandidate.progressMeters < this.lastProgressMeters - backwardAllowance) {
          this.consecutiveReverseFixes += 1
          if (this.consecutiveReverseFixes >= this.config.REVERSE_RECOVERY_FIXES) {
            resolvedProgress = bestCandidate.progressMeters
            this.consecutiveReverseFixes = 0
          }
        } else {
          this.consecutiveReverseFixes = 0
          // Monotonic progress update: progress never regresses on small forward GPS jitter
          resolvedProgress = Math.max(this.lastProgressMeters, bestCandidate.progressMeters)
        }
      }
    }

    this.lastProgressMeters = resolvedProgress

    // 2. Off-Route Evaluation (Item 3)
    let offRouteThreshold
    let allowTimeCondition = true

    if (isAccKnown) {
      // Valid accuracy (already <= 50m): apply approved dynamic threshold
      offRouteThreshold = Math.min(
        this.config.OFF_ROUTE_THRESHOLD_MAX_M,
        Math.max(
          this.config.OFF_ROUTE_THRESHOLD_MIN_M,
          this.config.OFF_ROUTE_ACCURACY_MULTIPLIER * accuracy
        )
      )
      allowTimeCondition = true
    } else {
      // Unavailable, invalid, zero, null, non-finite, or mock GPS is active:
      // - Use 35 m off-route threshold
      // - Require 3 counted deviating fixes
      // - Disable four-second confirmation alternative
      offRouteThreshold = this.config.UNKNOWN_ACCURACY_THRESHOLD_M || this.config.OFF_ROUTE_THRESHOLD_MIN_M
      allowTimeCondition = false
    }

    if (offRouteDist > offRouteThreshold) {
      this.consecutiveOffRouteFixes += 1
      if (this.firstOffRouteTimestamp == null) {
        this.firstOffRouteTimestamp = fixTime
      }

      const elapsedOffRouteMs = fixTime - this.firstOffRouteTimestamp
      const hasCountCondition =
        this.consecutiveOffRouteFixes >= this.config.OFF_ROUTE_CONFIRM_CONSECUTIVE_FIXES
      const hasTimeCondition =
        allowTimeCondition &&
        elapsedOffRouteMs >= this.config.OFF_ROUTE_CONFIRM_TIME_MS &&
        this.consecutiveOffRouteFixes >= this.config.OFF_ROUTE_CONFIRM_MIN_TIME_FIXES

      if (hasCountCondition || hasTimeCondition) {
        this.status = 'off_route_confirmed'
      } else {
        this.status = 'off_route_pending'
      }
    } else {
      // Fix is on route: reset off-route counters
      this.consecutiveOffRouteFixes = 0
      this.firstOffRouteTimestamp = null
      this.status = 'on_route'
    }

    this.lastOffRouteDist = offRouteDist
    this.lastProjectedPoint = projectedPt
    this.lastSegmentIndex = segIdx
    this.lastFix = fix
    this.lastAcceptedFix = {
      ...fix,
      receivedAt: now,
    }

    return this._buildResult(
      this.lastProgressMeters,
      offRouteDist,
      this.status,
      projectedPt,
      segIdx,
      true
    )
  }

    _buildResult(progressMeters, offRouteDist, status, projectedPt, segIdx, isIndependent) {
    const distanceRemainingMeters = Math.max(0, this.totalDistanceMeters - progressMeters)
    const fractionComplete =
      this.totalDistanceMeters > 0
        ? Math.min(1.0, Math.max(0.0, progressMeters / this.totalDistanceMeters))
        : 1.0

    return {
      progressMeters,
      distanceRemainingMeters,
      fractionComplete,
      offRouteDistanceMeters: offRouteDist,
      isOffRoute: status === 'off_route_confirmed',
      offRouteStatus: status,
      projectedPoint: projectedPt,
      segmentIndex: segIdx,
      isIndependent,
      totalDistanceMeters: this.totalDistanceMeters,
    }
  }
}
