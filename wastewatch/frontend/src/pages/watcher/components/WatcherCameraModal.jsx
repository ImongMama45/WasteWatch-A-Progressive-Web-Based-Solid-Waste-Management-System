/**
 * WatcherCameraModal.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Camera-only overlay for watcher pre-inspection photo capture.
 * Unlike CameraProofModal (driver), this does NOT upload — it returns the
 * captured Blob via onCapture(blob, previewUrl) so PreInspectionOverlay can
 * bundle it with other form fields before posting.
 *
 * Works on both mobile (rear camera preferred) and desktop webcam.
 *
 * PROPS:
 *   visible    {boolean}
 *   stopLabel  {string}          — shown in the header
 *   gpsPos     {{ lat, lng }|null}
 *   onCapture  {(blob, previewUrl) => void}
 *   onClose    {() => void}
 */

import { useState, useEffect, useRef } from 'react'

const CameraIcon = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
)

const CameraOffIcon = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" width="32" height="32">
      <line x1="2" y1="2" x2="22" y2="22" />
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3l2-3h6l1.5 2.25" />
      <circle cx="12" cy="13" r="4" />
    </svg>
)

export default function WatcherCameraModal({ visible, stopLabel, gpsPos, onCapture, onClose }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)

  const [phase, setPhase] = useState('idle')     // idle | starting | live | captured | error
  const [cameraError, setCameraError] = useState('')
  const [preview, setPreview] = useState(null)
  const [blob, setBlob] = useState(null)
  const [flash, setFlash] = useState(false)

  useEffect(() => {
    if (!visible) { stopCamera(); resetState(); return }
    startCamera()
    return () => stopCamera()
  }, [visible]) // eslint-disable-line

  function stopCamera() {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }

  function resetState() {
    setPhase('idle')
    setCameraError('')
    if (preview) URL.revokeObjectURL(preview)
    setPreview(null)
    setBlob(null)
    setFlash(false)
  }

  async function startCamera() {
    setPhase('starting')
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
      setPhase('live')
    } catch (err) {
      setCameraError(err?.message || 'Camera access denied.')
      setPhase('error')
    }
  }

  async function handleCapture() {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || phase !== 'live') return

    canvas.width = video.videoWidth || 1280
    canvas.height = video.videoHeight || 720
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)

    setFlash(true)
    setTimeout(() => setFlash(false), 200)

    const captured = await new Promise((res, rej) =>
      canvas.toBlob(b => (b ? res(b) : rej(new Error('Capture failed.'))), 'image/jpeg', 0.92)
    )
    const url = URL.createObjectURL(captured)
    setPreview(url)
    setBlob(captured)
    setPhase('captured')
    stopCamera()
  }

  function handleRetake() {
    if (preview) URL.revokeObjectURL(preview)
    setPreview(null)
    setBlob(null)
    setPhase('starting')
    startCamera()
  }

  function handleUsePhoto() {
    if (!blob || !preview) return
    onCapture?.(blob, preview)
  }

  function handleClose() {
    stopCamera()
    resetState()
    onClose?.()
  }

  if (!visible) return null

  const isLive = phase === 'live'
  const isCaptured = phase === 'captured'
  const isError = phase === 'error'

  return (
    <>
      <style>{`
        @keyframes wcm-slide-up { from{opacity:0;transform:translateY(24px)} to{opacity:1;transform:translateY(0)} }
        @keyframes wcm-fade-in  { from{opacity:0} to{opacity:1} }
        @keyframes wcm-shutter  { 0%{opacity:.95} 100%{opacity:0} }
        @keyframes wcm-spin     { to{transform:rotate(360deg)} }
        @keyframes wcm-pulse    { 0%,100%{opacity:1} 50%{opacity:.3} }
      `}</style>

      {/* Backdrop */}
      <div onClick={handleClose} style={{
        position: 'fixed', inset: 0, zIndex: 4999,
        background: 'rgba(5,10,20,0.78)', backdropFilter: 'blur(4px)',
        animation: 'wcm-fade-in .2s ease',
      }} />

      {/* Sheet — responsive: full-width on mobile, centred card on desktop */}
      <div style={{
        position: 'fixed', zIndex: 5000,
        /* Mobile: bottom sheet */
        left: 0, right: 0, bottom: 0,
        /* Desktop override via max-width + centering */
        maxWidth: 520, margin: '0 auto',
        borderRadius: '22px 22px 0 0',
        background: '#0d1117',
        boxShadow: '0 -12px 60px rgba(0,0,0,.6)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden', maxHeight: '96vh',
        animation: 'wcm-slide-up .3s cubic-bezier(.32,.72,0,1)',
      }}>

        {/* Header */}
        <div style={{ padding: '12px 20px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(255,255,255,.15)', marginBottom: 14 }} />
          <div style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <div>
              <div style={{ fontFamily: 'monospace', fontSize: 10, fontWeight: 800, letterSpacing: '.1em', color: 'rgba(255,255,255,.4)', marginBottom: 2 }}>
                INSPECTION PHOTO
              </div>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>
                {stopLabel || 'Stop'}
              </div>
            </div>
            <button onClick={handleClose} style={{
              width: 36, height: 36, borderRadius: '50%',
              background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.12)',
              color: 'rgba(255,255,255,.7)', fontSize: 16, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>✕</button>
          </div>
        </div>

        {/* Viewfinder */}
        <div style={{ position: 'relative', width: '100%', aspectRatio: '4/3', background: '#000', flexShrink: 0 }}>
          <video ref={videoRef} muted playsInline autoPlay style={{
            width: '100%', height: '100%', objectFit: 'cover', display: 'block',
            opacity: isLive ? 1 : 0, transition: 'opacity .3s',
          }} />

          {preview && (
            <img src={preview} alt="Captured" style={{
              position: 'absolute', inset: 0,
              width: '100%', height: '100%', objectFit: 'cover',
              animation: 'wcm-fade-in .25s ease',
            }} />
          )}

          <canvas ref={canvasRef} style={{ display: 'none' }} />

          {flash && (
            <div style={{
              position: 'absolute', inset: 0, background: '#fff',
              animation: 'wcm-shutter .2s ease forwards', pointerEvents: 'none',
            }} />
          )}

          {(phase === 'starting' || phase === 'idle') && !preview && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 12,
              background: 'rgba(13,17,23,.85)',
            }}>
              <div style={{
                width: 32, height: 32, borderRadius: '50%',
                border: '2.5px solid rgba(255,255,255,.15)', borderTopColor: '#14b8a6',
                animation: 'wcm-spin 1s linear infinite',
              }} />
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,.5)', fontWeight: 600 }}>Starting camera…</span>
            </div>
          )}

          {isError && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 12,
              background: 'rgba(13,17,23,.9)', padding: '0 24px',
            }}>
              <span style={{ display: 'flex', color: '#fca5a5' }}>{CameraOffIcon}</span>
              <div style={{ fontSize: 13, color: '#fca5a5', textAlign: 'center', fontWeight: 600, lineHeight: 1.5 }}>{cameraError}</div>
              <button onClick={startCamera} style={{
                marginTop: 8, padding: '10px 24px', borderRadius: 20,
                background: '#14b8a6', border: 'none', color: '#fff',
                fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}>Try again</button>
            </div>
          )}

          {/* Corner guides */}
          {isLive && (
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
              {[
                { top: 16, left: 16 }, { top: 16, right: 16 },
                { bottom: 16, left: 16 }, { bottom: 16, right: 16 },
              ].map((pos, i) => (
                <div key={i} style={{
                  position: 'absolute', width: 20, height: 20, ...pos,
                  borderTop: pos.top != null ? '2.5px solid rgba(20,184,166,.8)' : 'none',
                  borderBottom: pos.bottom != null ? '2.5px solid rgba(20,184,166,.8)' : 'none',
                  borderLeft: pos.left != null ? '2.5px solid rgba(20,184,166,.8)' : 'none',
                  borderRight: pos.right != null ? '2.5px solid rgba(20,184,166,.8)' : 'none',
                  borderRadius: i === 0 ? '3px 0 0 0' : i === 1 ? '0 3px 0 0' : i === 2 ? '0 0 0 3px' : '0 0 3px 0',
                }} />
              ))}
            </div>
          )}

          {/* GPS indicator */}
          {gpsPos && isLive && (
            <div style={{
              position: 'absolute', top: 12, left: 12,
              display: 'flex', alignItems: 'center', gap: 5,
              background: 'rgba(13,17,23,.65)', backdropFilter: 'blur(4px)',
              borderRadius: 20, padding: '4px 10px',
            }}>
              <span style={{
                width: 6, height: 6, borderRadius: '50%', background: '#2ecc71',
                animation: 'wcm-pulse 1.5s ease infinite', display: 'inline-block',
              }} />
              <span style={{ fontSize: 10, fontWeight: 700, color: '#2ecc71', letterSpacing: '.04em' }}>GPS ACTIVE</span>
            </div>
          )}

          {isCaptured && (
            <div style={{
              position: 'absolute', top: 12, right: 12,
              background: 'rgba(20,184,166,.9)', borderRadius: 8, padding: '4px 10px',
              fontSize: 10, fontWeight: 900, color: '#fff', letterSpacing: '.08em',
            }}>✓ CAPTURED</div>
          )}
        </div>

        {/* Controls */}
        <div style={{ padding: '16px 20px 32px', flexShrink: 0 }}>
          {isCaptured ? (
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={handleRetake} style={{
                flex: '0 0 auto', padding: '14px 20px', borderRadius: 14,
                background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.12)',
                color: 'rgba(255,255,255,.7)', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}>Retake</button>
              <button onClick={handleUsePhoto} style={{
                flex: 1, padding: '14px', borderRadius: 14, border: 'none',
                background: '#14b8a6', color: '#fff',
                fontFamily: 'monospace', fontSize: 14, fontWeight: 900, letterSpacing: '.06em',
                cursor: 'pointer', boxShadow: '0 6px 20px rgba(20,184,166,.35)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}>✓ Use This Photo</button>
            </div>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', paddingTop: 4 }}>
              {isError ? (
                <button onClick={startCamera} style={{
                  width: '100%', padding: '16px', borderRadius: 14, border: 'none',
                  background: '#14b8a6', color: '#fff', fontSize: 14, fontWeight: 800, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}><span style={{ display: 'flex' }}>{CameraIcon}</span> Allow Camera Access</button>
              ) : (
                <button onClick={handleCapture} disabled={!isLive} style={{
                  width: 74, height: 74, borderRadius: '50%', border: 'none',
                  background: isLive ? '#fff' : 'rgba(255,255,255,.15)',
                  cursor: isLive ? 'pointer' : 'not-allowed',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: isLive ? '0 0 0 4px rgba(255,255,255,.15),0 6px 20px rgba(0,0,0,.5)' : 'none',
                  transition: 'all .15s', position: 'relative',
                }}>
                  <div style={{
                    width: 62, height: 62, borderRadius: '50%',
                    border: '2.5px solid #0d1117',
                    background: isLive ? '#fff' : 'rgba(255,255,255,.1)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <span style={{ display: 'flex', color: '#0d1117' }}>{CameraIcon}</span>
                  </div>
                </button>
              )}
            </div>
          )}

          {!isCaptured && isLive && (
            <div style={{ textAlign: 'center', marginTop: 12, fontSize: 11, color: 'rgba(255,255,255,.3)', letterSpacing: '.04em' }}>
              TAP TO CAPTURE · GPS WILL BE RECORDED
            </div>
          )}
        </div>
      </div>
    </>
  )
}
