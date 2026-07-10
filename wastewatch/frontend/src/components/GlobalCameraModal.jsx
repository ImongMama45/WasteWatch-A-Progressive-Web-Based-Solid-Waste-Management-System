/**
 * GlobalCameraModal.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * A general-purpose camera overlay for all roles to capture report photos.
 * 
 * PROPS:
 *   visible    {boolean}
 *   onCapture  {(blob, previewUrl) => void}
 *   onClose    {() => void}
 */

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

export default function GlobalCameraModal({
  visible,
  onCapture,
  onClose,
}) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)

  const [cameraPhase, setCameraPhase] = useState('idle') // idle | starting | live | captured | error
  const [cameraError, setCameraError] = useState('')
  const [photoPreview, setPhotoPreview] = useState(null)
  const [capturedBlob, setCapturedBlob] = useState(null)
  const [shutterFlash, setShutterFlash] = useState(false)

  useEffect(() => {
    if (!visible) {
      stopCamera()
      resetState()
      return
    }
    startCamera()
    return () => stopCamera()
  }, [visible])

  function stopCamera() {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }

  function resetState() {
    setCameraPhase('idle')
    setCameraError('')
    setPhotoPreview(null)
    setCapturedBlob(null)
    setShutterFlash(false)
  }

  async function startCamera() {
    setCameraPhase('starting')
    setCameraError('')
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error('Camera not supported on this device.')
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => { })
      }
      setCameraPhase('live')
    } catch (err) {
      setCameraError(err?.message || 'Camera access denied.')
      setCameraPhase('error')
    }
  }

  async function handleCapture() {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || cameraPhase !== 'live') return

    canvas.width = video.videoWidth || 1280
    canvas.height = video.videoHeight || 720
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)

    setShutterFlash(true)
    setTimeout(() => setShutterFlash(false), 200)

    const blob = await new Promise((res, rej) =>
      canvas.toBlob(b => (b ? res(b) : rej(new Error('Capture failed.'))), 'image/jpeg', 0.92)
    )

    const previewUrl = URL.createObjectURL(blob)
    setPhotoPreview(previewUrl)
    setCapturedBlob(blob)
    setCameraPhase('captured')

    stopCamera()
  }

  function handleRetake() {
    if (photoPreview) URL.revokeObjectURL(photoPreview)
    setPhotoPreview(null)
    setCapturedBlob(null)
    setCameraPhase('starting')
    startCamera()
  }

  function handleUsePhoto() {
    if (!capturedBlob || !photoPreview) return
    onCapture?.(capturedBlob, photoPreview)
  }

  function handleClose() {
    stopCamera()
    resetState()
    onClose?.()
  }

  if (!visible) return null

  const isLive = cameraPhase === 'live'
  const isCaptured = cameraPhase === 'captured'
  const isError = cameraPhase === 'error'

  return createPortal(
    <>
      <style>{`
        @keyframes gcm-slide-up {
          from { opacity:0; transform:translateY(24px); }
          to   { opacity:1; transform:translateY(0); }
        }
        @keyframes gcm-fade-in  { from { opacity:0; } to { opacity:1; } }
        @keyframes gcm-shutter  { 0% { opacity:0.95; } 100% { opacity:0; } }
        @keyframes gcm-spin     { to { transform:rotate(360deg); } }
      `}</style>

      {/* Backdrop */}
      <div onClick={handleClose} style={{
        position: 'fixed', inset: 0, zIndex: 99998,
        background: 'rgba(5,10,20,0.85)', backdropFilter: 'blur(6px)',
        animation: 'gcm-fade-in .2s ease',
      }} />

      {/* Modal sheet - responsive flex container */}
      <div style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, top: 0, zIndex: 99999,
        display: 'flex', flexDirection: 'column',
        animation: 'gcm-slide-up .3s cubic-bezier(.32,.72,0,1)',
      }}>

        {/* Top Spacer / Header Area */}
        <div style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 800, letterSpacing: '.1em', color: 'rgba(255,255,255,0.6)', marginBottom: 2 }}>
              REPORT PHOTO
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#fff' }}>
              Capture Issue
            </div>
          </div>
          <button onClick={handleClose} style={{
            width: 40, height: 40, borderRadius: '50%',
            background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)',
            color: 'rgba(255,255,255,0.9)', fontSize: 18, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background 0.2s',
          }}>✕</button>
        </div>

        {/* Viewfinder (Flex 1 to take available space) */}
        <div style={{
          position: 'relative',
          width: '100%',
          flex: 1,
          background: '#000',
          borderRadius: '16px 16px 0 0',
          overflow: 'hidden'
        }}>
          <video ref={videoRef} muted playsInline autoPlay style={{
            width: '100%', height: '100%', objectFit: 'cover', display: 'block',
            opacity: isLive ? 1 : 0, transition: 'opacity .3s',
          }} />

          {photoPreview && (
            <img src={photoPreview} alt="Captured preview" style={{
              position: 'absolute', inset: 0,
              width: '100%', height: '100%', objectFit: 'cover',
              animation: 'gcm-fade-in .25s ease',
            }} />
          )}

          <canvas ref={canvasRef} style={{ display: 'none' }} />

          {shutterFlash && (
            <div style={{
              position: 'absolute', inset: 0, background: '#fff',
              animation: 'gcm-shutter .2s ease forwards', pointerEvents: 'none',
            }} />
          )}

          {(cameraPhase === 'starting' || cameraPhase === 'idle') && !photoPreview && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 12,
              background: 'rgba(13,17,23,0.85)',
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: '50%',
                border: '3px solid rgba(255,255,255,0.15)', borderTopColor: '#16a34a',
                animation: 'gcm-spin 1s linear infinite',
              }} />
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', fontWeight: 600 }}>
                Accessing camera…
              </span>
            </div>
          )}

          {isError && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 12,
              background: 'rgba(13,17,23,0.9)', padding: '0 24px',
            }}>
              <span style={{ fontSize: 36 }}>📵</span>
              <div style={{ fontSize: 14, color: '#fca5a5', textAlign: 'center', fontWeight: 600, lineHeight: 1.5 }}>
                {cameraError}
              </div>
              <button onClick={startCamera} style={{
                marginTop: 12, padding: '12px 28px', borderRadius: 24,
                background: '#16a34a', border: 'none', color: '#fff',
                fontSize: 14, fontWeight: 700, cursor: 'pointer',
              }}>Try again</button>
            </div>
          )}

          {/* Viewfinder guides */}
          {isLive && (
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
              {[
                { top: 24, left: 24 }, { top: 24, right: 24 },
                { bottom: 24, left: 24 }, { bottom: 24, right: 24 },
              ].map((pos, i) => (
                <div key={i} style={{
                  position: 'absolute', width: 24, height: 24, ...pos,
                  borderTop: pos.top != null ? '3px solid rgba(255,255,255,0.7)' : 'none',
                  borderBottom: pos.bottom != null ? '3px solid rgba(255,255,255,0.7)' : 'none',
                  borderLeft: pos.left != null ? '3px solid rgba(255,255,255,0.7)' : 'none',
                  borderRight: pos.right != null ? '3px solid rgba(255,255,255,0.7)' : 'none',
                  borderRadius: i === 0 ? '4px 0 0 0' : i === 1 ? '0 4px 0 0' : i === 2 ? '0 0 0 4px' : '0 0 4px 0',
                }} />
              ))}
              <div style={{
                position: 'absolute', top: '50%', left: '50%',
                width: 10, height: 10, marginTop: -5, marginLeft: -5,
                borderRadius: '50%', background: 'rgba(255,255,255,0.6)',
              }} />
            </div>
          )}
        </div>

        {/* Bottom controls panel */}
        <div style={{
          padding: '24px 24px 40px',
          background: '#0d1117',
          flexShrink: 0
        }}>
          {isCaptured ? (
            /* Captured: retake / use photo */
            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={handleRetake} style={{
                flex: '0 0 auto', padding: '16px 24px', borderRadius: 16,
                background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
                color: 'rgba(255,255,255,0.8)', fontSize: 15, fontWeight: 700,
                cursor: 'pointer',
              }}>
                Retake
              </button>
              <button onClick={handleUsePhoto} style={{
                flex: 1, padding: '16px', borderRadius: 16, border: 'none',
                background: '#16a34a', color: '#fff',
                fontFamily: 'inherit', fontSize: 16, fontWeight: 800, letterSpacing: '.04em',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                boxShadow: '0 8px 24px rgba(22,163,74,0.3)',
              }}>
                ✓ Use Photo
              </button>
            </div>

          ) : (
            /* Live / starting: shutter button */
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', position: 'relative', width: '100%' }}>

              {/* Cancel Button (Bottom Left) */}
              <button
                onClick={handleClose}
                style={{
                  position: 'absolute',
                  left: 0,
                  background: 'none',
                  border: 'none',
                  color: 'rgba(255,255,255,0.9)',
                  fontSize: 16,
                  fontWeight: 600,
                  cursor: 'pointer',
                  padding: '10px 0',
                }}
              >
                Cancel
              </button>

              {isError ? (
                <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, fontWeight: 600 }}>
                  Camera access required to report issues
                </div>
              ) : (
                <button onClick={handleCapture} disabled={!isLive} style={{
                  width: 80, height: 80, borderRadius: '50%', border: 'none',
                  background: isLive ? '#fff' : 'rgba(255,255,255,0.15)',
                  cursor: isLive ? 'pointer' : 'not-allowed',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: isLive
                    ? '0 0 0 6px rgba(255,255,255,0.15), 0 8px 24px rgba(0,0,0,0.4)'
                    : 'none',
                  transition: 'all .2s', position: 'relative',
                }}>
                  <div style={{
                    width: 66, height: 66, borderRadius: '50%',
                    border: '3px solid #0d1117',
                    background: isLive ? '#fff' : 'rgba(255,255,255,0.1)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <span style={{ fontSize: 24, color: '#0d1117', display: isLive ? 'block' : 'none' }}></span>
                  </div>
                </button>
              )}
            </div>
          )}

          {!isCaptured && isLive && (
            <div style={{ textAlign: 'center', marginTop: 16, fontSize: 12, color: 'rgba(255,255,255,0.4)', letterSpacing: '.05em', fontWeight: 600 }}>
              TAP TO CAPTURE ISSUE
            </div>
          )}
        </div>
      </div>
    </>,
    document.body
  )
}
