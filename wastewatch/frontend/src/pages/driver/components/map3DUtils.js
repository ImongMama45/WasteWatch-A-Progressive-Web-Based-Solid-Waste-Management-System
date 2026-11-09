/**
 * map3DUtils.js
 * Utilities for 3D Course-Up Navigation, heading calculation,
 * smooth angular unwrapping, and 3D vehicle avatar generation for WasteWatch.
 * Strict zero-emoji compliance.
 */

/**
 * Calculates initial bearing between two geographic coordinates in degrees [0, 360).
 */
export function calculateBearing(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return 0
  const toRad = deg => (deg * Math.PI) / 180
  const toDeg = rad => (rad * 180) / Math.PI

  const dLon = toRad(lon2 - lon1)
  const y = Math.sin(dLon) * Math.cos(toRad(lat2))
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon)
  const brng = toDeg(Math.atan2(y, x))
  return (brng + 360) % 360
}

/**
 * Prevents full 360-degree reverse spins when crossing 0°/360° boundary.
 * Returns continuous angle target.
 */
export function getShortestAngle(current, target) {
  let diff = (target - current) % 360
  if (diff > 180) diff -= 360
  if (diff < -180) diff += 360
  return current + diff
}

/**
 * Generates an ultra high-fidelity 3D Chase-Perspective Waste Collection Truck SVG string.
 * Modeled after the 3D third-person vehicle visualization seen in Google Maps navigation:
 * - Viewed from behind and slightly above (chase-cam)
 * - 3D perspective foreshortening (narrower front cab, wider rear compactor)
 * - Dual glowing red taillights & rear safety chevron bumper
 * - Waste compactor hopper & roof ribs
 * - Front windshield specular reflection & twin amber strobe beacons
 * - Soft ground drop shadow and forward road illumination
 */
