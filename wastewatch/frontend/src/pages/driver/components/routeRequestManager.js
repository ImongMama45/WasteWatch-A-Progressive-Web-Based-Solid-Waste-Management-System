/**
 * routeRequestManager.js - Framework-independent ORS route request state machine.
 *
 * Implements robust lifecycle management for OpenRouteService directions requests:
 * - Single-flight network requests with AbortController cancellation.
 * - Stale-response protection keyed to authoritative target identity.
 * - Binding Owner Decision A1: If active target is non-routable, route requests are suppressed.
 * - 15-second automatic reroute cooldown with 3-second manual anti-spam gate.
 * - Exponential backoff with jitter and browser-readable rate limit inspection.
 * - Controlled, 10s-paced, 60-request session-capped background pre-caching.
 * - Failed pre-cache leg suppression with 60s backoff.
 * - Clean destruction and teardown.
 */

import { makeLegacyCacheKey } from './navTarget.js'
import { RouteProgressTracker, normalizeRouteCoordinates, haversineDistance } from './navRouteGeometry.js'

export const REQUEST_MANAGER_CONFIG = {
  // Cooldowns and anti-spam gates
  AUTO_REROUTE_COOLDOWN_MS: 15000,
  MANUAL_REROUTE_MIN_GAP_MS: 3000,

  // Network retry backoff
  MAX_RETRY_ATTEMPTS: 3,
  BACKOFF_BASE_MS: 2000,
  BACKOFF_MAX_JITTER_MS: 500,

  // Background stop-to-stop pre-cache limits
  PRECACHE_QUEUE_START_DELAY_MS: 1000,
  PRECACHE_PACING_MS: 10000,
  PRECACHE_SESSION_CAP: 60,
  FAILED_LEG_BACKOFF_MS: 300000,

  // Default ORS endpoint and profile
  ORS_BASE_URL: 'https://api.openrouteservice.org/v2/directions/driving-car',
}

export class RouteRequestManager {
  /**
   * @param {object} options
   * @param {string} options.apiKey - OpenRouteService API key
   * @param {function} [options.fetchFn=globalThis.fetch] - Injected fetch implementation
   * @param {function} [options.clock=Date.now] - Injected timestamp provider
   * @param {function} [options.random=Math.random] - Injected pseudo-random generator
   * @param {object|null} [options.storage=sessionStorage] - Injected storage implementation
   * @param {function} [options.onRouteSuccess] - Callback ({ route, target, isCached, progressTracker })
   * @param {function} [options.onRouteError] - Callback ({ error, target, attempt })
   * @param {function} [options.onProgressUpdate] - Callback (progressSummary)
   * @param {function} [options.onRerouteRequired] - Callback ({ reason, target })
   * @param {function} [options.onPrecacheSuccess] - Callback ({ legKey, route })
   */
  constructor({
    apiKey,
    fetchFn = typeof window !== 'undefined' && typeof window.fetch === 'function' ? window.fetch.bind(window) : globalThis.fetch,
    clock = Date.now,
    random = Math.random,
    storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null,
    initialGps = null,
    initialAccuracy = null,
    initialIsMock = false,
    initialIsOnline = undefined,
    initialTarget = null,
    onRouteSuccess = () => { },
    onRouteError = () => { },
    onProgressUpdate = () => { },
    onRerouteRequired = () => { },
    onPrecacheSuccess = () => { },
    config = {},
  } = {}) {
    this.apiKey = apiKey
    const defaultFetch = typeof window !== 'undefined' && typeof window.fetch === 'function'
      ? window.fetch.bind(window)
      : (typeof globalThis !== 'undefined' && typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null)
    this.fetchFn = fetchFn || defaultFetch
    this.clock = clock
    this.random = random
    this.storage = storage

    this.onRouteSuccess = onRouteSuccess
    this.onRouteError = onRouteError
    this.onProgressUpdate = onProgressUpdate
    this.onRerouteRequired = onRerouteRequired
    this.onPrecacheSuccess = onPrecacheSuccess

    this.config = { ...REQUEST_MANAGER_CONFIG, ...config }

    // Active state
    this.currentTarget = null
    this.currentGps = null
    this.currentAccuracy = null
    this.isOnline = initialIsOnline !== undefined ? Boolean(initialIsOnline) : true
    this.isDestroyed = false

    // Pending request when GPS is not yet acquired
    this.pendingTarget = null
    this.pendingReason = null

    // Request lifecycle
    this.activeAbortController = null
    this.precacheAbortController = null
    this.inFlightTargetId = null
    this.retryTimer = null
    this.lastRequestStartedAt = -Infinity
    this.lastRequestedTargetId = null
    this.lastRoutedTargetId = null
    this.lastManualRerouteAt = -Infinity
    this.lastInstructionRefreshTargetId = null

    // Accuracy pairing state
    this.lastAccuracy = null
    this.lastAccuracyTime = -Infinity

    // Route tracking and geometry
    this.activeRoute = null
    this.progressTracker = null

    // Pre-cache state
    this.precacheQueue = []
    this.precacheTimer = null
    this.precacheSessionCount = 0
    this.failedLegs = new Map() // legKey -> { attempts, nextEligibleAt }
    this.legCache = new Map() // legKey -> { geometry }

    // Hydrate existing legCache from storage
    if (this.storage) {
      try {
        const raw = this.storage.getItem('ww_ors_route_cache')
        if (raw) {
          const parsed = JSON.parse(raw)
          if (Array.isArray(parsed)) {
            for (const [k, v] of parsed) {
              if (k && v?.geometry) this.legCache.set(k, v)
            }
          }
        }
      } catch { }
    }

    // Seed initial state if provided
    if (initialGps) {
      this.handleGpsUpdate(initialGps, initialAccuracy, { isMock: initialIsMock })
    }
    if (initialTarget) {
      this.setTarget(initialTarget)
    }
  }

