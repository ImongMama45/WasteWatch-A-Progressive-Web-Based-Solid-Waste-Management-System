import { useState, useEffect } from 'react'

export function useLeaflet() {
  const [mapReady, setMapReady] = useState(false)
  const [mapError, setMapError] = useState(false)

  useEffect(() => {
    let cancelled = false;

    if (window.L) {
      setMapReady(true)
      return
    }

    const existingScript = document.getElementById('leaflet-script')
    if (existingScript) {
      const handleLoad = () => { if (!cancelled) setMapReady(true) }
      const handleError = () => { if (!cancelled) setMapError(true) }
      existingScript.addEventListener('load', handleLoad)
      existingScript.addEventListener('error', handleError)
      return () => {
        cancelled = true;
        existingScript.removeEventListener('load', handleLoad)
        existingScript.removeEventListener('error', handleError)
      }
    }

    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
    document.head.appendChild(link)

    const script = document.createElement('script')
    script.id = 'leaflet-script'
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
    script.async = true
    
    script.onload = () => {
      if (!cancelled) setMapReady(true)
    }
    script.onerror = () => {
      console.error('Failed to load Leaflet from CDN')
      if (!cancelled) setMapError(true)
    }

    document.body.appendChild(script)

    return () => {
      cancelled = true;
    }
  }, [])

  return { mapReady, mapError }
}
