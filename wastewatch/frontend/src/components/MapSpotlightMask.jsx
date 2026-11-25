import React, { useEffect, useState, useMemo } from 'react'

/**
 * MapSpotlightMask
 * ----------------
 * Darkens the entire map surroundings while keeping a focused spotlight cutout
 * on a selected stop, hotspot, or report.
 *
 * Smoothly updates with map pan/zoom events using Leaflet's latLngToContainerPoint.
 * Non-blocking: pointer-events: none allows map panning and marker clicking.
 */
export default function MapSpotlightMask({ map, target }) {
  const [point, setPoint] = useState(null)

  useEffect(() => {
    if (!map || !target || target.lat == null || target.lng == null) {
      setPoint(null)
      return
    }

    const lat = Number(target.lat)
    const lng = Number(target.lng)
    if (isNaN(lat) || isNaN(lng)) {
      setPoint(null)
      return
    }

    let animId = null
    const updatePoint = () => {
      if (animId) cancelAnimationFrame(animId)
      animId = requestAnimationFrame(() => {
        try {
          const pt = map.latLngToContainerPoint([lat, lng])
          setPoint({ x: Math.round(pt.x), y: Math.round(pt.y) })
        } catch {
          setPoint(null)
        }
      })
    }

    updatePoint()

    map.on('move', updatePoint)
    map.on('zoom', updatePoint)
    map.on('viewreset', updatePoint)
    map.on('resize', updatePoint)

    return () => {
      if (animId) cancelAnimationFrame(animId)
      map.off('move', updatePoint)
      map.off('zoom', updatePoint)
      map.off('viewreset', updatePoint)
      map.off('resize', updatePoint)
    }
  }, [map, target?.lat, target?.lng])

  const maskId = useMemo(() => {
    if (!target) return 'spotlight-mask-default'
    return `spotlight-mask-${Math.round((Number(target.lat) || 0) * 10000)}-${Math.round((Number(target.lng) || 0) * 10000)}`
  }, [target?.lat, target?.lng])

  const gradId = useMemo(() => {
    if (!target) return 'spotlight-grad-default'
    return `spotlight-grad-${Math.round((Number(target.lat) || 0) * 10000)}-${Math.round((Number(target.lng) || 0) * 10000)}`
  }, [target?.lat, target?.lng])

  if (!point || !target) return null

  const radius = target.radius || 85
  const color = target.color || '#38bdf8'

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 550, // Between base tile overlays and popups/modals
        overflow: 'hidden',
        transition: 'opacity 0.25s ease-in-out',
      }}
      aria-hidden="true"
    >
      <svg
        width="100%"
        height="100%"
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
        }}
      >
        <defs>
          <radialGradient id={gradId} cx="50%" cy="50%" r="50%">
            {/* Center: black in mask creates complete transparency */}
            <stop offset="0%" stopColor="#000000" stopOpacity="1" />
            <stop offset="55%" stopColor="#000000" stopOpacity="0.9" />
            <stop offset="80%" stopColor="#000000" stopOpacity="0.35" />
            {/* Edge: white in mask keeps the dark overlay solid */}
            <stop offset="100%" stopColor="#ffffff" stopOpacity="1" />
          </radialGradient>

          <mask id={maskId}>
            {/* White background: overlay shows everywhere */}
            <rect width="100%" height="100%" fill="#ffffff" />
            {/* Cutout hole at target coords */}
            <circle
              cx={point.x}
              cy={point.y}
              r={radius}
              fill={`url(#${gradId})`}
            />
          </mask>
        </defs>

        {/* Ambient Darkened Backdrop Layer */}
        <rect
          width="100%"
          height="100%"
          fill="rgba(8, 12, 22, 0.72)"
          mask={`url(#${maskId})`}
        />

        {/* Subtle decorative pulsing halo rings around the target marker */}
        <circle
          cx={point.x}
          cy={point.y}
          r={radius * 0.42}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeDasharray="4 4"
          opacity="0.8"
        >
          <animateTransform
            attributeName="transform"
            type="rotate"
            from={`0 ${point.x} ${point.y}`}
            to={`360 ${point.x} ${point.y}`}
            dur="14s"
            repeatCount="indefinite"
          />
        </circle>
        <circle
          cx={point.x}
          cy={point.y}
          r={radius * 0.8}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          opacity="0.4"
        />
      </svg>
    </div>
  )
}

