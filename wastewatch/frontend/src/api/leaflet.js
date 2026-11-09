/**
 * api/leaflet.js — singleton Leaflet loader
 *
 * Guarantees the CSS is always injected alongside the script (MiniMap only
 * loads the JS, so it silently renders broken on a cold load).
 *
 * Usage:
 *   import { loadLeaflet } from '../api/leaflet'
 *   loadLeaflet().then(L => { ... })
 */

const LEAFLET_VERSION = '1.9.4'
const CSS_ID = 'leaflet-css'
const CSS_URL = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.css`
const JS_URL  = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.js`

let pending = null

export const loadLeaflet = () => {
  if (window.L) return Promise.resolve(window.L)
  if (pending) return pending

  pending = new Promise((resolve, reject) => {
    // Inject CSS first (idempotent)
    if (!document.getElementById(CSS_ID)) {
      const link = document.createElement('link')
      link.id   = CSS_ID
      link.rel  = 'stylesheet'
      link.href = CSS_URL
      document.head.appendChild(link)
    }

    // Inject JS
    const script = document.createElement('script')
    script.src = JS_URL
    script.onload = () => resolve(window.L)
    script.onerror = (e) => {
      pending = null  // allow retry on next call
      reject(e)
    }
    document.head.appendChild(script)
  })

  return pending
}
