/**
 * NotificationCenter.jsx
 * ----------------------
 * Admin command center for broadcasting city-wide and barangay-level notifications.
 * Features:
 *   - Atomic backend broadcasts via POST /api/notifications/broadcast/
 *   - Atomic deletion via DELETE /api/notifications/broadcast/<bid>/
 *   - Grouped broadcast history with ?broadcast=1
 *   - Accurate delivery scopes (zero fabricated reach numbers)
 *   - Standard Lucide Loader2 animation
 *   - Responsive 2-column grid that folds neatly on mobile screens
 *   - Live resident mobile device preview card
 *   - Preset templates for rapid composing
 *   - Body scroll locking via useModal hook
 *   - Zero emojis — Material / Lucide React SVG icons only
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Bell,
  Send,
  Trash2,
  Copy,
  AlertTriangle,
  Megaphone,
  MapPin,
  Users,
  Search,
  Check,
  RotateCcw,
  Smartphone,
  Clock,
  Sparkles,
  ChevronRight,
  X,
  Loader2,
} from 'lucide-react'
import DashboardLayout from '../../components/DashboardLayout'
import { useAuth } from '../../context/AuthContext'
import { useNotification } from '../../context/NotificationContext'
import { useModal } from '../../hooks/useModal'
import api from '../../api/client'
import { getApiErrorMessage } from '../../utils/notificationHelpers'

// ─── Notification Types ────────────────────────────────────────────────────────
const BROADCAST_TYPES = {
  ANNOUNCEMENT: {
    label: 'Announcement',
    color: 'var(--accent)',
    bg: 'rgba(46,204,113,0.08)',
    border: 'rgba(46,204,113,0.25)',
    Icon: Megaphone,
    desc: 'Official city notices & general updates',
  },
  SCHEDULE_CHANGE: {
    label: 'Schedule Shift',
    color: '#f39c12',
    bg: 'rgba(243,156,18,0.08)',
    border: 'rgba(243,156,18,0.25)',
    Icon: Clock,
    desc: 'Truck delay or collection route adjustments',
  },
}

// ─── Quick Presets ─────────────────────────────────────────────────────────────
const PRESET_TEMPLATES = [
  {
    name: 'Schedule Delay',
    type: 'SCHEDULE_CHANGE',
    title: 'Garbage Collection Delayed',
    body: 'Waste collection trucks are running approximately 1-2 hours behind schedule today due to road maintenance.',
  },
  {
    name: 'Holiday Shift',
    type: 'SCHEDULE_CHANGE',
    title: 'Holiday Collection Schedule',
    body: 'Please note there will be no garbage collection on the upcoming public holiday. Normal collection resumes the following day.',
  },
  {
    name: 'Typhoon Alert',
    type: 'ANNOUNCEMENT',
    title: 'Typhoon Advisory: Secure Waste Bins',
    body: 'Lucena City CDRRMO advises all residents to secure garbage bins indoors and refrain from putting out waste during high winds.',
  },
  {
    name: 'Cleanup Drive',
    type: 'ANNOUNCEMENT',
    title: 'Community Clean-Up Drive',
    body: 'Join our city-wide cleanup drive this Saturday morning. Segregated biodegradable and recyclable waste will be collected.',
  },
]

const INITIAL_FORM = {
  type: 'ANNOUNCEMENT',
  title: '',
  body: '',
  target: 'city-wide', // 'city-wide' | 'barangay'
  barangayIds: [],
}

export default function NotificationCenter() {
  const { barangays: authBarangays } = useAuth()
  const { notify } = useNotification()

  const [broadcasts, setBroadcasts] = useState([])
  const [loading, setLoading] = useState(true)
  const [barangayList, setBarangayList] = useState(authBarangays || [])
  const [form, setForm] = useState(INITIAL_FORM)
  const [sending, setSending] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [filterType, setFilterType] = useState('all')
  const [search, setSearch] = useState('')
  const [selectedBroadcast, setSelectedBroadcast] = useState(null)
  const [confirmDeleteModal, setConfirmDeleteModal] = useState(null)

  // Modal scroll locking
  useModal(Boolean(selectedBroadcast), () => setSelectedBroadcast(null))
  useModal(Boolean(confirmDeleteModal), () => setConfirmDeleteModal(null))

  // Fetch barangays if not provided by context
  useEffect(() => {
    if (authBarangays && authBarangays.length > 0) {
      setBarangayList(authBarangays)
    } else {
      api.get('/api/auth/barangays/')
        .then(res => {
          if (Array.isArray(res.data)) setBarangayList(res.data)
        })
        .catch(() => {})
    }
  }, [authBarangays])

  // Lookup map for barangay names
  const barangayMap = useMemo(() => {
    const map = new Map()
    barangayList.forEach(b => map.set(Number(b.id), b.name))
    return map
  }, [barangayList])

  // Fetch broadcast notifications (?broadcast=1)
  const fetchBroadcasts = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get('/api/notifications/?broadcast=1')
      const raw = Array.isArray(res.data) ? res.data : []

      // Group rows by broadcast_id
      const grouped = new Map()
      raw.forEach(n => {
        if (!n.broadcast_id) return // Server-side ?broadcast=1 only delivers rows with broadcast_id
        const bid = n.broadcast_id
        if (!grouped.has(bid)) {
          grouped.set(bid, {
            broadcast_id: bid,
            sample_id: n.id,
            title: n.title,
            message: n.message,
            type: n.type || 'ANNOUNCEMENT',
            created_at: n.created_at,
            barangay_ids: [],
            barangay_names: [],
            is_citywide: !n.barangay,
            total_count: 0,
          })
        }
        const entry = grouped.get(bid)
        entry.total_count += 1
        if (n.barangay) {
          entry.is_citywide = false
          entry.barangay_ids.push(n.barangay)
          const bName = n.barangay_name || barangayMap.get(Number(n.barangay)) || `Barangay ${n.barangay}`
          if (!entry.barangay_names.includes(bName)) {
            entry.barangay_names.push(bName)
          }
        }
      })

      // Sort newest first
      const list = Array.from(grouped.values()).sort(
        (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)
      )
      setBroadcasts(list)
    } catch (err) {
      console.error('Failed to load broadcasts:', err)
      notify({ variant: 'error-solid', message: 'Could not load broadcast history.' })
    } finally {
      setLoading(false)
    }
  }, [barangayMap, notify])

  useEffect(() => {
    fetchBroadcasts()
  }, [fetchBroadcasts])

  function setField(key, value) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  function toggleBarangay(id) {
    const numId = Number(id)
    setForm(prev => {
      const exists = prev.barangayIds.includes(numId)
      return {
        ...prev,
        barangayIds: exists
          ? prev.barangayIds.filter(x => x !== numId)
          : [...prev.barangayIds, numId],
      }
    })
  }

  function selectAllBarangays() {
    setForm(prev => ({
      ...prev,
      barangayIds: barangayList.map(b => Number(b.id)),
    }))
  }

  function clearAllBarangays() {
    setForm(prev => ({ ...prev, barangayIds: [] }))
  }

  function applyPreset(preset) {
    setForm(prev => ({
      ...prev,
      type: preset.type,
      title: preset.title,
      body: preset.body,
    }))
    notify({ variant: 'success', message: `Preset "${preset.name}" applied.`, duration: 3000 })
  }

  function cloneBroadcast(b) {
    setForm({
      type: b.type,
      title: b.title,
      body: b.message,
      target: b.is_citywide ? 'city-wide' : 'barangay',
      barangayIds: b.barangay_ids ? [...b.barangay_ids] : [],
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
    notify({ variant: 'success', message: 'Broadcast template cloned into compose form.', duration: 3000 })
  }

  async function handleSend() {
    const trimmedTitle = form.title.trim()
    const trimmedBody = form.body.trim()

    if (!trimmedTitle) {
      notify({ variant: 'error-solid', message: 'Please enter a notification title.' })
      return
    }
    if (!trimmedBody) {
      notify({ variant: 'error-solid', message: 'Please enter a message body.' })
      return
    }

    if (form.target === 'barangay' && form.barangayIds.length === 0) {
      notify({ variant: 'error-solid', message: 'Please select at least one target barangay.' })
      return
    }

    setSending(true)
    try {
      const payload = {
        title: trimmedTitle,
        message: trimmedBody,
        type: form.type,
        barangay_ids: form.target === 'city-wide' ? null : form.barangayIds,
      }

      const res = await api.post('/api/notifications/broadcast/', payload)
      const count = res.data?.count || (form.target === 'city-wide' ? 1 : form.barangayIds.length)

      notify({
        variant: 'success',
        message: `Notification broadcast sent successfully to ${count} ${count === 1 ? 'target' : 'targets'}.`,
        duration: 6000,
      })

      setForm(INITIAL_FORM)
      await fetchBroadcasts()
    } catch (err) {
      console.error('Broadcast failed:', err)
      notify({ variant: 'error-dark', message: getApiErrorMessage(err, 'Failed to send broadcast.') })
    } finally {
      setSending(false)
    }
  }

  async function executeDelete(broadcast) {
    if (!broadcast || !broadcast.broadcast_id) return
    const bid = broadcast.broadcast_id

    setDeletingId(bid)
    try {
      await api.delete(`/api/notifications/broadcast/${bid}/`)

      notify({
        variant: 'success',
        message: 'Broadcast and associated notifications deleted.',
        duration: 6000,
      })
      setConfirmDeleteModal(null)
      if (selectedBroadcast?.broadcast_id === bid) {
        setSelectedBroadcast(null)
      }
      await fetchBroadcasts()
    } catch (err) {
      console.error('Delete failed:', err)
      notify({ variant: 'error-dark', message: getApiErrorMessage(err, 'Failed to delete broadcast.') })
    } finally {
      setDeletingId(null)
    }
  }

  // Filtered list
  const filteredBroadcasts = useMemo(() => {
    return broadcasts.filter(b => {
      const matchType = filterType === 'all' || b.type === filterType
      if (!matchType) return false

      if (!search.trim()) return true
      const q = search.toLowerCase().trim()
      const inTitle = (b.title || '').toLowerCase().includes(q)
      const inMsg = (b.message || '').toLowerCase().includes(q)
      const inTarget = b.is_citywide
        ? 'city-wide'.includes(q)
        : (b.barangay_names || []).some(n => n.toLowerCase().includes(q))

      return inTitle || inMsg || inTarget
    })
  }, [broadcasts, filterType, search])

  // Accurate target scope label (zero fabricated reach numbers)
  const targetScopeText = useMemo(() => {
    if (form.target === 'city-wide') {
      return 'City-Wide Audience (All Barangays)'
    }
    const count = form.barangayIds.length
    if (count === 0) return 'No Barangays Selected'
    return `${count} Selected Barangay${count === 1 ? '' : 's'}`
  }, [form.target, form.barangayIds.length])

  return (
    <DashboardLayout>
      <style>{`
        .nc-main-grid {
          display: grid;
          grid-template-columns: minmax(320px, 460px) 1fr;
          gap: 20px;
          align-items: start;
        }
        @media (max-width: 920px) {
          .nc-main-grid {
            grid-template-columns: 1fr;
          }
        }
        @keyframes nc-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .nc-spin {
          animation: nc-spin 1s linear infinite;
        }
      `}</style>

      <div className="page" style={{ maxWidth: 1280, margin: '0 auto', paddingBottom: 40 }}>
        {/* Page Header */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 12,
                  background: 'rgba(46,204,113,0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--accent)',
                  border: '1px solid rgba(46,204,113,0.25)',
                }}
              >
                <Bell size={22} strokeWidth={2.2} />
              </div>
              <div>
                <h1 style={{ fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 800, margin: 0, color: 'var(--text)' }}>
                  Notification Center
                </h1>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
                  Deliver coordinated broadcasts to Lucena City residents and barangay units.
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  background: 'rgba(46,204,113,0.1)',
                  color: 'var(--accent)',
                  border: '1px solid rgba(46,204,113,0.3)',
                  fontSize: 10,
                  fontWeight: 800,
                  padding: '4px 10px',
                  borderRadius: 20,
                  letterSpacing: '.06em',
                }}
              >
                ATOMIC BROADCAST
              </span>
            </div>
          </div>
        </div>

        {/* Top Summary Cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 12,
            marginBottom: 20,
          }}
        >
          <div
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 14,
              padding: '14px 16px',
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '.05em', textTransform: 'uppercase' }}>
              Total Broadcasts
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text)', marginTop: 4 }}>
              {broadcasts.length}
            </div>
          </div>

          <div
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 14,
              padding: '14px 16px',
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '.05em', textTransform: 'uppercase' }}>
              General Announcements
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--accent)', marginTop: 4 }}>
              {broadcasts.filter(b => b.type === 'ANNOUNCEMENT').length}
            </div>
          </div>

          <div
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 14,
              padding: '14px 16px',
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '.05em', textTransform: 'uppercase' }}>
              Schedule Shifts
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, color: '#f39c12', marginTop: 4 }}>
              {broadcasts.filter(b => b.type === 'SCHEDULE_CHANGE').length}
            </div>
          </div>

          <div
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 14,
              padding: '14px 16px',
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '.05em', textTransform: 'uppercase' }}>
              Available Barangays
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text)', marginTop: 4 }}>
              {barangayList.length}
            </div>
          </div>
        </div>

        {/* 2-Column Responsive Layout */}
        <div className="nc-main-grid">
          
          {/* ── Left Column: Compose & Resident Preview ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            
            {/* Quick Presets Bar */}
            <div
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 16,
                padding: '14px 16px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                <Sparkles size={14} strokeWidth={2} style={{ color: 'var(--accent)' }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
                  Quick Fill Presets
                </span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {PRESET_TEMPLATES.map(p => (
                  <button
                    key={p.name}
                    type="button"
                    onClick={() => applyPreset(p)}
                    style={{
                      padding: '5px 10px',
                      borderRadius: 8,
                      border: '1px solid var(--border)',
                      background: 'var(--surface-2)',
                      color: 'var(--text-muted)',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      transition: 'all .15s',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.borderColor = 'var(--accent)'
                      e.currentTarget.style.color = 'var(--text)'
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.borderColor = 'var(--border)'
                      e.currentTarget.style.color = 'var(--text-muted)'
                    }}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Compose Card */}
            <div
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 16,
                padding: '20px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Send size={16} strokeWidth={2} style={{ color: 'var(--accent)' }} />
                  <span style={{ fontWeight: 800, fontSize: 15, color: 'var(--text)' }}>
                    Compose Broadcast
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setForm(INITIAL_FORM)}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--text-muted)',
                    fontSize: 11,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <RotateCcw size={12} />
                  Reset
                </button>
              </div>

              {/* Type selector */}
              <div style={{ marginBottom: 14 }}>
                <label className="form-label">Notification Type</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {Object.entries(BROADCAST_TYPES).map(([typeKey, cfg]) => {
                    const isSelected = form.type === typeKey
                    const { Icon } = cfg
                    return (
                      <button
                        key={typeKey}
                        type="button"
                        onClick={() => setField('type', typeKey)}
                        style={{
                          padding: '10px 12px',
                          borderRadius: 10,
                          border: `1.5px solid ${isSelected ? cfg.color : 'var(--border)'}`,
                          background: isSelected ? cfg.bg : 'var(--surface-2)',
                          color: isSelected ? cfg.color : 'var(--text-muted)',
                          fontWeight: 700,
                          fontSize: 12,
                          fontFamily: 'inherit',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          transition: 'all .15s',
                        }}
                      >
                        <Icon size={16} strokeWidth={2.2} />
                        <span>{cfg.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Title input */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <label className="form-label" style={{ margin: 0 }}>Title</label>
                  <span style={{ fontSize: 10, color: form.title.length > 180 ? 'var(--danger)' : 'var(--text-muted)' }}>
                    {form.title.length}/200
                  </span>
                </div>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g., Collection Schedule Update"
                  value={form.title}
                  onChange={e => setField('title', e.target.value)}
                  maxLength={200}
                />
              </div>

              {/* Message body input */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <label className="form-label" style={{ margin: 0 }}>Message Body</label>
                  <span style={{ fontSize: 10, color: form.body.length > 4800 ? 'var(--danger)' : 'var(--text-muted)' }}>
                    {form.body.length}/5000
                  </span>
                </div>
                <textarea
                  className="form-input"
                  placeholder="Provide clear details for residents..."
                  rows={4}
                  value={form.body}
                  onChange={e => setField('body', e.target.value)}
                  style={{ resize: 'vertical' }}
                  maxLength={5000}
                />
              </div>

              {/* Target Selection */}
              <div style={{ marginBottom: 14 }}>
                <label className="form-label">Audience Target</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                  <button
                    type="button"
                    onClick={() => setField('target', 'city-wide')}
                    style={{
                      padding: '8px 12px',
                      borderRadius: 10,
                      border: `1.5px solid ${form.target === 'city-wide' ? 'var(--accent)' : 'var(--border)'}`,
                      background: form.target === 'city-wide' ? 'rgba(46,204,113,0.08)' : 'var(--surface-2)',
                      color: form.target === 'city-wide' ? 'var(--accent)' : 'var(--text-muted)',
                      fontWeight: 700,
                      fontSize: 12,
                      fontFamily: 'inherit',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                    }}
                  >
                    <Users size={14} />
                    <span>City-Wide</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setField('target', 'barangay')}
                    style={{
                      padding: '8px 12px',
                      borderRadius: 10,
                      border: `1.5px solid ${form.target === 'barangay' ? 'var(--accent)' : 'var(--border)'}`,
                      background: form.target === 'barangay' ? 'rgba(46,204,113,0.08)' : 'var(--surface-2)',
                      color: form.target === 'barangay' ? 'var(--accent)' : 'var(--text-muted)',
                      fontWeight: 700,
                      fontSize: 12,
                      fontFamily: 'inherit',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                    }}
                  >
                    <MapPin size={14} />
                    <span>Specific Barangays</span>
                  </button>
                </div>

                {/* Barangay Selection Cloud */}
                {form.target === 'barangay' && (
                  <div
                    style={{
                      background: 'var(--surface-2)',
                      borderRadius: 12,
                      padding: '12px',
                      border: '1px solid var(--border)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>
                        Select Target Barangays ({form.barangayIds.length} chosen)
                      </span>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          type="button"
                          onClick={selectAllBarangays}
                          style={{
                            background: 'none',
                            border: 'none',
                            fontSize: 10,
                            fontWeight: 700,
                            color: 'var(--accent)',
                            cursor: 'pointer',
                            padding: 0,
                          }}
                        >
                          Select All
                        </button>
                        <span style={{ fontSize: 10, color: 'var(--border)' }}>|</span>
                        <button
                          type="button"
                          onClick={clearAllBarangays}
                          style={{
                            background: 'none',
                            border: 'none',
                            fontSize: 10,
                            fontWeight: 700,
                            color: 'var(--text-muted)',
                            cursor: 'pointer',
                            padding: 0,
                          }}
                        >
                          Clear
                        </button>
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 180, overflowY: 'auto' }}>
                      {barangayList.map(b => {
                        const numId = Number(b.id)
                        const isSelected = form.barangayIds.includes(numId)
                        return (
                          <button
                            key={b.id}
                            type="button"
                            onClick={() => toggleBarangay(numId)}
                            style={{
                              padding: '4px 10px',
                              borderRadius: 20,
                              fontSize: 11,
                              fontWeight: 600,
                              fontFamily: 'inherit',
                              border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                              background: isSelected ? 'rgba(46,204,113,0.15)' : 'var(--surface)',
                              color: isSelected ? 'var(--accent)' : 'var(--text-muted)',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              transition: 'all .12s',
                            }}
                          >
                            {isSelected && <Check size={11} strokeWidth={2.5} />}
                            {b.name}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Target Scope Status */}
              <div
                style={{
                  background: 'var(--surface-2)',
                  borderRadius: 10,
                  padding: '10px 14px',
                  marginBottom: 16,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  border: '1px solid var(--border)',
                }}
              >
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '.05em' }}>
                    DELIVERY TARGET
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginTop: 2 }}>
                    {targetScopeText}
                  </div>
                </div>
                <Users size={18} strokeWidth={1.8} style={{ color: 'var(--accent)' }} />
              </div>

              {/* Send Button */}
              <button
                type="button"
                onClick={handleSend}
                disabled={sending}
                style={{
                  width: '100%',
                  padding: '12px',
                  borderRadius: 12,
                  border: 'none',
                  background: sending ? 'rgba(46,204,113,0.4)' : 'var(--accent)',
                  color: '#0d1117',
                  fontWeight: 800,
                  fontSize: 14,
                  fontFamily: 'inherit',
                  cursor: sending ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  transition: 'opacity .15s',
                }}
              >
                {sending ? (
                  <>
                    <Loader2 size={16} strokeWidth={2.5} className="nc-spin" />
                    Broadcasting...
                  </>
                ) : (
                  <>
                    <Send size={15} strokeWidth={2.2} />
                    Dispatch Broadcast
                  </>
                )}
              </button>
            </div>

            {/* ── Resident Mobile Preview Card ── */}
            <div
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 16,
                padding: '18px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                <Smartphone size={15} strokeWidth={2} style={{ color: 'var(--accent)' }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
                  Resident Mobile Notification Preview
                </span>
              </div>

              {/* Phone Shell representation */}
              <div
                style={{
                  background: '#090d16',
                  borderRadius: 16,
                  padding: '12px 14px',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: '#fff',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
                }}
              >
                {/* Status Bar */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10, color: 'rgba(255,255,255,0.6)', marginBottom: 10 }}>
                  <span>9:41 AM</span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <span>5G</span>
                    <span>100%</span>
                  </div>
                </div>

                {/* Banner Notification Card */}
                <div
                  style={{
                    background: 'rgba(255,255,255,0.08)',
                    borderRadius: 12,
                    padding: '10px 12px',
                    backdropFilter: 'blur(10px)',
                    border: '1px solid rgba(255,255,255,0.12)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <div
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 6,
                        background: 'var(--accent)',
                        color: '#0d1117',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 900,
                        fontSize: 10,
                      }}
                    >
                      WW
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.9)' }}>
                      WasteWatch Lucena
                    </span>
                    <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.45)', marginLeft: 'auto' }}>
                      now
                    </span>
                  </div>

                  <div style={{ fontWeight: 700, fontSize: 12, color: '#fff', marginBottom: 2 }}>
                    {form.title.trim() || 'Notification Title Preview'}
                  </div>

                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', lineHeight: 1.4 }}>
                    {form.body.trim() || 'Enter title and message above to preview real-time delivery to residents.'}
                  </div>

                  <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--accent)' }}>
                    <MapPin size={10} />
                    <span>
                      {form.target === 'city-wide'
                        ? 'City-Wide Alert'
                        : form.barangayIds.length === 0
                        ? 'Select Barangays'
                        : `${form.barangayIds.length} Selected Barangays`}
                    </span>
                  </div>
                </div>
              </div>
            </div>

          </div>

          {/* ── Right Column: Broadcast History ── */}
          <div>
            {/* Filter and Search Bar */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                flexWrap: 'wrap',
                marginBottom: 14,
              }}
            >
              <div style={{ display: 'flex', gap: 4, background: 'var(--surface-2)', padding: 3, borderRadius: 10, border: '1px solid var(--border)' }}>
                <button
                  type="button"
                  onClick={() => setFilterType('all')}
                  style={{
                    padding: '5px 12px',
                    borderRadius: 8,
                    border: 'none',
                    fontSize: 12,
                    fontWeight: 600,
                    fontFamily: 'inherit',
                    background: filterType === 'all' ? 'var(--surface)' : 'transparent',
                    color: filterType === 'all' ? 'var(--text)' : 'var(--text-muted)',
                    cursor: 'pointer',
                    boxShadow: filterType === 'all' ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
                  }}
                >
                  All ({broadcasts.length})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterType('ANNOUNCEMENT')}
                  style={{
                    padding: '5px 12px',
                    borderRadius: 8,
                    border: 'none',
                    fontSize: 12,
                    fontWeight: 600,
                    fontFamily: 'inherit',
                    background: filterType === 'ANNOUNCEMENT' ? 'var(--surface)' : 'transparent',
                    color: filterType === 'ANNOUNCEMENT' ? 'var(--accent)' : 'var(--text-muted)',
                    cursor: 'pointer',
                    boxShadow: filterType === 'ANNOUNCEMENT' ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
                  }}
                >
                  Announcements
                </button>
                <button
                  type="button"
                  onClick={() => setFilterType('SCHEDULE_CHANGE')}
                  style={{
                    padding: '5px 12px',
                    borderRadius: 8,
                    border: 'none',
                    fontSize: 12,
                    fontWeight: 600,
                    fontFamily: 'inherit',
                    background: filterType === 'SCHEDULE_CHANGE' ? 'var(--surface)' : 'transparent',
                    color: filterType === 'SCHEDULE_CHANGE' ? '#f39c12' : 'var(--text-muted)',
                    cursor: 'pointer',
                    boxShadow: filterType === 'SCHEDULE_CHANGE' ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
                  }}
                >
                  Schedule Shifts
                </button>
              </div>

              {/* Search input */}
              <div style={{ position: 'relative', minWidth: 200, flex: 1, maxWidth: 300 }}>
                <Search
                  size={14}
                  strokeWidth={2}
                  style={{
                    position: 'absolute',
                    left: 10,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--text-muted)',
                  }}
                />
                <input
                  type="text"
                  className="form-input"
                  placeholder="Search broadcasts..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  style={{ paddingLeft: 30, fontSize: 12 }}
                />
              </div>
            </div>

            {/* List */}
            {loading ? (
              <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                <Loader2 size={24} className="nc-spin" style={{ display: 'block', margin: '0 auto 10px' }} />
                Loading broadcasts...
              </div>
            ) : filteredBroadcasts.length === 0 ? (
              <div
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 16,
                  padding: '60px 20px',
                  textAlign: 'center',
                }}
              >
                <Bell size={36} strokeWidth={1.5} style={{ color: 'var(--text-muted)', display: 'block', margin: '0 auto 12px' }} />
                <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)', marginBottom: 4 }}>
                  No Broadcasts Found
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  {search ? `No broadcasts match "${search}".` : 'Compose your first broadcast on the left.'}
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {filteredBroadcasts.map(b => {
                  const cfg = BROADCAST_TYPES[b.type] || BROADCAST_TYPES.ANNOUNCEMENT
                  const { Icon } = cfg
                  const formattedDate = (() => {
                    try {
                      return new Date(b.created_at).toLocaleString('en-PH', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    } catch {
                      return b.created_at
                    }
                  })()

                  const isDeleting = deletingId === b.broadcast_id

                  return (
                    <div
                      key={b.broadcast_id}
                      style={{
                        background: 'var(--surface)',
                        border: '1px solid var(--border)',
                        borderLeft: `4px solid ${cfg.color}`,
                        borderRadius: 14,
                        padding: '16px 18px',
                        transition: 'box-shadow .15s, border-color .15s',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              fontSize: 9,
                              fontWeight: 800,
                              padding: '2px 8px',
                              borderRadius: 20,
                              background: cfg.bg,
                              color: cfg.color,
                              border: `1px solid ${cfg.border}`,
                              textTransform: 'uppercase',
                              letterSpacing: '.06em',
                            }}
                          >
                            <Icon size={10} strokeWidth={2.5} />
                            {cfg.label}
                          </span>

                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              fontSize: 10,
                              color: 'var(--text-muted)',
                            }}
                          >
                            <Clock size={11} strokeWidth={2} />
                            {formattedDate}
                          </span>
                        </div>

                        {/* Actions */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <button
                            type="button"
                            onClick={() => cloneBroadcast(b)}
                            title="Clone to compose form"
                            aria-label="Clone broadcast"
                            style={{
                              background: 'var(--surface-2)',
                              border: '1px solid var(--border)',
                              borderRadius: 8,
                              padding: '5px 8px',
                              cursor: 'pointer',
                              color: 'var(--text-muted)',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                              fontSize: 11,
                              fontFamily: 'inherit',
                              transition: 'all .12s',
                            }}
                            onMouseEnter={e => {
                              e.currentTarget.style.borderColor = 'var(--accent)'
                              e.currentTarget.style.color = 'var(--text)'
                            }}
                            onMouseLeave={e => {
                              e.currentTarget.style.borderColor = 'var(--border)'
                              e.currentTarget.style.color = 'var(--text-muted)'
                            }}
                          >
                            <Copy size={12} />
                            Clone
                          </button>

                          <button
                            type="button"
                            onClick={() => setConfirmDeleteModal(b)}
                            disabled={isDeleting}
                            title="Delete this broadcast"
                            aria-label="Delete broadcast"
                            style={{
                              background: 'rgba(231,76,60,0.06)',
                              border: '1px solid rgba(231,76,60,0.2)',
                              borderRadius: 8,
                              padding: '5px 8px',
                              cursor: isDeleting ? 'not-allowed' : 'pointer',
                              color: '#e74c3c',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                              fontSize: 11,
                              fontFamily: 'inherit',
                              transition: 'all .12s',
                            }}
                            onMouseEnter={e => {
                              e.currentTarget.style.background = 'rgba(231,76,60,0.15)'
                            }}
                            onMouseLeave={e => {
                              e.currentTarget.style.background = 'rgba(231,76,60,0.06)'
                            }}
                          >
                            <Trash2 size={12} />
                            {isDeleting ? 'Deleting...' : 'Delete'}
                          </button>
                        </div>
                      </div>

                      {/* Title */}
                      <div
                        style={{
                          fontWeight: 700,
                          fontSize: 15,
                          color: 'var(--text)',
                          lineHeight: 1.3,
                          marginBottom: 6,
                          cursor: 'pointer',
                        }}
                        onClick={() => setSelectedBroadcast(b)}
                      >
                        {b.title}
                      </div>

                      {/* Message preview */}
                      <div
                        style={{
                          fontSize: 12,
                          color: 'var(--text-muted)',
                          lineHeight: 1.6,
                          marginBottom: 10,
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
                      >
                        {b.message}
                      </div>

                      {/* Meta Footer */}
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 10,
                          flexWrap: 'wrap',
                          fontSize: 11,
                          color: 'var(--text-muted)',
                          paddingTop: 8,
                          borderTop: '1px solid var(--border)',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <MapPin size={12} strokeWidth={2} style={{ color: 'var(--accent)' }} />
                          <span style={{ fontWeight: 600, color: 'var(--text)' }}>
                            {b.is_citywide
                              ? 'City-Wide Audience'
                              : b.barangay_names && b.barangay_names.length > 0
                              ? b.barangay_names.join(', ')
                              : `${b.total_count} Barangays`}
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={() => setSelectedBroadcast(b)}
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            color: 'var(--accent)',
                            fontSize: 11,
                            fontWeight: 700,
                            padding: 0,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 2,
                          }}
                        >
                          Details
                          <ChevronRight size={13} strokeWidth={2.5} />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

        </div>

        {/* ── Broadcast Detail Modal ── */}
        {selectedBroadcast && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="broadcast-detail-title"
            onClick={e => e.target === e.currentTarget && setSelectedBroadcast(null)}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.6)',
              backdropFilter: 'blur(4px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 9999,
              padding: 16,
            }}
          >
            <div
              style={{
                background: 'var(--surface)',
                borderRadius: 16,
                padding: '24px',
                width: '100%',
                maxWidth: 500,
                boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
                border: '1px solid var(--border)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <span id="broadcast-detail-title" style={{ fontWeight: 800, fontSize: 16, color: 'var(--text)' }}>
                  Broadcast Details
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedBroadcast(null)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
                  aria-label="Close details"
                >
                  <X size={18} />
                </button>
              </div>

              <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--text)', marginBottom: 6 }}>
                {selectedBroadcast.title}
              </div>

              <div
                style={{
                  background: 'var(--surface-2)',
                  borderRadius: 10,
                  padding: '12px 14px',
                  fontSize: 13,
                  lineHeight: 1.6,
                  color: 'var(--text)',
                  marginBottom: 16,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {selectedBroadcast.message}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, marginBottom: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Target Audience</span>
                  <span style={{ fontWeight: 700, color: 'var(--text)' }}>
                    {selectedBroadcast.is_citywide
                      ? 'City-Wide (All Lucena Residents)'
                      : selectedBroadcast.barangay_names?.join(', ') || 'Selected Barangays'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Broadcast ID</span>
                  <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)' }}>
                    {selectedBroadcast.broadcast_id}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Notification Rows</span>
                  <span style={{ fontWeight: 700, color: 'var(--text)' }}>
                    {selectedBroadcast.total_count} recipient row{selectedBroadcast.total_count === 1 ? '' : 's'}
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => {
                    cloneBroadcast(selectedBroadcast)
                    setSelectedBroadcast(null)
                  }}
                  style={{ display: 'flex', alignItems: 'center', gap: 5 }}
                >
                  <Copy size={13} />
                  Clone to Compose
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setSelectedBroadcast(null)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Confirmation Delete Modal ── */}
        {confirmDeleteModal && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-delete-title"
            onClick={e => e.target === e.currentTarget && setConfirmDeleteModal(null)}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.65)',
              backdropFilter: 'blur(4px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 9999,
              padding: 16,
            }}
          >
            <div
              style={{
                background: 'var(--surface)',
                borderRadius: 16,
                padding: '24px',
                width: '100%',
                maxWidth: 420,
                border: '1px solid var(--border)',
                boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    background: 'rgba(231,76,60,0.1)',
                    color: '#e74c3c',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <AlertTriangle size={18} strokeWidth={2.2} />
                </div>
                <h3 id="confirm-delete-title" style={{ margin: 0, fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>
                  Delete Broadcast?
                </h3>
              </div>

              <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 18 }}>
                Are you sure you want to delete &ldquo;{confirmDeleteModal.title}&rdquo;? This will atomically remove this notification from all recipient feeds and cannot be undone.
              </p>

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setConfirmDeleteModal(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => executeDelete(confirmDeleteModal)}
                  style={{
                    background: '#e74c3c',
                    color: '#fff',
                    border: 'none',
                    padding: '8px 16px',
                    borderRadius: 8,
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <Trash2 size={14} />
                  Delete Now
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </DashboardLayout>
  )
}
