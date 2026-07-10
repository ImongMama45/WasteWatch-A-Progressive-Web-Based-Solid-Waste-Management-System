import React, { useState } from 'react'
import { Camera } from 'lucide-react'
import ReportForm from '../pages/ReportForm'
import GlobalCameraModal from './GlobalCameraModal'
import { useOfflineReports } from '../hooks/useOfflineReports'
import { useOnline } from '../hooks/useOnline'

/**
 * QuickReport (Floating Action Button + Camera Modal)
 * 
 * A standalone component that functions as a desktop substitute for the mobile FAB.
 * It renders a floating "Quick Report" button on the bottom right and handles
 * the OfflineReportBuilder modal independently.
 * 
 * Drop this into any publicly available page (MapView, PublicDashboard, etc.)
 */
export default function QuickReport() {
  const [showCamera, setShowCamera] = useState(false)
  const [showBuilder, setShowBuilder] = useState(false)
  const [capturedPhoto, setCapturedPhoto] = useState(null)

  const { addReport, pushReport } = useOfflineReports()
  const isOnline = useOnline()

  React.useEffect(() => {
    const handleOpen = () => setShowCamera(true)
    window.addEventListener('open-quick-report', handleOpen)
    return () => window.removeEventListener('open-quick-report', handleOpen)
  }, [])

  const handleCapture = async (capturedData) => {
    const isArray = Array.isArray(capturedData)
    const blob = isArray ? capturedData[0] : capturedData
    const previewUrl = URL.createObjectURL(blob)
    setCapturedPhoto({ blob, url: previewUrl })
    setShowCamera(false)
    setShowBuilder(true)
  }

  return (
    <>
      <style>{`
        .qr-desktop-fab {
          position: fixed;
          bottom: 32px;
          right: 32px;
          z-index: 9999;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          background: none;
          border: none;
          padding: 0;
          cursor: pointer;
          outline: none;
        }
        @media (max-width: 1023px) {
          .qr-desktop-fab {
            display: none !important;
          }
        }
      `}</style>
      {(!showCamera && !showBuilder) && (
        <button
        className="qr-desktop-fab"
        onClick={() => setShowCamera(true)}
        aria-label="Quick Report"
        onMouseEnter={(e) => {
          const circle = e.currentTarget.querySelector('.qr-circle')
          if (circle) {
            circle.style.transform = 'translateY(-6px) scale(1.05)'
            circle.style.boxShadow = '0 20px 32px -8px rgba(22, 163, 74, 0.7), inset 0 1px 1px rgba(255, 255, 255, 0.3)'
            circle.style.background = 'linear-gradient(135deg, rgba(34, 197, 94, 0.95), rgba(22, 163, 74, 0.95))'
          }
        }}
        onMouseLeave={(e) => {
          const circle = e.currentTarget.querySelector('.qr-circle')
          if (circle) {
            circle.style.transform = 'translateY(0) scale(1)'
            circle.style.boxShadow = '0 12px 24px -8px rgba(22, 163, 74, 0.6), inset 0 1px 1px rgba(255, 255, 255, 0.2)'
            circle.style.background = 'linear-gradient(135deg, rgba(22, 163, 74, 0.95), rgba(21, 128, 61, 0.95))'
          }
        }}
      >
        <div 
          className="qr-circle"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 64,
            height: 64,
            background: 'linear-gradient(135deg, rgba(22, 163, 74, 0.95), rgba(21, 128, 61, 0.95))',
            color: 'white',
            borderRadius: '50%',
            boxShadow: '0 12px 24px -8px rgba(22, 163, 74, 0.6), inset 0 1px 1px rgba(255, 255, 255, 0.2)',
            border: '1px solid rgba(255,255,255,0.15)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            transition: 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
          }}
        >
          <Camera size={28} strokeWidth={2.5} />
        </div>
        <span style={{ 
          fontSize: '0.75rem', 
          fontWeight: 700, 
          color: 'rgba(255, 255, 255, 0.9)', 
          letterSpacing: '0.5px',
          textShadow: '0 2px 4px rgba(0,0,0,0.5)',
        }}>
          QUICK REPORT
        </span>
      </button>
      )}

      <GlobalCameraModal
        visible={showCamera}
        onClose={() => setShowCamera(false)}
        onCapture={handleCapture}
      />

      <ReportForm
        isOpen={showBuilder}
        initialPhoto={capturedPhoto}
        onClose={() => {
          setShowBuilder(false)
          setCapturedPhoto(null)
        }}
      />
    </>
  )
}