  /**
   * Updates network connectivity state.
   * @param {boolean} online
   */
  setOnline(online) {
    this.isOnline = Boolean(online)
    if (this.isOnline) {
      // If we have an active routable target but no route, attempt request
      if (this.currentTarget?.isRoutable && !this.activeRoute && !this.inFlightTargetId) {
        if (this.currentGps) {
          this.requestRoute({ reason: 'online_resumed', bypassCooldown: true })
        } else {
          this.pendingTarget = this.currentTarget
          this.pendingReason = 'online_resumed'
        }
      }
      if (!this.precacheTimer && !this.precacheAbortController) {
        this._scheduleNextPrecache(500)
      }
    } else {
      // Offline: cancel pending retries
      this._clearRetryTimer()
      this._clearPrecacheTimer()
      if (this.precacheAbortController) {
        this.precacheAbortController.abort()
        this.precacheAbortController = null
      }
    }
  }

  /**
   * Sets the authoritative active navigation target.
   *
   * @param {object|null} target - Output from resolveActiveNavTarget()
   */
  setTarget(target) {
    if (this.isDestroyed) return

    const prevTargetId = this.currentTarget?.targetId
    const newTargetId = target?.targetId

    this.currentTarget = target

    // If target identity has changed
    if (prevTargetId !== newTargetId) {
      this.lastInstructionRefreshTargetId = null

      // Cancel in-flight requests for previous target
      if (this.activeAbortController) {
        this.activeAbortController.abort()
        this.activeAbortController = null
        this.inFlightTargetId = null
      }
      if (this.precacheAbortController) {
        this.precacheAbortController.abort()
        this.precacheAbortController = null
      }
      this._clearRetryTimer()

      this.activeRoute = null
      this.progressTracker = null

      // Check if target is routable
      if (!target || !target.isRoutable || !target.hasValidCoords) {
        // Non-routable stop or end-of-route: do NOT request route (Owner Decision A1)
        this.pendingTarget = null
        this.pendingReason = null
        return
      }

      // Check cache for this target
      const cached = this._restoreCachedRoute(target.targetKey)
      if (cached) {
        this._applyRoute(cached, target, true)
        // Finding 5: Controlled one-time refresh per target when cached instructions are unavailable
        const hasInstructions = Boolean(cached.steps || cached.segments)
        if (!hasInstructions && this.lastInstructionRefreshTargetId !== target.targetId) {
          this.lastInstructionRefreshTargetId = target.targetId
          if (this.currentGps) {
            this.requestRoute({ reason: 'cache_instruction_refresh', bypassCooldown: true })
          } else {
            this.pendingTarget = target
            this.pendingReason = 'cache_instruction_refresh'
          }
        }
      } else {
        // Request fresh route (genuine target change bypasses automatic reroute cooldown)
        if (!this.currentGps) {
          this.pendingTarget = target
          this.pendingReason = 'target_changed'
        } else {
          this.requestRoute({ reason: 'target_changed', bypassCooldown: true })
        }
      }
    } else if (target && target.isRoutable && !this.activeRoute && !this.inFlightTargetId) {
      // Target transitioned from non-routable to routable: request route once
      if (!this.currentGps) {
        this.pendingTarget = target
        this.pendingReason = 'routable_transition'
      } else {
        this.requestRoute({ reason: 'routable_transition', bypassCooldown: true })
      }
    } else if (!target || !target.isRoutable || !target.hasValidCoords) {
      this.pendingTarget = null
      this.pendingReason = null
    }
  }