export function get3DVehicleSvgHtml(heading = 0, is3D = false, mapHeading = 0) {
  // In 3D Course-Up mode, the map container is rotated by -mapHeading.
  // The vehicle inside the map MUST have rotation +mapHeading so that:
  // -mapHeading + mapHeading = 0deg (always pointing straight forward/UP on the screen, like Google Maps).
  // In 2D North-Up mode, the vehicle rotates to its travel heading.
  const rotation = is3D ? (mapHeading ?? heading ?? 0) : (heading ?? 0)
  return `
    <div class="ww-3d-truck-wrapper" style="
      width: 64px;
      height: 84px;
      transform: rotate(${rotation}deg);
      transform-origin: 32px 54px;
      transition: transform 0.45s cubic-bezier(0.2, 0.8, 0.2, 1);
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
    ">
      <svg viewBox="0 -24 64 88" width="64" height="88" xmlns="http://www.w3.org/2000/svg" style="overflow: visible;">
        <defs>
          <!-- Forward Headlight Road Glow -->
          <linearGradient id="wwBeam3D" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stop-color="rgba(254, 240, 138, 0.55)" />
            <stop offset="45%" stop-color="rgba(253, 224, 71, 0.2)" />
            <stop offset="100%" stop-color="rgba(254, 240, 138, 0)" />
          </linearGradient>

          <!-- 3D Compactor Roof Surface (sunlight from top-left receding forward) -->
          <linearGradient id="wwCompactorRoof" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#22c55e" />
            <stop offset="35%" stop-color="#16a34a" />
            <stop offset="100%" stop-color="#15803d" />
          </linearGradient>

          <!-- 3D Side Walls (shadowed in perspective) -->
          <linearGradient id="wwWallLeft" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#14532d" />
            <stop offset="100%" stop-color="#166534" />
          </linearGradient>

          <linearGradient id="wwWallRight" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#166534" />
            <stop offset="100%" stop-color="#0f3e20" />
          </linearGradient>

          <!-- Rear Tailgate Face -->
          <linearGradient id="wwRearFace" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#166534" />
            <stop offset="60%" stop-color="#15803d" />
            <stop offset="100%" stop-color="#14532d" />
          </linearGradient>

          <!-- 3D Cab Windshield Reflection -->
          <linearGradient id="wwWindshield3D" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#0284c7" />
            <stop offset="40%" stop-color="#38bdf8" />
            <stop offset="100%" stop-color="#e0f2fe" />
          </linearGradient>

          <!-- Red Taillight Glow Filter -->
          <filter id="wwRedGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          <!-- Ground Contact Shadow -->
          <filter id="wwGroundShadow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3.5" />
          </filter>
        </defs>

        <!-- 1. FORWARD ILLUMINATION BEAMS (Shooting forward onto asphalt) -->
        <g opacity="${is3D ? '0.9' : '0.65'}">
          <polygon points="23,4 12,-22 28,-22 26,4" fill="url(#wwBeam3D)" />
          <polygon points="41,4 36,-22 52,-22 44,4" fill="url(#wwBeam3D)" />
        </g>

        <!-- 2. REALISTIC GROUND DROP SHADOW (Positioned beneath rear tires & chassis) -->
        <ellipse cx="32" cy="54" rx="23" ry="9" fill="rgba(15, 23, 42, 0.55)" filter="url(#wwGroundShadow)" />

        <!-- 3. TIRES (Visible on sides with 3D perspective foreshortening) -->
        <!-- Front Tires (receding, smaller) -->
        <rect x="15" y="10" width="4" height="11" rx="2" fill="#0f172a" />
        <rect x="45" y="10" width="4" height="11" rx="2" fill="#0f172a" />
        <!-- Rear Tires (closer to camera, heavier rubber) -->
        <rect x="10" y="38" width="6" height="16" rx="3" fill="#0f172a" />
        <rect x="48" y="38" width="6" height="16" rx="3" fill="#0f172a" />
        <!-- Rear Tire Rims -->
        <rect x="10" y="43" width="2" height="6" rx="1" fill="#475569" />
        <rect x="52" y="43" width="2" height="6" rx="1" fill="#475569" />

        <!-- 4. CHASSIS UNDERCARRIAGE -->
        <rect x="15" y="48" width="34" height="7" rx="2" fill="#0f172a" />

        <!-- 5. FRONT CAB (Narrower at top in 3D perspective) -->
        <g id="front-cab-3d">
          <!-- Cab Roof -->
          <polygon points="22,14 24,5 40,5 42,14" fill="#15803d" stroke="#14532d" stroke-width="0.75" />
          <!-- Aerodynamic Windshield Visor -->
          <polygon points="24,5 26,2 38,2 40,5" fill="url(#wwWindshield3D)" />
          <line x1="28" y1="2.5" x2="31" y2="4.5" stroke="#ffffff" stroke-width="0.8" opacity="0.8" />
          
          <!-- Twin Amber Safety Strobe Beacons on Roof -->
          <rect x="24" y="3" width="4.5" height="2.5" rx="1.2" fill="#f59e0b" stroke="#d97706" stroke-width="0.4" />
          <circle cx="26.2" cy="4.2" r="0.9" fill="#fef08a" />
          
          <rect x="35.5" y="3" width="4.5" height="2.5" rx="1.2" fill="#f59e0b" stroke="#d97706" stroke-width="0.4" />
          <circle cx="37.7" cy="4.2" r="0.9" fill="#fef08a" />

          <!-- Side Mirrors -->
          <polygon points="19,8 14,9 14,12 19,10" fill="#334155" />
          <polygon points="45,8 50,9 50,12 45,10" fill="#334155" />
        </g>

        <!-- 6. 3D WASTE COMPACTOR BODY -->
        <g id="compactor-body-3d">
          <!-- Top Roof Surface (trapezoid receding forward into perspective) -->
          <polygon points="20,14 15,26 49,26 44,14" fill="url(#wwCompactorRoof)" stroke="#166534" stroke-width="0.6" />
          
          <!-- 3D Roof Structural Ribs -->
          <line x1="22" y1="16" x2="17" y2="25" stroke="#86efac" stroke-width="1.2" opacity="0.6" />
          <line x1="32" y1="14.5" x2="32" y2="25.5" stroke="#86efac" stroke-width="1.2" opacity="0.7" />
          <line x1="42" y1="16" x2="47" y2="25" stroke="#86efac" stroke-width="1.2" opacity="0.6" />

          <!-- Left 3D Side Wall -->
          <polygon points="15,26 13,50 16,50 18,26" fill="url(#wwWallLeft)" />
          
          <!-- Right 3D Side Wall -->
          <polygon points="49,26 46,26 48,50 51,50" fill="url(#wwWallRight)" />

          <!-- Main Rear Compactor Face (facing camera) -->
          <rect x="15" y="26" width="34" height="24" rx="3" fill="url(#wwRearFace)" stroke="#0f3e20" stroke-width="0.75" />

          <!-- Compactor Beveled Upper Lip -->
          <rect x="17" y="27" width="30" height="2" rx="1" fill="#4ade80" opacity="0.75" />

          <!-- Hydraulic Compactor Lifter Arms (Left and Right) -->
          <rect x="16.5" y="32" width="2.5" height="15" rx="1.2" fill="#334155" stroke="#1e293b" stroke-width="0.5" />
          <rect x="17" y="35" width="1.5" height="6" rx="0.7" fill="#94a3b8" />

          <rect x="45" y="32" width="2.5" height="15" rx="1.2" fill="#334155" stroke="#1e293b" stroke-width="0.5" />
          <rect x="45.5" y="35" width="1.5" height="6" rx="0.7" fill="#94a3b8" />

          <!-- Central WasteWatch Leaf Emblem on Tailgate -->
          <circle cx="32" cy="36" r="4.5" fill="#14532d" opacity="0.6" />
          <path d="M32,33 C34,33 35.5,34.5 35.5,36.5 C35.5,38.5 33.5,39 32,39 C30.5,39 28.5,38.5 28.5,36.5 C28.5,34.5 30,33 32,33 Z" fill="#ffffff" opacity="0.9" />
          <line x1="32" y1="34" x2="32" y2="38" stroke="#14532d" stroke-width="0.8" />

          <!-- Fleet ID Label (Lucena City Truck) -->
          <rect x="27.5" y="42" width="9" height="3" rx="0.8" fill="#0f172a" />
          <text x="32" y="44.2" font-size="2.2" font-weight="900" fill="#22c55e" text-anchor="middle" font-family="sans-serif">WW-01</text>
        </g>

        <!-- 7. REAR BUMPER & SAFETY CHEVRONS -->
        <g id="rear-bumper">
          <!-- Heavy-duty Bumper Base -->
          <rect x="14" y="47.5" width="36" height="5.5" rx="1.5" fill="#1e293b" stroke="#0f172a" stroke-width="0.5" />
          
          <!-- Diagonal Warning Chevrons (Yellow & Black stripes) -->
          <rect x="17" y="48.5" width="3.5" height="3.5" fill="#eab308" />
          <line x1="17" y1="52" x2="20.5" y2="48.5" stroke="#0f172a" stroke-width="1.2" />

          <rect x="23" y="48.5" width="3.5" height="3.5" fill="#eab308" />
          <line x1="23" y1="52" x2="26.5" y2="48.5" stroke="#0f172a" stroke-width="1.2" />

          <rect x="37.5" y="48.5" width="3.5" height="3.5" fill="#eab308" />
          <line x1="41" y1="52" x2="37.5" y2="48.5" stroke="#0f172a" stroke-width="1.2" />

          <rect x="43.5" y="48.5" width="3.5" height="3.5" fill="#eab308" />
          <line x1="47" y1="52" x2="43.5" y2="48.5" stroke="#0f172a" stroke-width="1.2" />

          <!-- Center License Plate -->
          <rect x="29" y="48.5" width="6" height="3.5" rx="0.5" fill="#ffffff" stroke="#94a3b8" stroke-width="0.3" />
          <rect x="30" y="49.5" width="4" height="1.5" fill="#1e293b" />
        </g>

        <!-- 8. VIBRANT 3D REAR TAILLIGHTS (Like Google Maps vehicle!) -->
        <g id="rear-taillights" filter="url(#wwRedGlow)">
          <!-- Left Taillight -->
          <rect x="15" y="42" width="4" height="4.5" rx="1.2" fill="#ef4444" stroke="#b91c1c" stroke-width="0.5" />
          <circle cx="16.5" cy="43.5" r="1.2" fill="#fee2e2" />

          <!-- Right Taillight -->
          <rect x="45" y="42" width="4" height="4.5" rx="1.2" fill="#ef4444" stroke="#b91c1c" stroke-width="0.5" />
          <circle cx="47.5" cy="43.5" r="1.2" fill="#fee2e2" />
        </g>
      </svg>
    </div>`
}

