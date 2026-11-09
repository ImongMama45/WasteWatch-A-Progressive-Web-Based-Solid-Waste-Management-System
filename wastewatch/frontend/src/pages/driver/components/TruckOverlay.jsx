/**
 * TruckOverlay.jsx — WasteWatch 3D Collection Truck Overlay
 *
 * Implements raw Three.js rendering of the Lucena City waste collection truck
 * using the 'camion jugete.obj' and 'camion jugete.mtl' assets.
 *
 * Capabilities:
 * - Pure Three.js (no React Three Fiber, no paid mapping APIs)
 * - Transparent WebGL canvas overlay
 * - Corrected model centroid pivot and ground level alignment
 * - Supports both 2D top-down and 3D oblique perspective views
 * - Isolated test preview mode with interactive angle toggles for Gate 1 verification
 * - Device pixel ratio (DPR) capped at 2.0 to protect mobile GPU/battery
 * - Complete resource cleanup (geometry, material, animation frame, WebGL context)
 * - Strict zero-emoji compliance
 */

import React, { useEffect, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js'

// Centroid & ground offsets computed from geometry analysis of 'camion jugete.obj'
// Raw OBJ: X in [-0.1131, 0.1126], Y in [0.0069, 0.1951], Z in [-0.3117, 0.0924]
export const MODEL_CONFIG = {
  OBJ_PATH: '/models/camion jugete.obj',
  MTL_PATH: '/models/camion jugete.mtl',
  // Offset to center model centroid at (0, 0, 0) of pivot group
  OFFSET_X: 0.0,
  OFFSET_Y: -0.0069,   // align bottom tires to ground plane (Y = 0)
  OFFSET_Z: -0.1097,   // Centroid pivot offset (with base rotation PI)
  BASE_ROTATION_Y: Math.PI, // Cab points North (-Z in Leaflet/Three screen space)
  DIMENSIONS: {
    width: 0.2257,
    height: 0.1882,
    length: 0.4041,
  },
}

export default function TruckOverlay({
  // Operational props
  mode = '2D',                 // '2D' | '3D'
  heading = 0,                // travel heading in degrees [0, 360)
  mapHeading = 0,             // map rotation heading in degrees
  is3D = false,
  map = null,                 // Leaflet map instance (for Gate 2+)
  position = null,            // [lat, lng] (for Gate 2+)
  scale = 1.0,

  // Isolated test mode (Gate 1 verification)
  isolated = false,
  testView = 'oblique',       // 'top-down' | 'oblique' | 'front' | 'side'
  onLoad = null,
  onError = null,
  style = {},
}) {
  const containerRef = useRef(null)
  const canvasRef = useRef(null)

  // Internal Three.js references
  const sceneRef = useRef(null)
  const cameraRef = useRef(null)
  const rendererRef = useRef(null)
  const pivotGroupRef = useRef(null)
  const truckMeshRef = useRef(null)
  const animFrameRef = useRef(null)

  // State
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState(null)
  const [activeTestView, setActiveTestView] = useState(testView)
  const [turntableRotation, setTurntableRotation] = useState(0)

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. SETUP SCENE, LIGHTS & RENDERER
  // ─────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    // Scene
    const scene = new THREE.Scene()
    sceneRef.current = scene

    // Pivot group: holds the truck model and serves as rotation center
    const pivotGroup = new THREE.Group()
    scene.add(pivotGroup)
    pivotGroupRef.current = pivotGroup

    // Lighting (Calibrated for vibrant automotive finish without blowing out windows)
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.4)
    scene.add(ambientLight)

    const sunLight = new THREE.DirectionalLight(0xffffff, 2.0)
    sunLight.position.set(6, 12, 8)
    scene.add(sunLight)

    const fillLight = new THREE.DirectionalLight(0x93c5fd, 0.9) // cool sky fill
    fillLight.position.set(-6, 8, -6)
    scene.add(fillLight)

    const groundReflectLight = new THREE.DirectionalLight(0x64748b, 0.4) // road bounce
    groundReflectLight.position.set(0, -6, 0)
    scene.add(groundReflectLight)

    // Camera: Perspective camera for realistic depth perception
    const width = container.clientWidth || 300
    const height = container.clientHeight || 300
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.05, 50)
    cameraRef.current = camera

    // Renderer: Alpha enabled for transparent map background
    let renderer
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: 'high-performance',
      })
      renderer.setClearColor(0x000000, 0)
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
      renderer.setSize(width, height, false)
      rendererRef.current = renderer
    } catch (err) {
      console.error('[TruckOverlay] WebGL initialization failed:', err)
      setErrorMsg('WebGL not supported on this device')
      onError?.(err)
      return
    }

    // Resize handler
    const handleResize = () => {
      if (!containerRef.current || !rendererRef.current || !cameraRef.current) return
      const w = containerRef.current.clientWidth
      const h = containerRef.current.clientHeight
      if (w === 0 || h === 0) return
      cameraRef.current.aspect = w / h
      cameraRef.current.updateProjectionMatrix()
      rendererRef.current.setSize(w, h, false)
    }
    window.addEventListener('resize', handleResize)

    // ─────────────────────────────────────────────────────────────────────────────
    // 2. LOAD MTL & OBJ ASSETS
    // ─────────────────────────────────────────────────────────────────────────────
    setLoading(true)
    setErrorMsg(null)

    const mtlLoader = new MTLLoader()
    mtlLoader.load(
      MODEL_CONFIG.MTL_PATH,
      (materials) => {
        try {
          materials.preload()

          const objLoader = new OBJLoader()
          objLoader.setMaterials(materials)

          objLoader.load(
            MODEL_CONFIG.OBJ_PATH,
            (object) => {
              // Inspect and enhance materials
              object.traverse((child) => {
                if (child.isMesh) {
                  child.castShadow = false
                  child.receiveShadow = false
                  if (child.material) {
                    const mats = Array.isArray(child.material) ? child.material : [child.material]
                    mats.forEach((m) => {
                      m.side = THREE.DoubleSide
                      // Slightly lower roughness for gloss automotive cab paint
                      if (m.name === 'RedPaint' || m.name === 'RedPaint.001') {
                        if ('shininess' in m) m.shininess = 60
                      }
                      if (m.name === 'BlackWindow') {
                        if ('shininess' in m) m.shininess = 90
                      }
                    })
                  }
                }
              })

              // Rotate 180 deg around Y so Cab points forward (-Z / North)
              object.rotation.y = MODEL_CONFIG.BASE_ROTATION_Y

              // Center model relative to pivot group
              object.position.set(
                MODEL_CONFIG.OFFSET_X,
                MODEL_CONFIG.OFFSET_Y,
                MODEL_CONFIG.OFFSET_Z
              )

              truckMeshRef.current = object
              pivotGroup.add(object)
              setLoading(false)
              onLoad?.(object)
            },
            undefined,
            (err) => {
              console.error('[TruckOverlay] OBJ loading error:', err)
              setErrorMsg('Failed to load truck 3D OBJ file')
              setLoading(false)
              onError?.(err)
            }
          )
        } catch (err) {
          console.error('[TruckOverlay] Error preloading MTL:', err)
          setErrorMsg('Failed to process MTL materials')
          setLoading(false)
          onError?.(err)
        }
      },
      undefined,
      (err) => {
        console.error('[TruckOverlay] MTL loading error:', err)
        setErrorMsg('Failed to load truck MTL file')
        setLoading(false)
        onError?.(err)
      }
    )

    // ─────────────────────────────────────────────────────────────────────────────
    // 3. RENDER LOOP
    // ─────────────────────────────────────────────────────────────────────────────
    let running = true
    const render = () => {
      if (!running) return
      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current)
      }
      animFrameRef.current = requestAnimationFrame(render)
    }
    render()

    // ─────────────────────────────────────────────────────────────────────────────
    // 4. CLEANUP ON UNMOUNT (Rule 7, Gate 1 requirement 10)
    // ─────────────────────────────────────────────────────────────────────────────
    return () => {
      running = false
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current)
      }
      window.removeEventListener('resize', handleResize)

      // Traverse and dispose geometries and materials
      if (pivotGroupRef.current) {
        pivotGroupRef.current.traverse((child) => {
          if (child.isMesh) {
            child.geometry?.dispose()
            if (Array.isArray(child.material)) {
              child.material.forEach((m) => m.dispose())
            } else {
              child.material?.dispose()
            }
          }
        })
      }

      if (rendererRef.current) {
        rendererRef.current.dispose()
        rendererRef.current.forceContextLoss()
        rendererRef.current = null
      }
      sceneRef.current = null
      cameraRef.current = null
      pivotGroupRef.current = null
      truckMeshRef.current = null
    }
  }, [onLoad, onError])

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. CAMERA & ANGLE CONFIGURATION (Isolated Test & Operational Views)
  // ─────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const camera = cameraRef.current
    if (!camera) return

    if (isolated) {
      // Gate 1 isolated test views
      switch (activeTestView) {
        case 'top-down':
          // Pure Top-Down: Looking straight down +Y axis onto cab and cargo roof
          // With up=(0,0,-1): -Z is screen UP (North), +X is screen RIGHT (East)
          camera.position.set(0, 1.4, 0)
          camera.up.set(0, 0, -1)
          camera.lookAt(0, 0, 0)
          break

        case 'oblique':
          // 3D Oblique Chase-Cam: From behind (+Z) and above (+Y), looking forward toward front (-Z)
          camera.position.set(0, 0.85, 0.95)
          camera.up.set(0, 1, 0)
          camera.lookAt(0, 0.08, -0.15)
          break

        case 'front':
          // Front View: Looking directly at cab grille, headlights, and windshield from -Z
          camera.position.set(0, 0.25, -1.1)
          camera.up.set(0, 1, 0)
          camera.lookAt(0, 0.08, 0)
          break

        case 'side':
          // Side Profile: Looking at driver door, fuel tank, and compactor body from +X
          camera.position.set(1.2, 0.25, 0)
          camera.up.set(0, 1, 0)
          camera.lookAt(0, 0.08, 0)
          break

        default:
          camera.position.set(0, 0.85, 0.95)
          camera.up.set(0, 1, 0)
          camera.lookAt(0, 0.08, -0.15)
      }
    } else {
      // Live navigation mode:
      // When is3D is false (2D Top-Down): camera looks straight down
      // When is3D is true (3D Chase/Perspective): camera tilts to 50-degree oblique angle
      if (is3D || mode === '3D') {
        camera.position.set(0, 0.85, 0.95)
        camera.up.set(0, 1, 0)
        camera.lookAt(0, 0.08, -0.15)
      } else {
        camera.position.set(0, 1.4, 0)
        camera.up.set(0, 0, -1)
        camera.lookAt(0, 0, 0)
      }
    }
  }, [isolated, activeTestView, is3D, mode])

  // ─────────────────────────────────────────────────────────────────────────────
  // 6. ROTATION & PIVOT VERIFICATION
  // ─────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!pivotGroupRef.current) return
    if (isolated) {
      // In isolated test mode: use turntable rotation slider
      pivotGroupRef.current.rotation.y = (turntableRotation * Math.PI) / 180
    } else {
      // In map mode:
      // In 2D Top-Down mode: vehicle points along travel heading
      // In 3D Course-Up mode: map container is rotated by -mapHeading, so vehicle rotation
      // aligns forward to screen top
      const rad = (((is3D ? mapHeading : heading) || 0) * Math.PI) / 180
      pivotGroupRef.current.rotation.y = -rad // Three.js Y-rotation is counter-clockwise
    }
  }, [isolated, turntableRotation, heading, mapHeading, is3D])

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        pointerEvents: isolated ? 'auto' : 'none',
        ...style,
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          pointerEvents: 'none',
        }}
      />

      {/* Loading Indicator */}
      {loading && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: isolated ? 'rgba(15, 23, 42, 0.7)' : 'transparent',
            color: '#38bdf8',
            fontFamily: 'sans-serif',
            fontSize: 12,
            fontWeight: 700,
            gap: 8,
          }}
        >
          <div
            style={{
              width: 14,
              height: 14,
              border: '2px solid rgba(56, 189, 248, 0.3)',
              borderTopColor: '#38bdf8',
              borderRadius: '50%',
              animation: 'ww3dSpin 0.8s linear infinite',
            }}
          />
          <span>Loading 3D Truck Model...</span>
          <style>{`@keyframes ww3dSpin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* Error Fallback */}
      {errorMsg && (
        <div
          style={{
            position: 'absolute',
            bottom: 8,
            left: 8,
            right: 8,
            background: 'rgba(239, 68, 68, 0.9)',
            color: '#fff',
            padding: '6px 12px',
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 600,
            textAlign: 'center',
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
          }}
        >
          {errorMsg}
        </div>
      )}

      {/* Isolated Mode UI Controls (For Gate 1 visual verification) */}
      {isolated && !loading && !errorMsg && (
        <div
          style={{
            position: 'absolute',
            bottom: 12,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(15, 23, 42, 0.92)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            borderRadius: 12,
            padding: '8px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            backdropFilter: 'blur(8px)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            color: '#fff',
            fontFamily: 'sans-serif',
            fontSize: 11,
            zIndex: 100,
          }}
        >
          {/* Camera View Angle Buttons */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ color: '#94a3b8', fontWeight: 600, marginRight: 2 }}>View:</span>
            {[
              { id: 'oblique', label: '3D Oblique' },
              { id: 'top-down', label: '2D Top-Down' },
              { id: 'front', label: 'Front' },
              { id: 'side', label: 'Side' },
            ].map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setActiveTestView(v.id)}
                style={{
                  background: activeTestView === v.id ? '#16a34a' : 'rgba(255, 255, 255, 0.08)',
                  border: activeTestView === v.id ? '1px solid #22c55e' : '1px solid rgba(255, 255, 255, 0.1)',
                  color: '#fff',
                  borderRadius: 6,
                  padding: '3px 8px',
                  fontSize: 10,
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {v.label}
              </button>
            ))}
          </div>

          {/* Pivot & Turntable Rotation Slider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: '#94a3b8', fontWeight: 600, minWidth: 50 }}>
              Rotate: {turntableRotation}°
            </span>
            <input
              type="range"
              min="0"
              max="360"
              value={turntableRotation}
              onChange={(e) => setTurntableRotation(Number(e.target.value))}
              style={{ width: 140, cursor: 'pointer' }}
            />
            <button
              type="button"
              onClick={() => setTurntableRotation(0)}
              style={{
                background: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#94a3b8',
                borderRadius: 4,
                padding: '2px 6px',
                fontSize: 9,
                cursor: 'pointer',
              }}
            >
              Reset
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
