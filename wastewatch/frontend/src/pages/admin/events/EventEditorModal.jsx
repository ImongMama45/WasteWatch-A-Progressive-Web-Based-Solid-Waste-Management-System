import { useState, useEffect, useRef } from 'react'
import { X, Upload, Trash2, Globe, MapPin, Calendar, Clock, Building2, CheckCircle2 } from 'lucide-react'
import { useModal } from '../../../hooks/useModal'

const CATEGORIES = [
  { value: 'cleanup', label: 'Cleanup Drive' },
  { value: 'community_meeting', label: 'Community Meeting' },
  { value: 'hazardous_waste', label: 'Special Waste Collection' },
  { value: 'tree_planting', label: 'Tree Planting' },
  { value: 'workshop', label: 'Public Orientation & Seminar' },
  { value: 'general', label: 'General Municipal Event' },
]

export default function EventEditorModal({
  isOpen = false,
  event = null,
  barangays = [],
  onClose,
  onSave,
  saving = false,
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [startDatetime, setStartDatetime] = useState('')
  const [endDatetime, setEndDatetime] = useState('')
  const [location, setLocation] = useState('')
  const [organizer, setOrganizer] = useState('Lucena City CENRO')
  const [category, setCategory] = useState('general')
  const [scopeMode, setScopeMode] = useState('citywide') // 'citywide' | 'specific'
  const [selectedBarangays, setSelectedBarangays] = useState([])
  const [status, setStatus] = useState('draft')
  const [imageFile, setImageFile] = useState(null)
  const [imagePreview, setImagePreview] = useState(null)
  const [errors, setErrors] = useState({})

  const fileInputRef = useRef(null)
  useModal(isOpen, onClose)

  const formatIsoForDatetimeLocal = (isoStr) => {
    if (!isoStr) return ''
    try {
      const d = new Date(isoStr)
      // Format to YYYY-MM-DDTHH:mm
      const pad = (n) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    } catch {
      return ''
    }
  }

  useEffect(() => {
    if (event) {
      setTitle(event.title || '')
      setDescription(event.description || '')
      setStartDatetime(formatIsoForDatetimeLocal(event.start_datetime))
      setEndDatetime(formatIsoForDatetimeLocal(event.end_datetime))
      setLocation(event.location || '')
      setOrganizer(event.organizer || 'Lucena City CENRO')
      setCategory(event.category || 'general')
      const bList = Array.isArray(event.barangays) ? event.barangays : []
      if (bList.length > 0) {
        setScopeMode('specific')
        setSelectedBarangays(bList.map((b) => (typeof b === 'object' ? b.id : b)))
      } else {
        setScopeMode('citywide')
        setSelectedBarangays([])
      }
      setStatus(event.status || 'draft')
      setImageFile(null)
      setImagePreview(event.cover_image_url || null)
    } else {
      setTitle('')
      setDescription('')
      // Default start 1 day in the future at 08:00
      const defaultStart = new Date()
      defaultStart.setDate(defaultStart.getDate() + 1)
      defaultStart.setHours(8, 0, 0, 0)
      const defaultEnd = new Date(defaultStart)
      defaultEnd.setHours(11, 0, 0, 0)

      setStartDatetime(formatIsoForDatetimeLocal(defaultStart.toISOString()))
      setEndDatetime(formatIsoForDatetimeLocal(defaultEnd.toISOString()))
      setLocation('')
      setOrganizer('Lucena City CENRO')
      setCategory('general')
      setScopeMode('citywide')
      setSelectedBarangays([])
      setStatus('draft')
      setImageFile(null)
      setImagePreview(null)
    }
    setErrors({})
  }, [event, isOpen])

  if (!isOpen) return null

  const handleBarangayToggle = (bId) => {
    setSelectedBarangays((prev) =>
      prev.includes(bId) ? prev.filter((id) => id !== bId) : [...prev, bId]
    )
  }

  const handleImageChange = (e) => {
    const file = e.target.files?.[0]
    if (file) {
      setImageFile(file)
      setImagePreview(URL.createObjectURL(file))
    }
  }

  const handleRemoveImage = () => {
    setImageFile(null)
    setImagePreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (saving) return

    const newErrors = {}
    if (!title.trim()) newErrors.title = 'Event title is required.'
    if (!description.trim()) newErrors.description = 'Event description is required.'
    if (!startDatetime) newErrors.startDatetime = 'Start date and time are required.'
    if (!endDatetime) newErrors.endDatetime = 'End date and time are required.'
    if (!location.trim()) newErrors.location = 'Location is required.'
    if (!organizer.trim()) newErrors.organizer = 'Organizer is required.'

    if (startDatetime && endDatetime) {
      const s = new Date(startDatetime)
      const end = new Date(endDatetime)
      if (end <= s) {
        newErrors.endDatetime = 'End date/time must be strictly after the start date/time.'
      }
    }

    if (scopeMode === 'specific' && selectedBarangays.length === 0) {
      newErrors.barangays = 'Please select at least one barangay or choose Citywide.'
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    const payload = {
      title: title.trim(),
      description: description.trim(),
      start_datetime: new Date(startDatetime).toISOString(),
      end_datetime: new Date(endDatetime).toISOString(),
      location: location.trim(),
      organizer: organizer.trim(),
      category,
      status,
      barangays: scopeMode === 'citywide' ? [] : selectedBarangays,
    }

    if (imageFile) {
      payload.cover_image = imageFile
    }

    onSave(payload)
  }

  return (
    <div
      className="event-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="event-editor-title"
      data-testid="event-editor-modal"
    >
      <div className="event-modal-card">
        {/* Header */}
        <div className="event-modal-header">
          <h2 id="event-editor-title" className="event-modal-title">
            {event ? 'Edit Municipal Event' : 'Schedule Municipal Event'}
          </h2>
          <button
            type="button"
            className="btn-close-modal"
            onClick={onClose}
            aria-label="Close dialog"
            disabled={saving}
            data-testid="close-editor-modal-btn"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body / Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
          <div className="event-modal-body">
            {/* Title */}
            <div className="form-group">
              <label htmlFor="event-title" className="form-label">
                Event Title *
              </label>
              <input
                id="event-title"
                type="text"
                className="form-input"
                placeholder="e.g. Citywide Clean River Drive"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={saving}
                data-testid="event-title-input"
              />
              {errors.title && <span className="form-error-text" data-testid="error-title">{errors.title}</span>}
            </div>

            {/* Category & Organizer Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div className="form-group">
                <label htmlFor="event-category" className="form-label">
                  Category *
                </label>
                <select
                  id="event-category"
                  className="form-select"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  disabled={saving}
                  data-testid="event-category-select"
                >
                  {CATEGORIES.map((cat) => (
                    <option key={cat.value} value={cat.value}>
                      {cat.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="event-organizer" className="form-label">
                  Organizer Office / Department *
                </label>
                <input
                  id="event-organizer"
                  type="text"
                  className="form-input"
                  placeholder="e.g. Lucena City CENRO"
                  value={organizer}
                  onChange={(e) => setOrganizer(e.target.value)}
                  disabled={saving}
                  data-testid="event-organizer-input"
                />
                {errors.organizer && <span className="form-error-text">{errors.organizer}</span>}
              </div>
            </div>

            {/* Schedule Dates Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div className="form-group">
                <label htmlFor="event-start-datetime" className="form-label">
                  Start Date & Time (Asia/Manila) *
                </label>
                <input
                  id="event-start-datetime"
                  type="datetime-local"
                  className="form-input"
                  value={startDatetime}
                  onChange={(e) => setStartDatetime(e.target.value)}
                  disabled={saving}
                  data-testid="event-start-datetime-input"
                />
                {errors.startDatetime && <span className="form-error-text" data-testid="error-start-datetime">{errors.startDatetime}</span>}
              </div>

              <div className="form-group">
                <label htmlFor="event-end-datetime" className="form-label">
                  End Date & Time (Asia/Manila) *
                </label>
                <input
                  id="event-end-datetime"
                  type="datetime-local"
                  className="form-input"
                  value={endDatetime}
                  onChange={(e) => setEndDatetime(e.target.value)}
                  disabled={saving}
                  data-testid="event-end-datetime-input"
                />
                {errors.endDatetime && <span className="form-error-text" data-testid="error-end-datetime">{errors.endDatetime}</span>}
              </div>
            </div>

            {/* Location */}
            <div className="form-group">
              <label htmlFor="event-location" className="form-label">
                Venue / Location *
              </label>
              <input
                id="event-location"
                type="text"
                className="form-input"
                placeholder="e.g. Perez Park Promenade, Lucena City"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                disabled={saving}
                data-testid="event-location-input"
              />
              {errors.location && <span className="form-error-text">{errors.location}</span>}
            </div>

            {/* Municipal Scope (Citywide vs Specific Barangays) */}
            <div className="form-group">
              <span className="form-label">Municipal Scope & Target Audience *</span>
              <div style={{ display: 'flex', gap: '12px', marginTop: '4px' }}>
                <button
                  type="button"
                  style={{
                    flex: 1,
                    padding: '10px 14px',
                    borderRadius: '8px',
                    border: scopeMode === 'citywide' ? '2px solid #16a34a' : '1px solid #cbd5e1',
                    background: scopeMode === 'citywide' ? '#f0fdf4' : '#ffffff',
                    color: scopeMode === 'citywide' ? '#15803d' : '#475569',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                  }}
                  onClick={() => {
                    setScopeMode('citywide')
                    setSelectedBarangays([])
                  }}
                  data-testid="scope-citywide-btn"
                >
                  <Globe size={16} />
                  Citywide (All Residents)
                </button>
                <button
                  type="button"
                  style={{
                    flex: 1,
                    padding: '10px 14px',
                    borderRadius: '8px',
                    border: scopeMode === 'specific' ? '2px solid #16a34a' : '1px solid #cbd5e1',
                    background: scopeMode === 'specific' ? '#f0fdf4' : '#ffffff',
                    color: scopeMode === 'specific' ? '#15803d' : '#475569',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                  }}
                  onClick={() => setScopeMode('specific')}
                  data-testid="scope-specific-btn"
                >
                  <MapPin size={16} />
                  Specific Barangays
                </button>
              </div>

              {scopeMode === 'citywide' ? (
                <p style={{ fontSize: '0.775rem', color: '#64748b', margin: '6px 0 0' }}>
                  Citywide events are public to all Lucena City residents across all 33 barangays.
                </p>
              ) : (
                <div style={{ marginTop: '8px' }}>
                  <p style={{ fontSize: '0.775rem', color: '#64748b', margin: '0 0 8px' }}>
                    Select the target barangays for this event:
                  </p>
                  <div
                    style={{
                      maxHeight: '130px',
                      overflowY: 'auto',
                      border: '1px solid #e2e8f0',
                      borderRadius: '8px',
                      padding: '10px',
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                      gap: '8px',
                      background: '#f8fafc',
                    }}
                  >
                    {barangays.map((b) => (
                      <label
                        key={b.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          fontSize: '0.8rem',
                          color: '#334155',
                          cursor: 'pointer',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={selectedBarangays.includes(b.id)}
                          onChange={() => handleBarangayToggle(b.id)}
                          data-testid={`barangay-checkbox-${b.id}`}
                        />
                        <span>{b.name}</span>
                      </label>
                    ))}
                  </div>
                  {errors.barangays && <span className="form-error-text" data-testid="error-barangays">{errors.barangays}</span>}
                </div>
              )}
            </div>

            {/* Description */}
            <div className="form-group">
              <label htmlFor="event-description" className="form-label">
                Event Details & Instructions *
              </label>
              <textarea
                id="event-description"
                rows={4}
                className="form-textarea"
                placeholder="Provide event overview, designated meeting spots, items to bring, or guidelines..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={saving}
                data-testid="event-description-input"
              />
              {errors.description && <span className="form-error-text">{errors.description}</span>}
            </div>

            {/* Status (for new events: draft vs published) */}
            {!event && (
              <div className="form-group">
                <label htmlFor="event-initial-status" className="form-label">
                  Publication State
                </label>
                <select
                  id="event-initial-status"
                  className="form-select"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  disabled={saving}
                  data-testid="event-status-select"
                >
                  <option value="draft">Save as Draft (Private to Admins)</option>
                  <option value="published">Publish Immediately (Public + Notify)</option>
                </select>
                <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                  {status === 'published'
                    ? 'Publishing immediately will make this event visible on the portal and broadcast municipal notifications.'
                    : 'Drafts remain private to City Administration until published.'}
                </span>
              </div>
            )}

            {/* Cover Image Upload */}
            <div className="form-group">
              <span className="form-label">Cover Image (Optional)</span>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleImageChange}
              />
              {imagePreview ? (
                <div style={{ position: 'relative', width: 'fit-content', marginTop: '4px' }}>
                  <img
                    src={imagePreview}
                    alt="Event preview"
                    style={{ width: '100%', maxHeight: '160px', objectFit: 'cover', borderRadius: '8px', border: '1px solid #e2e8f0' }}
                  />
                  <button
                    type="button"
                    onClick={handleRemoveImage}
                    style={{
                      position: 'absolute',
                      top: '8px',
                      right: '8px',
                      background: 'rgba(239, 68, 68, 0.9)',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '6px',
                      padding: '4px 8px',
                      cursor: 'pointer',
                      fontSize: '0.75rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    <Trash2 size={12} />
                    Remove
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    border: '1px dashed #cbd5e1',
                    background: '#f8fafc',
                    color: '#475569',
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    width: 'fit-content',
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  data-testid="upload-image-btn"
                >
                  <Upload size={16} />
                  Upload Event Image
                </button>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="event-modal-footer">
            <button
              type="button"
              className="btn-refresh-event"
              onClick={onClose}
              disabled={saving}
              data-testid="cancel-editor-btn"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary-event"
              disabled={saving}
              data-testid="save-event-btn"
            >
              {saving ? 'Saving...' : event ? 'Update Event' : status === 'published' ? 'Publish Event' : 'Save Draft'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