/**
 * Creates or updates a Leaflet divIcon with the 3D vehicle avatar.
 */
export function create3DVehicleIcon(L, heading = 0, is3D = false, mapHeading = 0) {
  if (!L) return null
  return L.divIcon({
    html: get3DVehicleSvgHtml(heading, is3D, mapHeading),
    className: 'ww-3d-vehicle-marker',
    iconSize: [64, 84],
    iconAnchor: [32, 54],
  })
}

/**
 * Stage 2B Prototype: Creates a Leaflet divIcon using authentic 3D-derived truck sprites.
 * - In 2D Top-Down Mode: truck-topdown.webp (orthographic, 56x56, center anchor [28, 28]).
 * - In 3D Navigation Mode: truck-chase.webp (with billboarding) or truck-topdown.webp.
 * - Fallback: Automatic onerror fallback to the verified SVG marker if image loading fails.
 */
export function createTruckSpriteIcon(L, heading = 0, is3D = false, mapHeading = 0, options = {}) {
  if (!L) return null
  const {
    forceSvg = false,
    useChaseIn3D = false,
    topdownSrc = '/models/truck-topdown.webp',
    chaseSrc = '/models/truck-chase.webp',
  } = options

  if (forceSvg) {
    return create3DVehicleIcon(L, heading, is3D, mapHeading)
  }

  const useChase = is3D && useChaseIn3D
  const imgSrc = useChase ? chaseSrc : topdownSrc

  // Scaled to 56x56 px on screen for responsive driver readability
  const size = [56, 56]
  // Top-down anchor is center [28, 28]. Chase anchor is ground axle baseline [28, 40] (72%)
  const anchor = useChase ? [28, 40] : [28, 28]
  const originStr = useChase ? '28px 40px' : '28px 28px'

  // Heading calculation: in 3D course-up mode, map container has rotateZ(-mapHeading).
  // Vehicle rotates by +mapHeading so net screen heading points forward.
  const rotation = is3D ? (mapHeading ?? heading ?? 0) : (heading ?? 0)

  // Inner transform:
  // In 3D mode with chase sprite, billboarding counter-tilts with rotateX(-50deg)
  const innerTransform = useChase
    ? `transform: rotate(${rotation}deg) rotateX(-50deg); transform-origin: ${originStr}; transform-style: preserve-3d;`
    : `transform: rotate(${rotation}deg); transform-origin: ${originStr};`

  // Inline fallback SVG if image network error or 404 occurs
  const fallbackSvgEscaped = encodeURIComponent(get3DVehicleSvgHtml(heading, is3D, mapHeading))

  const html = `
    <div class="ww-truck-sprite-wrapper" style="
      width: ${size[0]}px;
      height: ${size[1]}px;
      ${innerTransform}
      transition: transform 0.45s cubic-bezier(0.2, 0.8, 0.2, 1);
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
    ">
      <img
        src="${imgSrc}"
        width="${size[0]}"
        height="${size[1]}"
        alt="WasteWatch Truck"
        style="display: block; width: 100%; height: 100%; object-fit: contain; pointer-events: none;"
        onerror="this.onerror=null; this.parentElement.innerHTML = decodeURIComponent('${fallbackSvgEscaped}');"
      />
    </div>
  `

  return L.divIcon({
    html,
    className: 'ww-truck-sprite-marker',
    iconSize: size,
    iconAnchor: anchor,
  })
}
