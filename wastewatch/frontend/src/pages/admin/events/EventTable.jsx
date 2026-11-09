import {
  Eye,
  Edit2,
  Trash2,
  CheckCircle2,
  XCircle,
  CheckSquare,
  Archive,
  RotateCcw,
  Calendar,
  MapPin,
  Building2,
  Globe,
} from 'lucide-react'

export default function EventTable({
  events = [],
  loading = false,
  onPreview,
  onEdit,
  onPublish,
  onCancel,
  onComplete,
  onArchive,
  onRestore,
  onDelete,
}) {
  if (loading) {
    return (
      <div className="event-table-container" style={{ padding: '48px', textAlign: 'center' }}>
        <p style={{ color: '#64748b', fontSize: '0.9rem' }}>Loading municipal events...</p>
      </div>
    )
  }

  if (events.length === 0) {
    return (
      <div className="event-table-container">
        <div className="event-empty-state" data-testid="event-empty-state">
          <Calendar className="event-empty-icon" />
          <h3 className="event-empty-title">No municipal events found</h3>
          <p className="event-empty-desc">
            Try adjusting your search criteria, clearing active filters, or schedule a new municipal event.
          </p>
        </div>
      </div>
    )
  }

  const formatEventDateTime = (startStr, endStr) => {
    if (!startStr) return '—'
    try {
      const s = new Date(startStr)
      const datePart = s.toLocaleDateString('en-PH', {
        timeZone: 'Asia/Manila',
        year: 'numeric',
        month: 'short',
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
      return `${datePart}, ${startTime} – ${endTime}`
    } catch {
      return `${startStr} – ${endStr || ''}`
    }
  }

  return (
    <div className="event-table-container">
      <table className="event-table" aria-label="Municipal events management table">
        <thead>
          <tr>
            <th>Event Name & Details</th>
            <th>Date & Time</th>
            <th>Location & Organizer</th>
            <th>Municipal Scope</th>
            <th>Status</th>
            <th style={{ textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => {
            const isCitywide = event.is_citywide || !event.barangays || event.barangays.length === 0
            const statusClass = (event.status || 'draft').toLowerCase()

            return (
              <tr key={event.id} data-testid={`event-row-${event.id}`}>
                {/* Title and Category */}
                <td className="event-title-cell">
                  <span className="event-title-text" title={event.title}>
                    {event.title}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                    <span className="badge-category">{event.category_display || event.category}</span>
                  </div>
                  <span className="event-desc-excerpt" title={event.description}>
                    {event.description}
                  </span>
                </td>

                {/* Date & Time */}
                <td style={{ whiteSpace: 'nowrap' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    <span style={{ fontWeight: 600, color: '#0f172a' }}>
                      {formatEventDateTime(event.start_datetime, event.end_datetime)}
                    </span>
                  </div>
                </td>

                {/* Location & Organizer */}
                <td>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color: '#0f172a' }}>
                      <MapPin size={13} color="#64748b" />
                      <span>{event.location}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color: '#64748b', fontSize: '0.775rem' }}>
                      <Building2 size={13} color="#94a3b8" />
                      <span>{event.organizer}</span>
                    </div>
                  </div>
                </td>

                {/* Scope */}
                <td>
                  {isCitywide ? (
                    <span className="badge-scope-citywide" title="Applies to all Lucena City barangays">
                      <Globe size={12} />
                      Citywide
                    </span>
                  ) : (
                    <div>
                      {(event.barangay_details || []).map((b) => (
                        <span key={b.id} className="badge-scope-barangay">
                          {b.name}
                        </span>
                      ))}
                    </div>
                  )}
                </td>

                {/* Status */}
                <td>
                  <span className={`badge-status ${statusClass}`} data-testid={`event-status-badge-${event.id}`}>
                    {event.status_display || event.status}
                  </span>
                </td>

                {/* Actions */}
                <td>
                  <div className="event-actions-cell">
                    {/* Preview */}
                    <button
                      type="button"
                      className="btn-icon-action"
                      onClick={() => onPreview(event)}
                      title="Preview event details"
                      data-testid={`event-preview-btn-${event.id}`}
                    >
                      <Eye size={16} />
                    </button>

                    {/* Edit */}
                    <button
                      type="button"
                      className="btn-icon-action"
                      onClick={() => onEdit(event)}
                      title="Edit event"
                      data-testid={`event-edit-btn-${event.id}`}
                    >
                      <Edit2 size={16} />
                    </button>

                    {/* Lifecycle Actions */}
                    {event.status === 'draft' && (
                      <button
                        type="button"
                        className="btn-icon-action publish"
                        onClick={() => onPublish(event)}
                        title="Publish event"
                        data-testid={`event-publish-btn-${event.id}`}
                      >
                        <CheckCircle2 size={16} />
                      </button>
                    )}

                    {event.status === 'published' && (
                      <>
                        <button
                          type="button"
                          className="btn-icon-action complete"
                          onClick={() => onComplete(event)}
                          title="Mark completed"
                          data-testid={`event-complete-btn-${event.id}`}
                        >
                          <CheckSquare size={16} />
                        </button>
                        <button
                          type="button"
                          className="btn-icon-action cancel"
                          onClick={() => onCancel(event)}
                          title="Cancel event"
                          data-testid={`event-cancel-btn-${event.id}`}
                        >
                          <XCircle size={16} />
                        </button>
                      </>
                    )}

                    {(event.status === 'published' || event.status === 'draft' || event.status === 'cancelled' || event.status === 'completed') && (
                      <button
                        type="button"
                        className="btn-icon-action"
                        onClick={() => onArchive(event)}
                        title="Archive event"
                        data-testid={`event-archive-btn-${event.id}`}
                      >
                        <Archive size={16} />
                      </button>
                    )}

                    {(event.status === 'archived' || event.status === 'cancelled') && (
                      <button
                        type="button"
                        className="btn-icon-action"
                        onClick={() => onRestore(event)}
                        title="Restore to Draft"
                        data-testid={`event-restore-btn-${event.id}`}
                      >
                        <RotateCcw size={16} />
                      </button>
                    )}

                    {/* Delete */}
                    <button
                      type="button"
                      className="btn-icon-action delete"
                      onClick={() => onDelete(event)}
                      title="Delete event"
                      data-testid={`event-delete-btn-${event.id}`}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