  /**
   * Passes a new GPS fix into the request manager and local progress tracker.
   *
   * @param {object} gpsPos - { lat, lng, heading, speed, timestamp }
   * @param {number|null} [accuracy=null] - Accuracy in meters
   */
  handleGpsUpdate(gpsPos, accuracy = null, options = {}) {
    if (this.isDestroyed || !gpsPos) return

    const now = this.clock()
    this.currentGps = gpsPos

    const isMock = Boolean(gpsPos.isMock || options.isMock)

    // Evaluate accuracy conservatively: do not reuse stale accuracy across distinct fixes
    let effectiveAcc = null
    if (!isMock) {
      const candidateAcc =
        gpsPos.accuracy !== undefined && gpsPos.accuracy !== null
          ? gpsPos.accuracy
          : accuracy

      if (typeof candidateAcc === 'number' && Number.isFinite(candidateAcc) && candidateAcc > 0) {
        effectiveAcc = candidateAcc
      }
    }

    this.currentAccuracy = effectiveAcc

    // Missing-GPS resolution: If a target request was pending arrival of GPS, trigger it now
    if (this.pendingTarget) {
      const targetToRequest = this.pendingTarget
      const reasonToRequest = this.pendingReason || 'gps_acquired'
      this.pendingTarget = null
      this.pendingReason = null

      if (
        targetToRequest.isRoutable &&
        targetToRequest.hasValidCoords &&
        !this.activeAbortController
      ) {
        this.requestRoute({ reason: reasonToRequest, bypassCooldown: true })
      }
    }

    if (!this.progressTracker || !this.activeRoute) return

    const fixWithAcc = {
      ...gpsPos,
      accuracy: effectiveAcc,
      isMock,
      timestamp: gpsPos.timestamp ?? now,
    }

    const progress = this.progressTracker.update(fixWithAcc, now)
    this.onProgressUpdate(progress)

    // Check off-route condition
    if (progress.isOffRoute) {
      this._handleOffRouteDetected('off_route_confirmed')
    }
  }

  /**
   * Triggers manual reroute bypassing the automatic cooldown.
   *
   * @returns {boolean} Whether request was dispatched
   */
  triggerManualReroute() {
    if (this.isDestroyed) return false

    const now = this.clock()
    if (now - this.lastManualRerouteAt < this.config.MANUAL_REROUTE_MIN_GAP_MS) {
      return false // Anti-spam gate active
    }

    if (!this.currentTarget || !this.currentTarget.isRoutable) {
      return false
    }

    // Cancel in-flight active request to safely replace with fresh manual reroute (Finding 7C)
    if (this.activeAbortController) {
      this.activeAbortController.abort()
      this.activeAbortController = null
      this.inFlightTargetId = null
    }

    this.lastManualRerouteAt = now
    return this.requestRoute({ reason: 'manual_button', bypassCooldown: true })
  }

