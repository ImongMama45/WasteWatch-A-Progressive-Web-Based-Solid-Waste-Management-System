import { X, Users } from 'lucide-react'
import CrewAttendanceBoard from '../../../components/CrewAttendanceBoard'

export default function CrewAttendanceModal({ shiftId, scheduleId = null, onClose }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{
        background: 'rgba(15, 23, 42, 0.48)',
        backdropFilter: 'blur(3px)',
      }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]"
        style={{
          background: '#ffffff',
          borderRadius: 18,
          border: '1px solid #e2e8f0',
          boxShadow: '0 24px 55px rgba(15, 23, 42, 0.2)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: '14px 18px',
            borderBottom: '1px solid #e2e8f0',
            background: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                background: '#ecfdf5',
                border: '1px solid #a7f3d0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#059669',
              }}
            >
              <Users size={18} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#0f172a' }}>
                Crew Attendance &amp; Roster
              </h3>
              <div style={{ fontSize: 11.5, color: '#64748b' }}>
                Shift #{shiftId} · Canonical Crew Manifest
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              border: '1px solid #e2e8f0',
              background: '#f8fafc',
              color: '#475569',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: 16, overflowY: 'auto', background: '#f8fafc' }}>
          <CrewAttendanceBoard
            mode="shift"
            shiftId={shiftId}
            scheduleId={scheduleId}
          />
        </div>
      </div>
    </div>
  )
}
