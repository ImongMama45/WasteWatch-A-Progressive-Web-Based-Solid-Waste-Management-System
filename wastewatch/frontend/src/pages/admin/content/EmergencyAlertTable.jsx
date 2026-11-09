import {
  Eye,
  Edit2,
  Trash2,
  ShieldAlert,
  ToggleLeft,
  ToggleRight,
  Calendar,
  AlertTriangle,
} from 'lucide-react'

export default function EmergencyAlertTable({
  alerts = [],
  loading = false,
  onPreview,
  onEdit,
  onToggleActive,
  onDelete,
}) {
  if (loading) {
    return (
      <div className="table-container" style={{ padding: '40px', textAlign: 'center' }}>
        <p style={{ color: '#64748b' }}>Loading emergency advisories...</p>
      </div>
    )
  }

  if (alerts.length === 0) {
    return (
      <div className="table-container">
        <div className="empty-content-state">
          <ShieldAlert className="empty-state-icon" style={{ color: '#ef4444' }} />
          <h3 className="empty-state-title">No emergency alerts registered</h3>
          <p className="empty-state-desc">
            There are currently no active or historical emergency advisories logged in the system.
          </p>
        </div>
      </div>
    )
  }

  const formatPhDate = (dateStr) => {
    if (!dateStr) return '—'
    try {
      const d = new Date(dateStr)
      return d.toLocaleDateString('en-PH', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    } catch {
      return dateStr
    }
  }

  return (
    <div className="table-container">
      <table className="content-table" aria-label="Official emergency alerts management table">
        <thead>
          <tr>
            <th>Advisory Title & Details</th>
            <th>Broadcast Status</th>
            <th>Date Logged</th>
            <th>Last Updated</th>
            <th style={{ textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {alerts.map((alert) => (
            <tr key={alert.id} data-testid={`alert-row-${alert.id}`}>
              {/* Title and Excerpt */}
              <td className="item-title-cell" style={{ maxWidth: '420px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                  <ShieldAlert size={16} color={alert.is_active ? '#dc2626' : '#94a3b8'} />
                  <span className="item-title-text" title={alert.title} style={{ color: alert.is_active ? '#991b1b' : '#334155' }}>
                    {alert.title}
                  </span>
                </div>
                <span className="item-excerpt-text" title={alert.body}>
                  {alert.body ? alert.body.slice(0, 110) : 'No advisory details provided.'}
                </span>
              </td>

              {/* Status */}
              <td>
                <span className={`status-pill ${alert.is_active ? 'published' : 'archived'}`}>
                  {alert.is_active ? 'Active Public Broadcast' : 'Inactive / Retired'}
                </span>
              </td>

              {/* Date */}
              <td>
                <span style={{ fontSize: '0.8rem', color: '#475569' }}>
                  {formatPhDate(alert.date)}
                </span>
              </td>

              {/* Updated */}
              <td>
                <span style={{ fontSize: '0.8rem', color: '#475569' }}>
                  {formatPhDate(alert.updated_at || alert.date)}
                </span>
              </td>

              {/* Actions */}
              <td className="table-actions-cell">
                <div className="action-btn-group">
                  {/* Preview */}
                  <button
                    type="button"
                    className="action-icon-btn"
                    onClick={() => onPreview(alert)}
                    title="Preview emergency advisory modal"
                    aria-label={`Preview ${alert.title}`}
                    data-testid={`preview-alert-${alert.id}`}
                  >
                    <Eye size={15} />
                  </button>

                  {/* Edit */}
                  <button
                    type="button"
                    className="action-icon-btn"
                    onClick={() => onEdit(alert)}
                    title="Edit advisory"
                    aria-label={`Edit ${alert.title}`}
                    data-testid={`edit-alert-${alert.id}`}
                  >
                    <Edit2 size={15} />
                  </button>

                  {/* Toggle Active */}
                  <button
                    type="button"
                    className="action-icon-btn"
                    onClick={() => onToggleActive(alert)}
                    title={alert.is_active ? "Deactivate advisory" : "Activate and broadcast advisory"}
                    aria-label={alert.is_active ? `Deactivate ${alert.title}` : `Activate ${alert.title}`}
                    data-testid={`toggle-alert-${alert.id}`}
                    style={{
                      color: alert.is_active ? '#dc2626' : '#16a34a',
                      borderColor: alert.is_active ? '#fecaca' : '#bbf7d0',
                    }}
                  >
                    {alert.is_active ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                  </button>

                  {/* Delete */}
                  <button
                    type="button"
                    className="action-icon-btn danger"
                    onClick={() => onDelete(alert)}
                    title="Delete advisory permanently"
                    aria-label={`Delete ${alert.title}`}
                    data-testid={`delete-alert-${alert.id}`}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