  /**
   * Core route request dispatcher with retry and cooldown controls.
   *
   * @param {object} params
   * @param {string} [params.reason='initial']
   * @param {boolean} [params.bypassCooldown=false]
   * @param {number} [params.attempt=1]
   */
  requestRoute({ reason = 'initial', bypassCooldown = false, attempt = 1 } = {}) {
    if (this.isDestroyed || !this.apiKey || !this.isOnline) return false

    const target = this.currentTarget
    if (!target || !target.isRoutable || !target.coords || !target.hasValidCoords) {
      return false
    }

    // Missing GPS: save pending target, do NOT issue request with fabricated coords
    if (!this.currentGps) {
      this.pendingTarget = target
      this.pendingReason = reason
      return false
    }

    // Single-flight protection: if a request for this exact target is already in flight, do not duplicate
    if (this.inFlightTargetId === target.targetId) {
      return false
    }

    const isTargetChange = target.targetId !== this.lastRequestedTargetId
    const isInitialOrResume =
      !this.activeRoute ||
      reason === 'online_resumed' ||
      reason === 'routable_transition' ||
      reason === 'target_changed' ||
      reason === 'gps_acquired' ||
      reason === 'cache_instruction_refresh'
    const shouldBypassCooldown = bypassCooldown || isTargetChange || isInitialOrResume

    const now = this.clock()
    if (!shouldBypassCooldown) {
      // Cooldown must be measured from the approved request-start event
      const elapsedSinceLastStart = now - this.lastRequestStartedAt
      if (elapsedSinceLastStart < this.config.AUTO_REROUTE_COOLDOWN_MS) {
        return false // Cooldown active for automatic same-target reroutes
      }
    }

    // Ensure start coordinate exists (GPS)
    const startLng = Number(this.currentGps.lng)
    const startLat = Number(this.currentGps.lat)
    const [destLng, destLat] = target.coords

    // Prevent zero-distance query
    if (Math.abs(startLng - destLng) < 0.00001 && Math.abs(startLat - destLat) < 0.00001) {
      return false
    }

    // Active navigation requests take priority over background pre-cache
    if (this.precacheAbortController) {
      this.precacheAbortController.abort()
      this.precacheAbortController = null
    }

    // Cancel any previous in-flight request
    if (this.activeAbortController) {
      this.activeAbortController.abort()
    }

    this.lastRequestStartedAt = now
    this.lastRequestedTargetId = target.targetId

    const controller = new AbortController()
    this.activeAbortController = controller
    this.inFlightTargetId = target.targetId

    const requestTargetId = target.targetId
    const requestTargetKey = target.targetKey

    const body = {
      coordinates: [
        [startLng, startLat],
        [destLng, destLat],
      ],
      instructions: true,
      preference: 'recommended',
    }

    this._executeFetch(body, controller.signal)
      .then((data) => {
        if (this.isDestroyed || controller.signal.aborted) return

        this.activeAbortController = null
        this.inFlightTargetId = null

        // Stale-response protection: discard if target changed during flight
        if (this.currentTarget?.targetId !== requestTargetId) return

        if (!data.routes || data.routes.length === 0) {
          const err = new Error('No route returned by provider')
          err.isRetryable = false
          throw err
        }

        const route = data.routes[0]

        // Validate decoded geometry (Finding 7A)
        const isValid = this._validateRouteGeometry(route.geometry, [startLng, startLat], [destLng, destLat])
        if (!isValid) {
          const err = new Error('Invalid route geometry returned by provider')
          err.isRetryable = false
          throw err
        }

        this.lastRoutedTargetId = requestTargetId
        this._saveCachedRoute(requestTargetKey, route.geometry)
        this._applyRoute(route, target, false)

        // Finding 6: Resume pre-cache queue processing after active navigation finishes
        this._scheduleNextPrecache(1000)
      })
      .catch((err) => {
        if (this.isDestroyed || controller.signal.aborted) return

        this.activeAbortController = null
        this.inFlightTargetId = null

        // Stale-response protection
        if (this.currentTarget?.targetId !== requestTargetId) return

        // Finding 6: Resume pre-cache queue processing after active navigation finishes/fails
        this._scheduleNextPrecache(1000)

        this.onRouteError({ error: err, target, attempt })

        // Do not retry permanent errors (e.g. 401, 404, no route, invalid geometry)
        const isRetryable = err.isRetryable !== false
        if (isRetryable && attempt < this.config.MAX_RETRY_ATTEMPTS && this.isOnline) {
          let retryDelay =
            this.config.BACKOFF_BASE_MS * Math.pow(2, attempt - 1) +
            Math.floor(this.random() * this.config.BACKOFF_MAX_JITTER_MS)

          // Respect server-indicated Retry-After if valid
          if (err.retryAfterSeconds != null && err.retryAfterSeconds > 0 && err.retryAfterSeconds <= 3600) {
            retryDelay = Math.max(retryDelay, err.retryAfterSeconds * 1000)
          }

          this._clearRetryTimer()
          this.retryTimer = setTimeout(() => {
            if (!this.isDestroyed && this.currentTarget?.targetId === requestTargetId) {
              this.requestRoute({ reason, bypassCooldown: true, attempt: attempt + 1 })
            }
          }, retryDelay)
        }
      })

    return true
  }

