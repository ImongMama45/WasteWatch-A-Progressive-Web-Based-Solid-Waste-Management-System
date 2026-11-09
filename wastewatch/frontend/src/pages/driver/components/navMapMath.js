/**
 * navMapMath.js - pure helpers for the driver navigation camera (no DOM, no Leaflet).
 * Conventions: screen/plane coordinates are px, x right, y DOWN, origin = camera pivot.
 * Headings are degrees clockwise from north. CSS rotateZ(a) is clockwise-positive.
 * Zero emojis.
 */
export const NAV_CFG = { tiltDeg: 40, perspectivePx: 1000, scale: 1.5, pivotY: 0.62 }

const rad = d => (d * Math.PI) / 180
export const normalizeDeg = a => ((a % 360) + 360) % 360
/** signed shortest delta in [-180, 180) */
export const shortestDelta = (from, to) => ((((to - from) % 360) + 540) % 360) - 180
/** continuous (unwrapped) angle: never jumps by more than 180 deg */
export const unwrapHeading = (prev, target) => prev + shortestDelta(prev, target)

/** Stationary filter: keep previous heading when slow or heading invalid. */
export function acceptHeading(h, speedMps) {
  if (typeof h !== 'number' || Number.isNaN(h) || h < 0 || h >= 360) return false
  if (speedMps != null && speedMps < 1.0) return false
  return true
}

export const rotCss = (x, y, deg) => {
  const c = Math.cos(rad(deg)), s = Math.sin(rad(deg))
  return [x * c - y * s, x * s + y * c]
}

/** container offset from pivot (px) -> screen offset from pivot (px). Matches
 *  CSS: perspective(P) rotateX(T) rotateZ(-M) scale(S), origin = pivot. */
export function planeToScreen(cx, cy, M, cfg = NAV_CFG) {
  const { tiltDeg: T, perspectivePx: P, scale: S } = cfg
  const [ux, uy] = rotCss(cx * S, cy * S, -M)
  const w = 1 - (uy * Math.sin(rad(T))) / P
  return w > 0 ? [ux / w, (uy * Math.cos(rad(T))) / w] : null
}

/** inverse of planeToScreen; null if the point is above the horizon. */
export function screenToPlane(X, Y, M, cfg = NAV_CFG) {
  const { tiltDeg: T, perspectivePx: P, scale: S } = cfg
  const den = Math.cos(rad(T)) + (Y * Math.sin(rad(T))) / P
  if (den <= 1e-6) return null
  const uy = Y / den
  const ux = X * (1 - (uy * Math.sin(rad(T))) / P)
  const [px, py] = rotCss(ux, uy, M)
  return [px / S, py / S]
}

/** Screen heading (deg clockwise from screen-up, pre-tilt) of a truck whose
 *  marker is rotated by R inside a container rotated by -M. */
export const screenHeading = (R, M) => normalizeDeg(R - M)

/** Pan (container px) that keeps the point under the finger fixed. */
export function dragToPanPx(startScreen, endScreen, M, cfg = NAV_CFG) {
  const a = screenToPlane(startScreen[0], startScreen[1], M, cfg)
  const b = screenToPlane(endScreen[0], endScreen[1], M, cfg)
  return a && b ? [a[0] - b[0], a[1] - b[1]] : null // pass to map.panBy(..., {animate:false})
}

/** Half-size (container px) of the square that covers the visible screen for
 *  ANY heading. topClipFrac = fraction of viewport height (from the top) that is
 *  deliberately faded out as haze and therefore does not need map coverage. */
export function requiredHalfSize(W, H, cfg = NAV_CFG, topClipFrac = 0) {
  const px = W / 2, py = cfg.pivotY * H
  const yTop = -py + topClipFrac * H
  let maxR = 0
  const n = 200
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const pts = [[-px + t * W, yTop], [-px + t * W, H - py], [-px, yTop + t * (H - py - yTop)], [px, yTop + t * (H - py - yTop)]]
    for (const [X, Y] of pts) {
      const p = screenToPlane(X, Y, 0, cfg)
      if (!p) return Infinity
      maxR = Math.max(maxR, Math.hypot(p[0], p[1]))
    }
  }
  return Math.ceil(maxR + 64) // 64px safety margin for sub-pixel + transition
}
