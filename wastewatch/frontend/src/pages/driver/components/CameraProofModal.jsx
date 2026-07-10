import { useState } from 'react'
import api from '../../../api/client'
import { broadcastPickupStatusSync } from '../../../utils/pickupStatusSync'
import GlobalCameraModal from '../../../components/GlobalCameraModal'

export default function CameraProofModal({
  visible,
  stopIndex,
  scheduleId,
  gpsPos,
  note,
  onSuccess,
  onClose,
}) {
  const [uploading, setUploading] = useState(false)

  async function handleCapture(capturedData) {
    if (!capturedData) return

    const isArray = Array.isArray(capturedData)
    const blob = isArray ? capturedData[0] : capturedData

    if (!scheduleId) {
      alert('No schedule assigned. Contact your dispatcher.')
      return
    }

    setUploading(true)

    try {
      const form = new FormData()
      form.append('photo', blob, `pickup-${stopIndex ?? 'x'}-${Date.now()}.jpg`)
      form.append('schedule_id', String(scheduleId))
      form.append('stop_order', String(stopIndex ?? 0))
      form.append('note', note?.trim() || '')
      form.append('collected_at', new Date().toISOString())
      if (gpsPos) {
        form.append('lat', String(gpsPos.lat))
        form.append('lng', String(gpsPos.lng))
      }

      const res = await api.post('/api/driver/stops/collect/', form)

      broadcastPickupStatusSync({
        scheduleId: scheduleId ?? null,
        stopOrder: stopIndex ?? null,
        status: 'COMPLETED',
        source: 'camera-proof-modal',
      })

      if (res.data?.id) {
        sessionStorage.setItem('ww_pending_collection_stop_id', String(res.data.id))
      }

      onSuccess?.({ photoUrl: res.data?.photo_url || null })
    } catch (err) {
      alert(err?.response?.data?.error || err?.message || 'Upload failed. Please try again.')
    } finally {
      setUploading(false)
      onClose?.()
    }
  }

  return (
    <>
      <GlobalCameraModal
        visible={visible}
        onClose={onClose}
        onCapture={handleCapture}
      />
      {uploading && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 999999,
          background: 'rgba(0,0,0,0.6)', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', color: '#fff',
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: '50%',
            border: '3px solid rgba(255,255,255,0.2)', borderTopColor: '#2ecc71',
            animation: 'cpm-spin 1s linear infinite', marginBottom: 16,
          }} />
          <style>{`@keyframes cpm-spin { to { transform:rotate(360deg); } }`}</style>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Uploading proof...</div>
        </div>
      )}
    </>
  )
}