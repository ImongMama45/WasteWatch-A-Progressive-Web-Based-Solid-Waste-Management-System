/**
 * navCamera.js - drives the driver navigation camera from ONE requestAnimationFrame loop.
 * Replaces CSS transitions on the map and marker so both always use the same number.
 *
 * Model:  h = eased, unwrapped GEOGRAPHIC heading of the truck (deg clockwise from north)
 *   marker rotation  R = h                    (always; never mapHeading)
 *   map rotation     M = mode3D ? h : 0       (course-up in 3D, north-up in 2D)
 *   on-screen truck heading = R - M           (0 = pointing screen-up in 3D)
 * Zero emojis.
 */
import { NAV_CFG, requiredHalfSize, shortestDelta, unwrapHeading } from './navMapMath.js'

export const MAX_HALF_PX = 1400      // above this the 3D container is too heavy -> stay 2D
export const TOP_CLIP_FRAC = 0.12    // top 12% is deliberately hazed (header/turn card covers it anyway)

export class NavCamera {
  constructor({
    viewportEl,
    mapEl,
    getMap,
    getMarker,
    cfg = NAV_CFG,
    tauMs = 180,
    onModeChange = null,
    debounceMs = 120,
  }) {
    Object.assign(this, {
      viewportEl,
      mapEl,
      getMap,
      getMarker,
      cfg,
      tauMs,
      onModeChange,
      debounceMs,
    })
    this.mode = '2D'
    this.h = 0; this.targetH = 0
    this.pos = null; this.targetPos = null
    this.follow = true
    this._raf = 0; this._last = 0
    this._destroyed = false

    this._resizeTimer = null
    this._resizeObserver = null
    this._windowResizeHandler = null

    this._lastW = 0
    this._lastH = 0
    if (this.viewportEl && typeof this.viewportEl.getBoundingClientRect === 'function') {
      const r = this.viewportEl.getBoundingClientRect()
      this._lastW = r.width || 0
      this._lastH = r.height || 0
    }

    this._initResizeObservation()
  }

