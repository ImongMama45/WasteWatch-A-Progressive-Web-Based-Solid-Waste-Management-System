import { X, Calendar, Clock, MapPin, Building2, Globe, Tag } from 'lucide-react'
import { useModal } from '../../../hooks/useModal'

export default function EventDetailModal({
  isOpen = false,
  event = null,
  onClose,
}) {
  useModal(isOpen, onClose)

  if (!isOpen || !event) return null

  const formatEventDateTime = (startStr, endStr) => {
    if (!startStr) return '—'
    try {
      const s = new Date(startStr)
      const datePart = s.toLocaleDateString('en-PH', {
        timeZone: 'Asia/Manila',
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
      const startTime = s.toLocaleTimeString('en-PH', {
        timeZone: 'Asia/Manila',
        hour: '2-digit',
        minute: '2-digit',
      })
      if (!endStr) return `${datePart} at ${startTime}`
      const e = new Date(endStr)
      const endTime = e.toLocaleTimeString('en-PH', {
        timeZone: 'Asia/Manila',
        hour: '2-digit',
        minute: '2-digit',
      })
      return `${datePart}\n${startTime} – ${endTime}`
    } catch {
      return `${startStr} – ${endStr || ''}`
    }
  }

  const isCitywide = event.is_citywide || !event.barangays || event.barangays.length === 0
  const statusClass = (event.status || 'draft').toLowerCase()

  return (
    <div
      className="event-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="event-preview-title"
      data-testid="event-detail-modal"
    >
      <div className="event-modal-card">
        {/* Header */}
        <div className="event-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span className={`badge-status ${statusClass}`}>
              {event.status_display || event.status}
            </span>
            <span className="badge-category">{event.category_display || event.category}</span>
            {isCitywide ? (
              <span className="badge-scope-citywide">
                <Globe size={12} />
                Citywide
              </span>
            ) : (
              <span className="badge-category" style={{ background: '#f0fdf4', color: '#166534' }}>
                <MapPin size={12} />
                {event.barangay_details?.length || event.barangays?.length} Barangays
              </span>
            )}
          </div>
          <button
            type="button"
            className="btn-close-modal"
            onClick={onClose}
            aria-label="Close dialog"
            data-testid="close-preview-modal-btn"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="event-modal-body">
          {/* Cover image */}
          {event.cover_image_url && (
            <div style={{ width: '100%', borderRadius: '10px', overflow: 'hidden', maxHeight: '240px', border: '1px solid #e2e8f0' }}>
              <img
                src={event.cover_image_url}
                alt={event.title}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </div>
          )}

          {/* Title */}
          <h2 id="event-preview-title" className="event-modal-title" style={{ fontSize: '1.4rem' }}>
            {event.title}
          </h2>

          {/* Metadata Grid */}
          <div
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '10px',
              padding: '16px',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '14px',
            }}
          >
            <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
              <Clock size={16} color="#059669" style={{ marginTop: '2px', flexShrink: 0 }} />
              <div>
                <span style={{ fontSize: '0.725rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', display: 'block' }}>
                  Date & Time
                </span>
                <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0f172a', whiteSpace: 'pre-line' }}>
                  {formatEventDateTime(event.start_datetime, event.end_datetime)}
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
              <MapPin size={16} color="#2563eb" style={{ marginTop: '2px', flexShrink: 0 }} />
              <div>
                <span style={{ fontSize: '0.725rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', display: 'block' }}>
                  Location / Venue
                </span>
                <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0f172a' }}>
                  {event.location}
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
              <Building2 size={16} color="#d97706" style={{ marginTop: '2px', flexShrink: 0 }} />
              <div>
                <span style={{ fontSize: '0.725rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', display: 'block' }}>
                  Organizer
                </span>
                <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0f172a' }}>
                  {event.organizer}
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
              <Globe size={16} color="#16a34a" style={{ marginTop: '2px', flexShrink: 0 }} />
              <div>
                <span style={{ fontSize: '0.725rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', display: 'block' }}>
                  Target Scope
                </span>
                <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0f172a' }}>
                  {isCitywide
                    ? 'Citywide (All 33 Barangays)'
                    : (event.barangay_details || []).map((b) => b.name).join(', ')}
                </span>
              </div>
            </div>
          </div>

          {/* Description */}
          <div>
            <h4 style={{ fontSize: '0.875rem', fontWeight: 700, color: '#334155', margin: '0 0 6px' }}>
              Event Information & Guidelines
            </h4>
            <p style={{ fontSize: '0.9rem', color: '#475569', lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' }}>
              {event.description}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="event-modal-footer">
          <button
            type="button"
            className="btn-primary-event"
            onClick={onClose}
            data-testid="close-preview-footer-btn"
          >
            Close Preview
          </button>
        </div>
      </div>
    </div>
  )
}