  /**
   * Internal fetch executor handling headers and rate-limits.
   */
  async _executeFetch(body, signal) {
    const fn = this.fetchFn || (typeof window !== 'undefined' ? window.fetch : globalThis.fetch)
    const context = typeof window !== 'undefined' ? window : globalThis
    const res = await fn.call(context, this.config.ORS_BASE_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json, application/geo+json',
        'Content-Type': 'application/json',
        Authorization: this.apiKey,
      },
      body: JSON.stringify(body),
      signal,
    })

    if (!res.ok) {
      const err = new Error(`ORS HTTP ${res.status}`)
      err.status = res.status

      // Permanent 4xx errors (e.g. 400, 401, 403, 404) are NOT retryable
      // 408 (Request Timeout) and 429 (Too Many Requests) and 5xx are retryable
      const isRetryable = res.status === 408 || res.status === 429 || (res.status >= 500 && res.status <= 599)
      err.isRetryable = isRetryable

      // Inspect browser-readable rate limit headers
      let retryAfterSeconds = null
      const retryAfterHeader = res.headers?.get?.('Retry-After')
      if (retryAfterHeader) {
        const parsed = parseInt(retryAfterHeader, 10)
        if (Number.isFinite(parsed) && parsed > 0 && parsed <= 3600) {
          retryAfterSeconds = parsed
        }
      }

      const resetHeader = res.headers?.get?.('x-ratelimit-reset')
      if (resetHeader && retryAfterSeconds == null) {
        const parsedReset = parseInt(resetHeader, 10)
        if (Number.isFinite(parsedReset) && parsedReset > 0) {
          const nowSeconds = Math.floor(this.clock() / 1000)
          if (parsedReset > nowSeconds && parsedReset - nowSeconds <= 3600) {
            // Epoch seconds in the near future
            retryAfterSeconds = parsedReset - nowSeconds
          } else if (parsedReset > 0 && parsedReset <= 3600) {
            // Delta seconds
            retryAfterSeconds = parsedReset
          }
        }
      }

      if (retryAfterSeconds != null) {
        err.retryAfterSeconds = retryAfterSeconds
      }

      throw err
    }

    return res.json()
  }

  _validateRouteGeometry(geometry, [startLng, startLat], [destLng, destLat]) {
    if (!geometry) return false
    const pts = normalizeRouteCoordinates(geometry)
    if (!Array.isArray(pts) || pts.length < 2) return false

    // Check for all-duplicate points
    const [firstLat, firstLng] = pts[0]
    let hasDistinct = false
    for (let i = 1; i < pts.length; i++) {
      if (Math.abs(pts[i][0] - firstLat) > 0.00001 || Math.abs(pts[i][1] - firstLng) > 0.00001) {
        hasDistinct = true
        break
      }
    }
    if (!hasDistinct) return false

    // Endpoints sanity: last point must not be implausibly distant from destination (> 10 km)
    const [lastLat, lastLng] = pts[pts.length - 1]
    const destDistM = haversineDistance(lastLat, lastLng, destLat, destLng)
    if (destDistM > 10000) return false

    return true
  }

  _applyRoute(route, target, isCached) {
    this.activeRoute = route
    this.progressTracker = new RouteProgressTracker(route.geometry)

    // Initial update with current GPS if available
    if (this.currentGps) {
      this.progressTracker.update(this.currentGps, this.clock())
    }

    this.onRouteSuccess({
      route,
      target,
      isCached,
      progressTracker: this.progressTracker,
    })
  }

  _handleOffRouteDetected(reason) {
    const now = this.clock()
    const elapsedSinceLastStart = now - this.lastRequestStartedAt

    if (elapsedSinceLastStart >= this.config.AUTO_REROUTE_COOLDOWN_MS) {
      this.onRerouteRequired({ reason, target: this.currentTarget })
      this.requestRoute({ reason: 'auto_off_route', bypassCooldown: false })
    }
  }

  // ── Pre-Cache Queue Management ─────────────────────────────────────────────

  /**
   * Enqueues upcoming stop-to-stop waypoint pairs for background pre-caching.
   *
   * @param {Array<object>} waypoints - Full route sequence
   * @param {number} currentStopIndex - Active stop index
   */
  updatePrecacheSequence(waypoints, currentStopIndex) {
    if (this.isDestroyed || !Array.isArray(waypoints)) return

    const wps = waypoints
    const queue = []

    for (let i = currentStopIndex; i < wps.length - 1; i++) {
      const fromWp = wps[i]
      const toWp = wps[i + 1]
      if (fromWp?.lat != null && fromWp?.lng != null && toWp?.lat != null && toWp?.lng != null) {
        const legKey = `${i}-${i + 1}`
        if (!this.legCache.has(legKey)) {
          queue.push({ fromIdx: i, toIdx: i + 1, fromWp, toWp, legKey })
        }
      }
    }

    this.precacheQueue = queue
    if (!this.precacheTimer && !this.precacheAbortController) {
      this._scheduleNextPrecache(this.config.PRECACHE_QUEUE_START_DELAY_MS)
    }
  }

  _scheduleNextPrecache(delayMs = this.config.PRECACHE_PACING_MS) {
    this._clearPrecacheTimer()
    if (this.isDestroyed || !this.isOnline) return

    this.precacheTimer = setTimeout(() => {
      this._processNextPrecacheLeg()
    }, delayMs)
  }

  async _processNextPrecacheLeg() {
    this.precacheTimer = null
    if (this.isDestroyed || !this.isOnline) return

    // Single-flight pre-cache protection: at most one pre-cache request in flight at a time
    if (this.precacheAbortController) {
      return
    }

    // Finding 6: If active navigation request is running, do NOT shift or process pre-cache leg
    if (this.activeAbortController) {
      this._scheduleNextPrecache(2000)
      return
    }

    // Enforce session cap
    if (this.precacheSessionCount >= this.config.PRECACHE_SESSION_CAP) {
      return
    }

    // Pick next un-cached, eligible leg
    const now = this.clock()
    let legItem = null

    while (this.precacheQueue.length > 0) {
      const candidate = this.precacheQueue[0]
      if (this.legCache.has(candidate.legKey)) {
        this.precacheQueue.shift()
        continue
      }

      const failure = this.failedLegs.get(candidate.legKey)
      if (failure && now < failure.nextEligibleAt) {
        // Leg failed recently: suppress retry until backoff expires
        this.precacheQueue.shift()
        continue
      }

      legItem = this.precacheQueue.shift()
      break
    }

    if (!legItem) return

    const { fromWp, toWp, legKey } = legItem
    const body = {
      coordinates: [
        [Number(fromWp.lng), Number(fromWp.lat)],
        [Number(toWp.lng), Number(toWp.lat)],
      ],
      instructions: false,
    }

    // Pre-cache must not run concurrently with an active navigation request or another pre-cache request
    if (this.activeAbortController || this.precacheAbortController) {
      this.precacheQueue.unshift(legItem)
      if (this.activeAbortController) {
        this._scheduleNextPrecache(2000)
      }
      return
    }

    const controller = new AbortController()
    this.precacheAbortController = controller

    try {
      this.precacheSessionCount += 1
      const data = await this._executeFetch(body, controller.signal)

      if (this.isDestroyed || controller.signal.aborted) {
        if (controller.signal.aborted) {
          // Reinsert leg at front of queue on active navigation pre-emption
          this.precacheQueue.unshift(legItem)
        }
        return
      }

      if (data.routes && data.routes.length > 0) {
        const route = data.routes[0]
        this.legCache.set(legKey, { geometry: route.geometry })
        this._saveLegCache()
        if (!this.isDestroyed) {
          this.onPrecacheSuccess({ legKey, route })
        }
      }
    } catch {
      if (this.isDestroyed || controller.signal.aborted) {
        if (controller.signal.aborted) {
          this.precacheQueue.unshift(legItem)
        }
        return
      }
      // Record failure with 5-minute backoff
      const prevFailures = this.failedLegs.get(legKey)?.attempts || 0
      this.failedLegs.set(legKey, {
        attempts: prevFailures + 1,
        nextEligibleAt: now + this.config.FAILED_LEG_BACKOFF_MS,
      })
    } finally {
      if (this.precacheAbortController === controller) {
        this.precacheAbortController = null
      }
    }

    // Schedule next leg with 10s pacing
    this._scheduleNextPrecache(this.config.PRECACHE_PACING_MS)
  }

  // ── Cache Storage Helpers ──────────────────────────────────────────────────

  _restoreCachedRoute(targetKey) {
    if (!this.storage || !targetKey) return null
    try {
      const raw = this.storage.getItem('ww_ors_route')
      if (!raw) return null
      const parsed = JSON.parse(raw)
      if (parsed.key === targetKey && parsed.geometry) {
        return { geometry: parsed.geometry }
      }
    } catch {
      // Storage read error ignored
    }
    return null
  }

  _saveCachedRoute(targetKey, geometry) {
    if (this.isDestroyed || !this.storage || !targetKey || !geometry) return
    try {
      // Legacy cache shape preserved: { key, geometry }
      this.storage.setItem('ww_ors_route', JSON.stringify({ key: targetKey, geometry }))
    } catch {
      // Storage write error ignored
    }
  }

  _saveLegCache() {
    if (this.isDestroyed || !this.storage) return
    try {
      // Hydrate existing entries and merge rather than overwriting
      const existingRaw = this.storage.getItem('ww_ors_route_cache')
      let mergedMap = new Map()
      if (existingRaw) {
        try {
          const parsed = JSON.parse(existingRaw)
          if (Array.isArray(parsed)) {
            mergedMap = new Map(parsed)
          }
        } catch { }
      }
      for (const [k, v] of this.legCache.entries()) {
        mergedMap.set(k, v)
      }
      this.storage.setItem(
        'ww_ors_route_cache',
        JSON.stringify([...mergedMap.entries()])
      )
    } catch {
      // Storage write error ignored
    }
  }

  _clearRetryTimer() {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
  }

  _clearPrecacheTimer() {
    if (this.precacheTimer) {
      clearTimeout(this.precacheTimer)
      this.precacheTimer = null
    }
  }

  /**
   * Destroys manager, aborts in-flight requests, and clears all timers.
   */
  destroy() {
    this.isDestroyed = true
    if (this.activeAbortController) {
      this.activeAbortController.abort()
      this.activeAbortController = null
    }
    if (this.precacheAbortController) {
      this.precacheAbortController.abort()
      this.precacheAbortController = null
    }
    this._clearRetryTimer()
    this._clearPrecacheTimer()
    this.precacheQueue = []
    this.activeRoute = null
    this.progressTracker = null
  }
}
