/**
 * MapLayerToggle.jsx — Google Maps-style Layer Switcher
 *
 * Toggles between Default (OpenStreetMap) and Satellite (Google Maps Hybrid with roads & labels).
 */

import { Layers } from 'lucide-react'

export const MAP_LAYERS = {
  default: {
    id: 'default',
    name: 'Default',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    options: {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    },
    thumbnail: 'https://a.tile.openstreetmap.org/14/13745/7468.png',
  },
  satellite: {
    id: 'satellite',
    name: 'Satellite',
    url: 'https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
    options: {
      subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
      maxZoom: 20,
      attribution: '© Google Maps Satellite',
    },
    thumbnail: 'https://mt1.google.com/vt/lyrs=y&x=13745&y=7468&z=14',
  },
}

export function applyMapTileLayer(map, mapType, currentLayerRef) {
  if (!map || !window.L) return null
  const L = window.L
  const target = MAP_LAYERS[mapType] || MAP_LAYERS.default

  if (currentLayerRef && currentLayerRef.current) {
    try {
      map.removeLayer(currentLayerRef.current)
    } catch {
      // ignore if already removed
    }
  }

  const layer = L.tileLayer(target.url, target.options)
  layer.addTo(map)
  if (typeof layer.bringToBack === 'function') {
    layer.bringToBack()
  }

  if (currentLayerRef) {
    currentLayerRef.current = layer
  }
  return layer
}

export default function MapLayerToggle({
  mapType = 'default',
  onToggle,
  style = {},
  size = 52,
}) {
  const nextType = mapType === 'default' ? 'satellite' : 'default'
  const nextMeta = MAP_LAYERS[nextType]

  return (
    <button
      type="button"
      onClick={onToggle}
      title={`Switch to ${nextMeta.name} View`}
      style={{
        width: size,
        height: size,
        borderRadius: 10,
        border: '2px solid #ffffff',
        boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
        backgroundImage: `url(${nextMeta.thumbnail})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        cursor: 'pointer',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        padding: 0,
        transition: 'transform 0.15s ease, box-shadow 0.15s ease, bottom 0.35s cubic-bezier(0.3, 0.8, 0.3, 1)',
        userSelect: 'none',
        flexShrink: 0,
        ...style,
      }}
      onMouseDown={e => (e.currentTarget.style.transform = 'scale(0.94)')}
      onMouseUp={e => (e.currentTarget.style.transform = 'scale(1)')}
    >
      <div
        style={{
          background: 'rgba(15, 23, 42, 0.88)',
          backdropFilter: 'blur(4px)',
          color: '#ffffff',
          fontSize: 9,
          fontWeight: 800,
          letterSpacing: '.05em',
          padding: '2px 0',
          width: '100%',
          textAlign: 'center',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 3,
          textTransform: 'uppercase',
        }}
      >
        <Layers size={10} />
        <span>{nextMeta.name}</span>
      </div>
    </button>
  )
}