  _initResizeObservation() {
    if (this._destroyed || !this.viewportEl) return

    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver((entries) => {
        const entry = entries && entries[0] ? entries[0] : null
        this._onResizeObserved(entry)
      })
      this._resizeObserver.observe(this.viewportEl)
    } else if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      this._windowResizeHandler = () => {
        this._onResizeObserved(null)
      }
      window.addEventListener('resize', this._windowResizeHandler)
    }
  }

  _onResizeObserved(entry) {
    if (this._destroyed || !this.viewportEl) return
    let w = 0, h = 0
    if (typeof this.viewportEl.getBoundingClientRect === 'function') {
      const r = this.viewportEl.getBoundingClientRect()
      w = r.width || 0
      h = r.height || 0
    } else if (entry && entry.contentRect) {
      w = entry.contentRect.width || 0
      h = entry.contentRect.height || 0
    }
    // Sub-2px threshold and initial notification filtering
    if (Math.abs(w - this._lastW) < 2 && Math.abs(h - this._lastH) < 2) {
      return
    }
    this._lastW = w
    this._lastH = h
    this._scheduleResize()
  }

  _scheduleResize() {
    if (this._destroyed) return
    if (this._resizeTimer) {
      clearTimeout(this._resizeTimer)
      this._resizeTimer = null
    }
    this._resizeTimer = setTimeout(() => {
      this._resizeTimer = null
      if (this._destroyed) return
      this.handleResize()
    }, this.debounceMs)
  }

  /** geographic heading from GPS; unwrapped against the previous TARGET so 359->1 takes +2 deg */
  setTargetHeading(deg) {
    if (this._destroyed) return
    if (typeof deg !== 'number' || !Number.isFinite(deg)) return
    this.targetH = unwrapHeading(this.targetH, deg)
    this._kick()
  }

  setTargetPosition(lat, lng) {
    if (this._destroyed) return
    if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return
    this.targetPos = { lat, lng }
    if (!this.pos) this.pos = { lat, lng }
    this._kick()
  }

  /** returns the mode actually applied ('3D' may be refused -> '2D') */
  setMode(mode) {
    if (this._destroyed) return this.mode
    if (!this.viewportEl || !this.mapEl) {
      this.mode = mode
      return this.mode
    }
    if (mode === '3D') {
      const r = this.viewportEl.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) {
        const half = requiredHalfSize(r.width, r.height, this.cfg, TOP_CLIP_FRAC)
        if (!isFinite(half) || half > MAX_HALF_PX) mode = '2D'
      } else {
        mode = '2D'
      }
    }
    this.mode = mode
    this._layout()
    this.apply()
    this._kick()
    return this.mode
  }

  /**
   * Recomputes layout and map size on viewport or window resize.
   * When in 2D mode: calls only map.invalidateSize() with default behavior.
   * When in 3D mode: recalculates layout and repositions to maintain truck perspective pivot;
   * if oversized or invalid, gracefully demotes to 2D and invokes onModeChange('2D') once.
   * Returns the actual applied mode ('3D' or '2D').
   */
  handleResize() {
    if (this._destroyed) return this.mode
    if (!this.viewportEl || !this.mapEl) return this.mode

    const r = typeof this.viewportEl.getBoundingClientRect === 'function'
      ? this.viewportEl.getBoundingClientRect()
      : { width: 0, height: 0 }

    // A zero-width or zero-height viewport (e.g. container hidden, collapsed, or detached)
    // must not trigger a 3D-to-2D demotion, must not alter mode or layout, and must not notify.
    // Wait for the next valid, nonzero resize notification.
    // guard removed

    this._lastW = r.width
    this._lastH = r.height

    if (this.mode === '2D') {
      const map = this.getMap()
      if (map && typeof map.invalidateSize === 'function') {
        map.invalidateSize()
      }
      return this.mode
    }

    // 3D mode path
    const half = requiredHalfSize(r.width, r.height, this.cfg, TOP_CLIP_FRAC)
    const canStay3D = isFinite(half) && half <= MAX_HALF_PX

    if (!canStay3D) {
      this.mode = '2D'
      this._layout()
      this.apply()
      this._kick()
      if (typeof this.onModeChange === 'function' && !this._destroyed) {
        this.onModeChange('2D')
      }
      return this.mode
    }

    this._layout()
    this.apply()
    this._kick()
    return this.mode
  }

  resize() {
    return this.handleResize()
  }

  _layout() {
    if (this._destroyed || !this.viewportEl || !this.mapEl) return
    const r = this.viewportEl.getBoundingClientRect(), s = this.mapEl.style
    if (r.width <= 0 || r.height <= 0) {
      if (this.mode === '2D') {
        s.transform = 'none'
        this.viewportEl.style.webkitMaskImage = this.viewportEl.style.maskImage = 'none'
      }
      return
    }

    if (this.mode === '3D') {
      const half = requiredHalfSize(r.width, r.height, this.cfg, TOP_CLIP_FRAC), D = 2 * half
      s.width = D + 'px'
      s.height = D + 'px'
      s.left = r.width / 2 - half + 'px'
      s.top = this.cfg.pivotY * r.height - half + 'px'
      s.transformOrigin = '50% 50%'
      this.viewportEl.style.webkitMaskImage = this.viewportEl.style.maskImage =
        `linear-gradient(to bottom, transparent 0, transparent ${TOP_CLIP_FRAC * 100}%, #000 ${TOP_CLIP_FRAC * 100 + 6}%)`
    } else {
      s.width = '100%'
      s.height = '100%'
      s.left = '0px'
      s.top = '0px'
      s.transformOrigin = '50% 50%'
      s.transform = 'none'
      this.viewportEl.style.webkitMaskImage = this.viewportEl.style.maskImage = 'none'
    }
    const map = this.getMap()
    if (!map) return
    map.invalidateSize({ pan: false, animate: false })
    if (this.pos) map.panTo([this.pos.lat, this.pos.lng], { animate: false })
    // Leaflet's own handlers read raw clientX/Y -> only valid when the container is untransformed
    const on = this.mode === '2D'
    for (const k of ['dragging', 'touchZoom', 'scrollWheelZoom', 'doubleClickZoom', 'boxZoom']) {
      if (map[k]) {
        if (on) map[k].enable()
        else map[k].disable()
      }
    }
  }

  apply() {
    if (this._destroyed || !this.mapEl) return
    if (this.mapEl.style.transition !== 'none') this.mapEl.style.transition = 'none'
    const { tiltDeg: T, perspectivePx: P, scale: S } = this.cfg
    const M = this.mode === '3D' ? this.h : 0
    if (this.mode === '3D') {
      this.mapEl.style.transform = `perspective(${P}px) rotateX(${T}deg) rotateZ(${-M}deg) scale(${S})`
    } else {
      this.mapEl.style.transform = 'none'
    }
    const w = this.getMarker()?.getElement()?.querySelector('.ww-truck-sprite-wrapper, .ww-3d-truck-wrapper')
    if (w) {
      if (w.style.transition !== 'none') w.style.transition = 'none'
      w.style.transform = `rotate(${this.h}deg)`
    }
    const mk = this.getMarker()
    if (mk && this.pos) mk.setLatLng([this.pos.lat, this.pos.lng])
  }

  /** advance by dtMs (exposed so tests can drive time deterministically) */
  step(dtMs) {
    if (this._destroyed) return false
    const k = 1 - Math.exp(-dtMs / this.tauMs)
    this.h += (this.targetH - this.h) * k
    if (Math.abs(this.targetH - this.h) < 0.02) this.h = this.targetH
    if (this.pos && this.targetPos) {
      this.pos.lat += (this.targetPos.lat - this.pos.lat) * k
      this.pos.lng += (this.targetPos.lng - this.pos.lng) * k
    }
    this.apply()
    const map = this.getMap()
    if (map && this.follow && this.pos) map.panTo([this.pos.lat, this.pos.lng], { animate: false })
    return !this.settled()
  }

  settled() {
    return Math.abs(this.targetH - this.h) < 0.02 &&
      (!this.pos || !this.targetPos || (Math.abs(this.targetPos.lat - this.pos.lat) < 1e-9 && Math.abs(this.targetPos.lng - this.pos.lng) < 1e-9))
  }

  _kick() {
    if (this._destroyed || this._raf) return
    this._last = performance.now()
    const loop = (t) => {
      if (this._destroyed) {
        this._raf = 0
        return
      }
      const dt = Math.min(64, t - this._last)
      this._last = t
      this._raf = this.step(dt) ? requestAnimationFrame(loop) : 0
    }
    this._raf = requestAnimationFrame(loop)
  }

  destroy() {
    if (this._destroyed) return
    this._destroyed = true
    if (this._resizeTimer) {
      clearTimeout(this._resizeTimer)
      this._resizeTimer = null
    }
    if (this._resizeObserver) {
      this._resizeObserver.disconnect()
      this._resizeObserver = null
    }
    if (this._windowResizeHandler && typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('resize', this._windowResizeHandler)
      this._windowResizeHandler = null
    }
    cancelAnimationFrame(this._raf)
    this._raf = 0
    if (this.mapEl) {
      this.mapEl.style.transform = 'none'
      this.mapEl.style.width = '100%'
      this.mapEl.style.height = '100%'
      this.mapEl.style.left = '0px'
      this.mapEl.style.top = '0px'
    }
    if (this.viewportEl) {
      this.viewportEl.style.webkitMaskImage = 'none'
      this.viewportEl.style.maskImage = 'none'
    }
  }
}
