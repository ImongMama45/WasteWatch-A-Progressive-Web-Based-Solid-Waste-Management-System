import {
  Eye,
  Edit2,
  Trash2,
  CheckCircle2,
  EyeOff,
  Archive,
  RotateCcw,
  FileText,
  MapPin,
  Pin,
  Sparkles,
} from 'lucide-react'

export default function NewsItemTable({
  items = [],
  loading = false,
  onPreview,
  onEdit,
  onPublish,
  onUnpublish,
  onArchive,
  onRestore,
  onDelete,
}) {
  if (loading) {
    return (
      <div className="table-container" style={{ padding: '40px', textAlign: 'center' }}>
        <p style={{ color: '#64748b' }}>Loading content repository...</p>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="table-container">
        <div className="empty-content-state">
          <FileText className="empty-state-icon" />
          <h3 className="empty-state-title">No content matches your filters</h3>
          <p className="empty-state-desc">
            Try adjusting your search criteria, clearing filters, or create a new announcement or news item.
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
      <table className="content-table" aria-label="Official notices and news management table">
        <thead>
          <tr>
            <th>Article / Notice</th>
            <th>Type & Category</th>
            <th>Municipal Scope</th>
            <th>Status</th>
            <th>Priority</th>
            <th>Updated</th>
            <th>Author</th>
            <th style={{ textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const isCityWide = !item.barangay
            const scopeLabel = item.barangay_name || (isCityWide ? 'City-Wide' : 'Barangay')

            return (
              <tr key={item.id} data-testid={`news-item-row-${item.id}`}>
                {/* Title and Excerpt */}
                <td className="item-title-cell">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {item.is_pinned && <Pin size={14} color="#2563eb" title="Pinned notice" />}
                    {item.is_featured && <Sparkles size={14} color="#f59e0b" title="Featured article" />}
                    <span className="item-title-text" title={item.title}>
                      {item.title}
                    </span>
                  </div>
                  <span className="item-excerpt-text" title={item.description}>
                    {item.description ? item.description.slice(0, 90) : 'No description provided.'}
                  </span>
                </td>

                {/* Type & Category */}
                <td>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <span className={`type-pill ${item.type || 'news'}`}>
                      {item.type || 'news'}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                      {item.category || 'General'}
                    </span>
                  </div>
                </td>

                {/* Scope */}
                <td>
                  <span className={`scope-pill ${isCityWide ? 'citywide' : ''}`}>
                    <MapPin size={12} />
                    {scopeLabel}
                  </span>
                </td>

                {/* Status */}
                <td>
                  <span className={`status-pill ${item.status || 'published'}`}>
                    {item.status || 'published'}
                  </span>
                </td>

                {/* Priority */}
                <td>
                  <span
                    style={{
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      color:
                        item.priority === 'high'
                          ? '#dc2626'
                          : item.priority === 'medium'
                          ? '#d97706'
                          : '#64748b',
                    }}
                  >
                    {item.priority || 'low'}
                  </span>
                </td>

                {/* Updated Date */}
                <td>
                  <span style={{ fontSize: '0.8rem', color: '#475569' }}>
                    {formatPhDate(item.updated_at || item.date)}
                  </span>
                </td>

                {/* Author */}
                <td>
                  <span style={{ fontSize: '0.8rem', color: '#334155', fontWeight: 500 }}>
                    {item.author_name || 'CENRO Staff'}
                  </span>
                </td>

                {/* Actions */}
                <td className="table-actions-cell">
                  <div className="action-btn-group">
                    {/* Preview */}
                    <button
                      type="button"
                      className="action-icon-btn"
                      onClick={() => onPreview(item)}
                      title="Preview public modal"
                      aria-label={`Preview ${item.title}`}
                      data-testid={`preview-btn-${item.id}`}
                    >
                      <Eye size={15} />
                    </button>

                    {/* Edit */}
                    <button
                      type="button"
                      className="action-icon-btn"
                      onClick={() => onEdit(item)}
                      title="Edit notice"
                      aria-label={`Edit ${item.title}`}
                      data-testid={`edit-btn-${item.id}`}
                    >
                      <Edit2 size={15} />
                    </button>

                    {/* Lifecycle Transitions */}
                    {item.status === 'published' ? (
                      <>
                        <button
                          type="button"
                          className="action-icon-btn"
                          onClick={() => onUnpublish(item)}
                          title="Unpublish (revert to draft)"
                          aria-label={`Unpublish ${item.title}`}
                          data-testid={`unpublish-btn-${item.id}`}
                        >
                          <EyeOff size={15} />
                        </button>
                        <button
                          type="button"
                          className="action-icon-btn archive"
                          onClick={() => onArchive(item)}
                          title="Archive notice"
                          aria-label={`Archive ${item.title}`}
                          data-testid={`archive-btn-${item.id}`}
                        >
                          <Archive size={15} />
                        </button>
                      </>
                    ) : item.status === 'draft' ? (
                      <>
                        <button
                          type="button"
                          className="action-icon-btn publish"
                          onClick={() => onPublish(item)}
                          title="Publish notice"
                          aria-label={`Publish ${item.title}`}
                          data-testid={`publish-btn-${item.id}`}
                        >
                          <CheckCircle2 size={15} />
                        </button>
                        <button
                          type="button"
                          className="action-icon-btn archive"
                          onClick={() => onArchive(item)}
                          title="Archive notice"
                          aria-label={`Archive ${item.title}`}
                          data-testid={`archive-btn-${item.id}`}
                        >
                          <Archive size={15} />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="action-icon-btn"
                          onClick={() => onRestore(item)}
                          title="Restore to Draft"
                          aria-label={`Restore ${item.title}`}
                          data-testid={`restore-btn-${item.id}`}
                        >
                          <RotateCcw size={15} />
                        </button>
                        <button
                          type="button"
                          className="action-icon-btn publish"
                          onClick={() => onPublish(item)}
                          title="Publish directly"
                          aria-label={`Publish ${item.title}`}
                          data-testid={`publish-btn-${item.id}`}
                        >
                          <CheckCircle2 size={15} />
                        </button>
                      </>
                    )}

                    {/* Delete */}
                    <button
                      type="button"
                      className="action-icon-btn danger"
                      onClick={() => onDelete(item)}
                      title="Delete permanently"
                      aria-label={`Delete ${item.title}`}
                      data-testid={`delete-btn-${item.id}`}
                    >
                      <Trash2 size={15} />
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
