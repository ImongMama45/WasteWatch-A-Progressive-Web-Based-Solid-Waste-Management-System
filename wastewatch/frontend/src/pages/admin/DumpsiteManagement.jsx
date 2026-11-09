/**
 * pages/admin/DumpsiteManagement.jsx
 * ------------------------------------
 * Admin: Map-based dumpsite & landfill management.
 * - Click map to place a new pin
 * - Fill in name, type, barangay, capacity
 * - Edit or remove existing pins
 * - Marker icons differ by type (landfill vs dumpsite vs transfer)
 * Uses same Leaflet CDN approach as MapView.jsx
 */

import { useEffect, useRef, useState, useMemo } from 'react'
import DashboardLayout from '../../components/DashboardLayout'
import { useDumpsites } from '../../hooks/useDumpsites'
import { useNotification } from '../../context/NotificationContext'
import api from '../../api/client'
import { getApiErrorMessage } from '../../utils/notificationHelpers'
import { FeedCardSkeleton, MapSkeleton } from '../../components/ui/Skeleton'

const LUCENA_CENTER = [13.9373, 121.617]

const TYPES = [
  { value: 'landfill', label: 'Landfill', color: '#dc2626' },
  { value: 'dumpsite', label: 'Open Dumpsite', color: '#d97706' },
  { value: 'transfer', label: 'Transfer Station', color: '#2563eb' },
  { value: 'composting', label: 'Composting Area', color: '#16a34a' },
]

function TypeIcon({ type, size = 16, color = 'currentColor' }) {
  if (type === 'landfill') {
    return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3l4 8 5-5 5 15H2L8 3z"/></svg>
  }
  if (type === 'transfer') {
    return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/></svg>
  }
  if (type === 'composting') {
    return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a10 10 0 0 0-9.95 9h11.64L9.74 7.05a1 1 0 0 1 1.41-1.41l5.66 5.65a1 1 0 0 1 0 1.42l-5.66 5.65a1 1 0 0 1-1.41-1.41L13.69 13H2.05A10 10 0 1 0 12 2z"/></svg>
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
}

const typeMap = Object.fromEntries(TYPES.map(t => [t.value, t]))

const EMPTY_FORM = { name: '', type: 'dumpsite', barangay: '', notes: '' }
const EMPTY_ACCOUNT = { full_name: '', email: '', password: '' }

// ── Geometry & Geofence Utils ────────────────────────────────────────────────
function pointInPolygon(point, vs) {
  const x = point[0], y = point[1]; let inside = false
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i][0], yi = vs[i][1], xj = vs[j][0], yj = vs[j][1]
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside
  }
  return inside
}

function detectBarangay(lat, lng, geoJson) {
  if (!geoJson?.features) return null
  for (const f of geoJson.features) {
    if (f.geometry.type === 'Polygon') { if (pointInPolygon([lng, lat], f.geometry.coordinates[0])) return f.properties.brgy_name }
    else if (f.geometry.type === 'MultiPolygon') { for (const p of f.geometry.coordinates) { if (pointInPolygon([lng, lat], p[0])) return f.properties.brgy_name } }
  }
  return null
}

const matchName = (dbName, geoName) => {
  if (!geoName) return false
  const n1 = dbName.toLowerCase().trim()
  const n2 = geoName.toLowerCase().trim()
  if (n1 === n2) return true
  if (n1 === 'kanlurang mayao' && n2 === 'mayao kanluran') return true
  if (n1 === 'mayao kanluran' && n2 === 'kanlurang mayao') return true
  return false
}

// ── Marker HTML by type ───────────────────────────────────────────────────────

function markerHtml(type) {
  const t = typeMap[type] || TYPES[1]
  const svgIcons = {
    landfill: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3l4 8 5-5 5 15H2L8 3z"/></svg>`,
    dumpsite: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
    transfer: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/></svg>`,
    composting: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a10 10 0 0 0-9.95 9h11.64L9.74 7.05a1 1 0 0 1 1.41-1.41l5.66 5.65a1 1 0 0 1 0 1.42l-5.66 5.65a1 1 0 0 1-1.41-1.41L13.69 13H2.05A10 10 0 1 0 12 2z"/></svg>`
  }
  const innerSvg = svgIcons[type] || svgIcons.dumpsite
  return `<div style="
    background:${t.color};border:2px solid white;border-radius:50% 50% 50% 0;
    transform:rotate(-45deg);width:34px;height:34px;
    display:flex;align-items:center;justify-content:center;
    box-shadow:0 3px 10px rgba(0,0,0,0.35);">
    <div style="transform:rotate(45deg);display:flex;align-items:center;justify-content:center;">${innerSvg}</div>
  </div>`
}

function pendingMarkerHtml() {
  return `<div style="
    background:#fff;border:2.5px dashed #d97706;border-radius:50%;
    width:34px;height:34px;display:flex;align-items:center;justify-content:center;
    box-shadow:0 3px 10px rgba(0,0,0,0.25);
    animation:ww-blink 1s infinite;">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1 1 18 0z"/>
      <circle cx="12" cy="10" r="3"/>
    </svg>
  </div>`
}

// ── Modal ─────────────────────────────────────────────────────────────────

function SiteModal({ site, coords, onSave, onClose, barangays, barangayGeo }) {
  const isEdit = !!site

  const [form, setForm] = useState(
    isEdit
      ? { name: site.name, type: site.type, barangay: site.barangay, notes: site.notes || '', lat: site.latitude || '', lng: site.longitude || '' }
      : { ...EMPTY_FORM, lat: coords?.[0] || '', lng: coords?.[1] || '' }
  )
  const [account, setAccount] = useState({ ...EMPTY_ACCOUNT })
  const [detecting, setDetecting] = useState(false)
  const [detectedName, setDetectedName] = useState('')
  const [err, setErr] = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const setAc = (k, v) => setAccount(a => ({ ...a, [k]: v }))

  // ── Auto-detect barangay from coords via GeoJSON ──
  useEffect(() => {
    if (!form.lat || !form.lng || isNaN(form.lat) || isNaN(form.lng)) {
      setDetectedName('')
      return
    }
    setDetecting(true)
    const detected = detectBarangay(Number(form.lat), Number(form.lng), barangayGeo)
    setDetectedName(detected || '')
    if (detected) {
      const match = barangays.find(b => matchName(b.name, detected))
      if (match) set('barangay', match.id)
    }
    setDetecting(false)
  }, [form.lat, form.lng, barangayGeo, barangays])

  function submit() {
    if (!form.name.trim()) { setErr('Site name is required.'); return }
    if (!form.lat || !form.lng || isNaN(form.lat) || isNaN(form.lng)) { setErr('Valid coordinates are required.'); return }
    
    const detected = detectBarangay(Number(form.lat), Number(form.lng), barangayGeo)
    if (!detected) {
      setErr('Location is out of bounds (outside Lucena City boundaries).')
      return
    }

    if (!form.barangay) { setErr('Please select a barangay.'); return }
    if (!isEdit) {
      if (!account.full_name.trim()) { setErr('Account full name is required.'); return }
      if (!account.email.trim()) { setErr('Account email is required.'); return }
      if (account.password.length < 6) { setErr('Password must be at least 6 characters.'); return }
    }
    setErr('')
    onSave(form, account)
  }

  const SectionHead = ({ label }) => (
    <div style={{
      fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase',
      color: '#65676b', marginBottom: 10, marginTop: 8,
      paddingBottom: 6, borderBottom: '1px solid #e4e6eb',
    }}>{label}</div>
  )

  return (
    <div className="dm-modal-ov" style={{ zIndex: 2000, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(3px)' }} onClick={onClose}>
      <div className="meta-card" style={{ padding: 0, width: '100%', maxWidth: 480, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: 8, boxShadow: '0 8px 30px rgba(0,0,0,0.15)' }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #e4e6eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontFamily: 'var(--font-head, inherit)', fontWeight: 700, fontSize: 17, margin: 0, color: '#1c1e21' }}>
            {isEdit ? 'Edit Site' : 'Add New Disposal Site'}
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#65676b', padding: '0 4px', lineHeight: 1 }}>×</button>
        </div>

        {/* Scrollable body */}
        <div style={{ overflowY: 'auto', padding: '16px 20px', maxHeight: '78vh' }}>

          {/* Coords + auto-detect status */}
          {coords && !isEdit && (
            <div style={{
              background: '#e7f5eb', border: '1px solid #bbf7d0',
              borderRadius: 6, padding: '8px 12px', fontSize: 12, marginBottom: 16,
              display: 'flex', alignItems: 'center', gap: 8, color: '#15803d'
            }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
              <span style={{ fontWeight: 700 }}>Pinned Coordinates</span>
              {detecting && <span style={{ color: '#65676b', fontStyle: 'italic' }}>Detecting barangay…</span>}
              {!detecting && detectedName && (
                <span style={{ color: '#65676b' }}>· Detected: <strong style={{ color: '#1c1e21' }}>{detectedName}</strong></span>
              )}
            </div>
          )}

          {err && (
            <div style={{
              background: '#fee2e2', border: '1px solid #fecaca',
              borderRadius: 6, padding: '8px 12px', fontSize: 12, color: '#b91c1c', marginBottom: 14, fontWeight: 500
            }}>{err}</div>
          )}

          {/* ── Site Info ── */}
          <SectionHead label="Site Information" />

          <div style={{ marginBottom: 12 }}>
            <label className="dm-label" style={{ fontSize: 11, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 5 }}>Site Name</label>
            <input className="meta-input" value={form.name}
              onChange={e => set('name', e.target.value)}
              placeholder="e.g. Main Landfill — Gulang-Gulang"
              style={{ width: '100%', height: 36, borderRadius: 6, border: '1px solid #ced0d4', padding: '0 10px', fontSize: 13, background: '#ffffff', color: '#1c1e21' }} />
          </div>

          <SectionHead label="Location Coordinates" />
          <div style={{
            display: 'grid',
            gridTemplateColumns: window.innerWidth < 768 ? '1fr' : '1fr 1fr',
            gap: 12,
            marginBottom: 14,
          }}>
            <div>
              <label className="dm-label" style={{ fontSize: 11, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 5 }}>Latitude</label>
              <input className="meta-input" type="number" step="any" value={form.lat}
                onChange={e => set('lat', e.target.value)}
                placeholder="e.g. 13.9373"
                style={{ width: '100%', height: 36, borderRadius: 6, border: '1px solid #ced0d4', padding: '0 10px', fontSize: 13, background: '#ffffff', color: '#1c1e21' }} />
            </div>
            <div>
              <label className="dm-label" style={{ fontSize: 11, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 5 }}>Longitude</label>
              <input className="meta-input" type="number" step="any" value={form.lng}
                onChange={e => set('lng', e.target.value)}
                placeholder="e.g. 121.617"
                style={{ width: '100%', height: 36, borderRadius: 6, border: '1px solid #ced0d4', padding: '0 10px', fontSize: 13, background: '#ffffff', color: '#1c1e21' }} />
            </div>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: window.innerWidth < 768 ? '1fr' : '1fr 1fr',
            gap: 12,
            marginBottom: 14,
          }}>
            <div>
              <label className="dm-label" style={{ fontSize: 11, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 5 }}>Facility Type</label>
              <select className="meta-input" value={form.type} onChange={e => set('type', e.target.value)} style={{ width: '100%', height: 36, borderRadius: 6, border: '1px solid #ced0d4', padding: '0 10px', fontSize: 13, background: '#ffffff', color: '#1c1e21' }}>
                {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="dm-label" style={{ fontSize: 11, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', letterSpacing: '.04em', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                Barangay
                {detecting && <span style={{ fontSize: 10, color: '#65676b', fontStyle: 'italic', fontWeight: 400 }}>detecting…</span>}
              </label>
              <select className="meta-input" value={form.barangay} onChange={e => set('barangay', e.target.value)} style={{ width: '100%', height: 36, borderRadius: 6, border: '1px solid #ced0d4', padding: '0 10px', fontSize: 13, background: '#ffffff', color: '#1c1e21' }}>
                <option value="">{detecting ? 'Detecting…' : '— Select Barangay —'}</option>
                {barangays.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label className="dm-label" style={{ fontSize: 11, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 5 }}>Notes (optional)</label>
            <textarea className="meta-input" rows={2} value={form.notes}
              onChange={e => set('notes', e.target.value)} placeholder="Operational instructions or access notes…"
              style={{ width: '100%', minHeight: 64, borderRadius: 6, border: '1px solid #ced0d4', padding: '8px 10px', fontSize: 13, background: '#ffffff', color: '#1c1e21', resize: 'vertical', height: 'auto' }} />
          </div>

          {/* ── Account Credentials (Add only) ── */}
          {!isEdit && (
            <>
              <SectionHead label="Dumpsite Operator Account" />
              <div style={{
                background: '#eff6ff', border: '1px solid #bfdbfe',
                borderRadius: 6, padding: '8px 12px', fontSize: 12, color: '#1e40af',
                marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8
              }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2l-2 2m-1.5 1.5L16 7l-4 4-2-2-4 4 2 2-3 3H2v-3l3-3 2 2 4-4-2-2 4-4 1.5-1.5z"/></svg>
                <span>Credentials created here allow the operator to log in to this facility portal.</span>
              </div>

              <div style={{ marginBottom: 12 }}>
                <label className="dm-label" style={{ fontSize: 11, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 5 }}>Full Name</label>
                <input className="meta-input" value={account.full_name}
                  onChange={e => setAc('full_name', e.target.value)}
                  placeholder="e.g. Gulang-Gulang Facility Operator"
                  style={{ width: '100%', height: 36, borderRadius: 6, border: '1px solid #ced0d4', padding: '0 10px', fontSize: 13, background: '#ffffff', color: '#1c1e21' }} />
              </div>

              <div style={{ marginBottom: 12 }}>
                <label className="dm-label" style={{ fontSize: 11, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 5 }}>Email (Username)</label>
                <input className="meta-input" type="email" value={account.email}
                  onChange={e => setAc('email', e.target.value)}
                  placeholder="e.g. dumpsite.gulang@lucena.gov.ph"
                  style={{ width: '100%', height: 36, borderRadius: 6, border: '1px solid #ced0d4', padding: '0 10px', fontSize: 13, background: '#ffffff', color: '#1c1e21' }} />
              </div>

              <div style={{ marginBottom: 16 }}>
                <label className="dm-label" style={{ fontSize: 11, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 5 }}>Password</label>
                <input className="meta-input" type="password" value={account.password}
                  onChange={e => setAc('password', e.target.value)}
                  placeholder="Min. 6 characters"
                  style={{ width: '100%', height: 36, borderRadius: 6, border: '1px solid #ced0d4', padding: '0 10px', fontSize: 13, background: '#ffffff', color: '#1c1e21' }} />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid #e4e6eb', display: 'flex', gap: 10, background: '#f8fafc' }}>
          <button className="meta-btn-secondary" style={{ flex: 1, height: 36, borderRadius: 6, border: '1px solid #ccd0d5', background: '#ffffff', color: '#1c1e21', fontWeight: 600, fontSize: 13, cursor: 'pointer' }} onClick={onClose}>Cancel</button>
          <button className="meta-btn-primary" style={{ flex: 1, height: 36, borderRadius: 6, border: 'none', background: '#16a34a', color: '#ffffff', fontWeight: 600, fontSize: 13, cursor: 'pointer' }} onClick={submit}>
            {isEdit ? 'Save Changes' : 'Add Site & Create Account'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Site Detail Modal ────────────────────────────────────────────────────────

function SiteDetailModal({ site, barangays, onClose }) {
  if (!site) return null
  const t = typeMap[site.type] || TYPES[1]
  const bName = barangays.find(b => b.id === site.barangay || b.id === site.barangay?.id)?.name
    || site.barangay_name || 'Unknown'
  const capacity = site.fill_percent ?? site.capacity_used ?? site.capacity ?? 0
  const capColor = capacity > 80 ? '#b91c1c' : capacity > 60 ? '#b45309' : '#15803d'
  const staff = site.staff_accounts || []

  const Row = ({ label, value, mono }) => (
    <div style={{ display: 'flex', gap: 10, padding: '8px 0', borderBottom: '1px solid #e4e6eb' }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: '#65676b', width: 130, flexShrink: 0, textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</span>
      <span style={{ fontSize: 13, color: '#1c1e21', fontFamily: mono ? 'monospace' : undefined, wordBreak: 'break-all' }}>{value ?? '—'}</span>
    </div>
  )

  return (
    <div className="dm-modal-ov" style={{ zIndex: 2100, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(3px)' }} onClick={onClose}>
      <div className="meta-card" style={{ padding: 0, width: '100%', maxWidth: 520, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: 8, boxShadow: '0 8px 30px rgba(0,0,0,0.15)' }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{
          background: '#ffffff',
          borderBottom: '1px solid #e4e6eb',
          padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: 6, flexShrink: 0,
            background: `${t.color}15`, border: `1px solid ${t.color}35`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <TypeIcon type={site.type} size={20} color={t.color} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-head, inherit)', fontSize: 17, fontWeight: 700, color: '#1c1e21', marginBottom: 2 }}>{site.name}</div>
            <div style={{ fontSize: 12, color: t.color, fontWeight: 600 }}>{t.label} · {bName}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#65676b', flexShrink: 0, padding: '0 4px', lineHeight: 1 }}>×</button>
        </div>

        {/* Scrollable body */}
        <div style={{ overflowY: 'auto', padding: '16px 20px', maxHeight: '75vh' }}>

          {/* ── Site Details ── */}
          <div style={{ fontSize: 11, fontWeight: 700, color: '#65676b', letterSpacing: '.05em', textTransform: 'uppercase', marginBottom: 8 }}>Facility Overview</div>
          <Row label="Site ID" value={`#${site.id}`} mono />
          <Row label="Name" value={site.name} />
          <Row label="Type" value={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><TypeIcon type={site.type} size={14} color={t.color} /> {t.label}</span>} />
          <Row label="Barangay" value={bName} />
          <Row label="Notes" value={site.notes || '—'} />

          {/* Capacity bar */}
          <div style={{ display: 'flex', gap: 10, padding: '8px 0', borderBottom: '1px solid #e4e6eb', alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#65676b', width: 130, flexShrink: 0, textTransform: 'uppercase', letterSpacing: '.05em' }}>Capacity Used</span>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1, background: '#e4e6eb', borderRadius: 4, height: 6, overflow: 'hidden' }}>
                <div style={{ width: `${capacity}%`, height: '100%', background: capColor, borderRadius: 4, transition: 'width .4s' }} />
              </div>
              <span style={{ fontSize: 12, fontWeight: 700, color: capColor, minWidth: 36, textAlign: 'right' }}>{capacity}%</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, padding: '8px 0', borderBottom: '1px solid #e4e6eb', alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#65676b', width: 130, flexShrink: 0, textTransform: 'uppercase', letterSpacing: '.05em' }}>Current Fill (KG)</span>
            <span style={{ fontSize: 13, color: '#1c1e21', fontFamily: 'monospace' }}>
              {Number(site.current_fill_kg || 0).toLocaleString()} / {Number(site.max_capacity_kg || 50000).toLocaleString()} kg
            </span>
          </div>

          {/* ── Coordinates ── */}
          <div style={{ fontSize: 11, fontWeight: 700, color: '#65676b', letterSpacing: '.05em', textTransform: 'uppercase', margin: '14px 0 8px' }}>Coordinates</div>
          <Row label="Latitude" value={Number(site.latitude).toFixed(6)} mono />
          <Row label="Longitude" value={Number(site.longitude).toFixed(6)} mono />

          {/* ── Linked Accounts ── */}
          <div style={{ fontSize: 11, fontWeight: 700, color: '#65676b', letterSpacing: '.05em', textTransform: 'uppercase', margin: '14px 0 8px' }}>
            Linked Accounts ({staff.length})
          </div>
          {staff.length === 0 ? (
            <div style={{ fontSize: 12, color: '#65676b', padding: '10px 0', fontStyle: 'italic' }}>No staff accounts linked to this site.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {staff.map(u => (
                <div key={u.id} style={{
                  background: '#f8fafc', border: '1px solid #e2e8f0',
                  borderRadius: 6, padding: '10px 12px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: 4, flexShrink: 0,
                      background: '#eff6ff', border: '1px solid #bfdbfe',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, fontWeight: 700, color: '#1e40af',
                    }}>{u.full_name?.[0]?.toUpperCase() || '?'}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: '#1c1e21', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.full_name}</div>
                      <div style={{ fontSize: 11, color: '#65676b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</div>
                    </div>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, flexShrink: 0,
                      background: u.is_active ? '#e7f5eb' : '#fee2e2',
                      color: u.is_active ? '#15803d' : '#b91c1c',
                      border: u.is_active ? '1px solid #bbf7d0' : '1px solid #fecaca',
                      textTransform: 'uppercase', letterSpacing: '.04em'
                    }}>{u.is_active ? 'Active' : 'Inactive'}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {[{ label: 'Role', val: u.role }, { label: 'Barangay', val: u.barangay || '—' }, { label: 'Joined', val: u.created_at }].map(p => (
                      <div key={p.label} style={{
                        display: 'flex', gap: 4, alignItems: 'center',
                        background: '#ffffff', border: '1px solid #ced0d4', borderRadius: 4, padding: '2px 6px',
                      }}>
                        <span style={{ fontSize: 10, color: '#65676b', fontWeight: 600 }}>{p.label}:</span>
                        <span style={{ fontSize: 10, fontWeight: 600, color: '#1c1e21' }}>{p.val}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid #e4e6eb', background: '#f8fafc' }}>
          <button className="meta-btn-secondary" style={{ width: '100%', height: 36, borderRadius: 6, border: '1px solid #ccd0d5', background: '#ffffff', color: '#1c1e21', fontWeight: 600, fontSize: 13, cursor: 'pointer' }} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

// ── Capacity Bar ──────────────────────────────────────────────────────────────

function CapBar({ pct }) {
  const p = Number(pct) || 0
  const color = p > 80 ? '#b91c1c' : p > 60 ? '#b45309' : '#15803d'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, background: '#e4e6eb', borderRadius: 4, height: 5, overflow: 'hidden' }}>
        <div style={{ width: `${p}%`, height: '100%', background: color, borderRadius: 4 }} />
      </div>
      <span style={{ fontSize: 11, color: '#65676b', width: 28, textAlign: 'right', fontWeight: 600 }}>{p}%</span>
    </div>
  )
}

// ── Warning Modals ────────────────────────────────────────────────────────────

function DeleteConfirmModal({ site, onConfirm, onClose }) {
  if (!site) return null
  return (
    <div className="dm-modal-ov" style={{ zIndex: 3000, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(3px)' }} onClick={onClose}>
      <div className="meta-card" style={{ padding: 0, width: '100%', maxWidth: 420, overflow: 'hidden', borderRadius: 8, boxShadow: '0 8px 30px rgba(0,0,0,0.15)' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '20px 24px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
          <div style={{ width: 44, height: 44, background: '#fee2e2', color: '#b91c1c', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/></svg>
          </div>
          <h3 style={{ fontSize: 17, fontWeight: 700, color: '#1c1e21', marginBottom: 6, fontFamily: 'var(--font-head, inherit)' }}>Delete Dumpsite?</h3>
          <p style={{ fontSize: 13, color: '#65676b', marginBottom: 14 }}>
            You are about to permanently delete <strong style={{ color: '#1c1e21' }}>{site.name}</strong>.
          </p>
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', padding: '10px 14px', borderRadius: 6, fontSize: 12, color: '#991b1b', textAlign: 'left', lineHeight: 1.5 }}>
            <strong style={{ display: 'block', marginBottom: 3 }}>Impact Warning:</strong>
            This action cannot be undone. All collection logs and routes associated with this facility may lose relational integrity, and linked operator accounts will be removed.
          </div>
        </div>
        <div style={{ padding: '12px 24px 20px', display: 'flex', gap: 10, borderTop: '1px solid #e4e6eb', background: '#f8fafc' }}>
          <button className="meta-btn-secondary" style={{ flex: 1, height: 36, borderRadius: 6, border: '1px solid #ccd0d5', background: '#ffffff', color: '#1c1e21', fontWeight: 600, fontSize: 13, cursor: 'pointer' }} onClick={onClose}>Cancel</button>
          <button className="meta-btn-primary" style={{ flex: 1, height: 36, borderRadius: 6, border: 'none', background: '#b91c1c', color: '#ffffff', fontWeight: 600, fontSize: 13, cursor: 'pointer' }} onClick={() => { onConfirm(site.id); onClose() }}>Delete Permanently</button>
        </div>
      </div>
    </div>
  )
}

function OutOfBoundsModal({ warning, onClose }) {
  if (!warning) return null
  return (
    <div className="dm-modal-ov" style={{ zIndex: 3000, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(3px)' }} onClick={onClose}>
      <div className="meta-card" style={{ padding: 0, width: '100%', maxWidth: 420, overflow: 'hidden', borderRadius: 8, boxShadow: '0 8px 30px rgba(0,0,0,0.15)' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '20px 24px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
          <div style={{ width: 44, height: 44, background: '#fef3c7', color: '#b45309', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01"/></svg>
          </div>
          <h3 style={{ fontSize: 17, fontWeight: 700, color: '#1c1e21', marginBottom: 6, fontFamily: 'var(--font-head, inherit)' }}>{warning.title}</h3>
          <p style={{ fontSize: 13, color: '#65676b', marginBottom: 14 }}>
            {warning.message}
          </p>
          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', padding: '10px 14px', borderRadius: 6, fontSize: 12, color: '#92400e', textAlign: 'left', lineHeight: 1.5 }}>
            <strong style={{ display: 'block', marginBottom: 3 }}>Jurisdiction Notice:</strong>
            {warning.reason}
          </div>
        </div>
        <div style={{ padding: '12px 24px 20px', display: 'flex', borderTop: '1px solid #e4e6eb', background: '#f8fafc' }}>
          <button className="meta-btn-primary" style={{ width: '100%', height: 36, borderRadius: 6, border: 'none', background: '#16a34a', color: '#ffffff', fontWeight: 600, fontSize: 13, cursor: 'pointer' }} onClick={onClose}>Acknowledge</button>
        </div>
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function DumpsiteManagement() {
  const mapRef = useRef(null)
  const mapInstance = useRef(null)
  const markersRef = useRef({})       // id → leaflet marker
  const pendingRef = useRef(null)     // temp marker while modal is open

  const { sites, loading, saveSite, deleteSite: apiDeleteSite, createAccount } = useDumpsites()
  const { notify } = useNotification()
  const [barangays, setBarangays] = useState([])
  const [barangayGeo, setBarangayGeo] = useState(null)
  const barangayGeoRef = useRef(null)

  const [mapReady, setMapReady] = useState(false)
  const [modal, setModal] = useState(null)  // null | 'add' | site obj
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [outOfBoundsWarning, setOutOfBoundsWarning] = useState(null)
  const [pendingCoords, setPendingCoords] = useState(null)
  const [selected, setSelected] = useState(null)
  const [toast, setToast] = useState(null)
  const [typeFilter, setTypeFilter] = useState('all')
  const [addMode, setAddMode] = useState(false)
  const [detailSite, setDetailSite] = useState(null)  // site to show in detail popup
  const [moveConfirm, setMoveConfirm] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const addModeRef = useRef(false)
  addModeRef.current = addMode

  // ── Load Leaflet CDN & Data ────────────────────────────────────────────────
  useEffect(() => {
    api.get('/api/barangays/').then(res => setBarangays(res.data))
    fetch('/data/lucena_barangays.geojson')
      .then(r => r.json())
      .then(data => { setBarangayGeo(data); barangayGeoRef.current = data })
      .catch(console.error)

    if (window.L) { setMapReady(true); return }
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
    document.head.appendChild(link)
    const script = document.createElement('script')
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
    script.onload = () => setMapReady(true)
    document.head.appendChild(script)
  }, [])

  // ── Init map ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapReady || !mapRef.current || mapInstance.current) return
    const L = window.L
    const map = L.map(mapRef.current, { center: LUCENA_CENTER, zoom: 14, zoomControl: false })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors', maxZoom: 19,
    }).addTo(map)
    L.control.zoom({ position: 'topright' }).addTo(map)
    map.on('click', e => {
      if (!addModeRef.current) return
      const { lat, lng } = e.latlng
      
      const detectedName = detectBarangay(lat, lng, barangayGeoRef.current)
      if (!detectedName) {
        setOutOfBoundsWarning({
          title: 'Location Out of Bounds',
          message: 'The selected location is outside the recognized boundaries.',
          reason: 'WasteWatch only operates within the jurisdiction of Lucena City. Dumpsites must be geographically located within these limits to ensure accurate routing and analytics.'
        })
        return
      }

      // drop pending marker
      if (pendingRef.current) { try { map.removeLayer(pendingRef.current) } catch { } }
      const icon = L.divIcon({ html: pendingMarkerHtml(), className: '', iconSize: [36, 36], iconAnchor: [18, 36] })
      pendingRef.current = L.marker([lat, lng], { icon }).addTo(map)
      setPendingCoords([lat, lng])
      setModal('add')
      setAddMode(false)
    })
    mapInstance.current = map
  }, [mapReady])

  // ── Sync markers to map whenever sites list changes ────────────────────────
  useEffect(() => {
    if (!mapReady || !mapInstance.current) return
    const L = window.L
    const map = mapInstance.current

    // remove stale markers
    Object.keys(markersRef.current).forEach(id => {
      if (!sites.find(s => s.id === Number(id))) {
        try { map.removeLayer(markersRef.current[id]) } catch { }
        delete markersRef.current[id]
      }
    })

    // add / update markers
    sites.forEach(site => {
      if (markersRef.current[site.id]) {
        try { map.removeLayer(markersRef.current[site.id]) } catch { }
      }
      const lat = Number(site.latitude)
      const lng = Number(site.longitude)
      if (!lat || !lng) return  // skip if coords missing
      const icon = L.divIcon({ html: markerHtml(site.type), className: '', iconSize: [36, 42], iconAnchor: [18, 42] })
      const marker = L.marker([lat, lng], { icon, draggable: true }).addTo(map)
      const t = typeMap[site.type] || TYPES[1]
      const bName = typeof site.barangay === 'object' ? site.barangay.name : site.barangay_name
      marker.bindPopup(`
        <div style="font-family:sans-serif;min-width:160px;padding:2px 0;">
          <strong style="color:${t.color};font-size:13px;">${site.name}</strong><br/>
          <span style="color:#65676b;font-size:11px;">${t.label} · ${bName || 'Unknown'}</span><br/>
          <span style="color:#65676b;font-size:11px;">Capacity: ${site.fill_percent ?? site.capacity_used ?? 0}% full</span><br/>
          <span style="color:#2563eb;font-size:10px;margin-top:4px;display:inline-block;">Drag marker to relocate</span>
        </div>`)
      
      marker.on('dragend', (e) => {
        const newPos = e.target.getLatLng()
        
        const detectedName = detectBarangay(newPos.lat, newPos.lng, barangayGeoRef.current)
        if (!detectedName) {
           setOutOfBoundsWarning({
             title: 'Location Out of Bounds',
             message: 'Cannot move dumpsite outside the boundaries of Lucena City.',
             reason: 'Dumpsites and transfer stations must remain geographically located within the city limits to ensure accurate routing and analytics.'
           })
           e.target.setLatLng([lat, lng]) // Reset position
           return
        }

        setMoveConfirm({
          site,
          newLat: newPos.lat,
          newLng: newPos.lng,
          oldLat: lat,
          oldLng: lng,
          target: e.target
        })
      })

      marker.on('click', () => setSelected(site))
      markersRef.current[site.id] = marker
    })
  }, [sites, mapReady, saveSite])

  // ── cursor style when addMode active ──────────────────────────────────────
  useEffect(() => {
    if (!mapInstance.current) return
    mapInstance.current.getContainer().style.cursor = addMode ? 'crosshair' : ''
  }, [addMode])

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  async function handleSave(form, accountData) {
    let res
    if (modal === 'add') {
      const payload = {
        name: form.name,
        type: form.type,
        barangay: form.barangay,
        lat: Number(form.lat),
        lng: Number(form.lng),
        capacity: 0,
        notes: form.notes || '',
      }
      res = await saveSite(null, payload)
      if (res.ok) {
        if (pendingRef.current) { try { mapInstance.current.removeLayer(pendingRef.current) } catch { } pendingRef.current = null }
        setPendingCoords(null)
        // Create dumpsite account
        const accRes = await createAccount(res.data.id, accountData)
        if (!accRes.ok) {
          showToast(`Site added. Account notice: ${accRes.error}`)
        } else {
          showToast('Site added and account created successfully.')
        }
        // Refresh site so staff_accounts is populated in detail modal
        const fresh = { ...res.data, staff_accounts: accRes.ok ? [accRes.data] : [] }
        setDetailSite(fresh)
      }
    } else {
      const payload = {
        name: form.name,
        type: form.type,
        barangay: form.barangay,
        lat: Number(form.lat),
        lng: Number(form.lng),
        notes: form.notes || '',
      }
      res = await saveSite(modal.id, payload)
      if (res.ok) showToast('Site updated successfully.')
    }
    if (res.ok) setModal(null)
    else notify({ variant: 'error-outline', message: getApiErrorMessage(res.error, 'Failed to save site.') })
  }

  async function deleteSite(id) {
    const res = await apiDeleteSite(id)
    if (res.ok) {
      if (selected?.id === id) setSelected(null)
      showToast('Site removed successfully.')
    }
  }

  function flyTo(site) {
    if (!mapInstance.current) return
    mapInstance.current.flyTo([Number(site.latitude), Number(site.longitude)], 16, { duration: 1 })
    setSelected(site)
  }

  const filtered = useMemo(() => {
    let res = typeFilter === 'all' ? sites : sites.filter(s => s.type === typeFilter)
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase().trim()
      res = res.filter(s => {
        const bName = (typeof s.barangay === 'object' ? s.barangay?.name : barangays.find(b => b.id === s.barangay)?.name) || s.barangay_name || ''
        return (s.name || '').toLowerCase().includes(q) || bName.toLowerCase().includes(q)
      })
    }
    return res
  }, [sites, typeFilter, searchTerm, barangays])

  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)
  const [showMap, setShowMap] = useState(false)
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  const IcoMap = ({ size = 16, color = "currentColor" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7l6-3 6 3 6-3v13l-6 3-6-3-6 3V7zM9 4v13M15 7v13" />
    </svg>
  )

  const css = `
    @keyframes dmFadeUp  { from { opacity:0; transform:translateY(5px) } to { opacity:1; transform:translateY(0) } }
    @keyframes dmModalIn { from { opacity:0; transform:scale(.97) translateY(6px) } to { opacity:1; transform:scale(1) translateY(0) } }
    @keyframes dmToastIn { from { opacity:0; transform:translateX(-50%) translateY(-10px) } to { opacity:1; transform:translateX(-50%) translateY(0) } }
    @keyframes ww-blink  { 0%,100%{opacity:1} 50%{opacity:0.5} }
    @keyframes dmSpin    { to { transform:rotate(360deg) } }

    /* ── Map-First Workbench Layout ── */
    .dm-workbench { height: calc(100vh - 60px); display: flex; flex-direction: column; background: #f0f2f5; overflow: hidden; font-family: var(--font-body, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif); }
    .dm-top-toolbar { height: 56px; background: #ffffff; border-bottom: 1px solid #e4e6eb; display: flex; align-items: center; justify-content: space-between; padding: 0 20px; flex-shrink: 0; z-index: 10; }
    .dm-workspace { flex: 1; display: flex; min-height: 0; overflow: hidden; }
    .dm-sidebar-left { width: 320px; background: #ffffff; border-right: 1px solid #e4e6eb; display: flex; flex-direction: column; min-height: 0; flex-shrink: 0; }
    .dm-map-canvas { flex: 1; position: relative; min-width: 0; height: 100%; background: #e4e6eb; }
    .dm-command-panel { width: 380px; background: #ffffff; border-left: 1px solid #e4e6eb; display: flex; flex-direction: column; min-height: 0; flex-shrink: 0; }

    /* ── Page layout ── */
    .meta-page-canvas { background: #f0f2f5; min-height: 100vh; padding: 20px 24px; font-family: var(--font-body, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif); }
    .meta-card { background: #ffffff; border: 1px solid #e4e6eb; border-radius: 8px; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }

    /* ── Builder grid ── */
    .dm-builder-grid { display:grid; grid-template-columns:1fr 380px; gap:16px; align-items:start; }
    .dm-map-wrap { position:relative; border-radius:8px; overflow:hidden; height:640px; background:#e4e6eb; border:1px solid #ced0d4; box-shadow:0 1px 2px rgba(0,0,0,0.04); }
    .dm-map-toggle { display:none; }

    /* ── Panel card ── */
    .dm-panel { background:#ffffff; border:1px solid #e4e6eb; border-radius:8px; padding:18px; box-shadow:0 1px 2px rgba(0,0,0,0.04); }
    .dm-panel-title { font-size:15px; font-weight:700; color:#1c1e21; margin:0 0 2px; }
    .dm-panel-sub   { font-size:12px; color:#65676b; margin:0 0 14px; }

    /* ── Form ── */
    .dm-label { display:block; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; color:#65676b; margin-bottom:5px; }
    .meta-input { width:100%; height:36px; background:#ffffff; border:1px solid #ced0d4; border-radius:6px; padding:0 12px; font-size:13px; color:#1c1e21; outline:none; transition:border-color .15s, box-shadow .15s; }
    .meta-input:focus { border-color:#16a34a; box-shadow:0 0 0 2px rgba(22,163,74,.15); }
    .meta-input::placeholder { color:#8a8d91; }

    /* ── Dumpsite card ── */
    .dm-ds-card { border-radius:6px; padding:12px 14px; margin-bottom:8px; display:flex; cursor:pointer; transition:all .14s; border:1px solid #e4e6eb; background:#ffffff; }
    .dm-ds-card:hover { border-color:#ced0d4; box-shadow:0 2px 6px rgba(0,0,0,.05); }
    .dm-ds-card.sel { border-color:#16a34a; background:rgba(22,163,74,.03); }

    /* ── Buttons ── */
    .meta-btn-primary { height:36px; background:#16a34a; color:#ffffff; border:none; border-radius:6px; padding:0 16px; font-size:13px; font-weight:600; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; gap:6px; transition:background .15s; }
    .meta-btn-primary:hover { background:#15803d; }
    .meta-btn-primary:active { transform:scale(.98); }
    .meta-btn-primary:disabled { opacity:.4; cursor:not-allowed; }
    
    .meta-btn-secondary { height:36px; background:#ffffff; color:#1c1e21; border:1px solid #ccd0d5; border-radius:6px; padding:0 14px; font-size:13px; font-weight:600; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; gap:6px; transition:background .15s, border-color .15s; }
    .meta-btn-secondary:hover { background:#f2f3f5; border-color:#bec3c9; }

    /* ── Tabs ── */
    .meta-tabs-wrapper { display:flex; background:#e4e6eb; padding:3px; border-radius:8px; gap:2px; flex-wrap:wrap; }
    .meta-tab-btn { padding:5px 11px; border-radius:6px; border:none; font-size:11px; font-weight:600; cursor:pointer; transition:all 0.15s ease; color:#65676b; background:transparent; display:inline-flex; align-items:center; gap:5px; }
    .meta-tab-btn.active { background:#ffffff; color:#1c1e21; box-shadow:0 1px 2px rgba(0,0,0,0.08); font-weight:700; }

    /* ── Modal overlay ── */
    .dm-modal-ov { position:fixed; inset:0; background:rgba(0,0,0,.45); z-index:9998; display:flex; align-items:center; justify-content:center; padding:16px; backdrop-filter:blur(3px); }

    /* ── Toast ── */
    .dm-toast { position:fixed; top:70px; left:50%; transform:translateX(-50%); background:#ffffff; color:#1c1e21; padding:10px 20px; border-radius:8px; z-index:9999; font-size:13px; font-weight:600; border:1px solid #e4e6eb; border-left:4px solid #16a34a; white-space:nowrap; animation:dmToastIn .2s; box-shadow:0 4px 14px rgba(0,0,0,.1); }

    .dm-spinner { width:12px; height:12px; border-radius:50%; border:2px solid #e4e6eb; border-top-color:#16a34a; animation:dmSpin .75s linear infinite; flex-shrink:0; }

    @media (max-width:900px) {
      .dm-builder-grid { grid-template-columns:1fr; }
      .dm-map-wrap { height:360px; display:none; }
      .dm-map-wrap.vis { display:block; }
      .dm-map-toggle { display:flex; width:100%; align-items:center; justify-content:center; gap:8px; padding:10px; margin-bottom:12px; border-radius:6px; border:1px solid #ccd0d5; background:#ffffff; font-size:13px; font-weight:600; color:#1c1e21; cursor:pointer; }
    }
  `

  return (
    <DashboardLayout>
      <style>{css}</style>

      {toast && (
        <div className="dm-toast">{toast}</div>
      )}

      {moveConfirm && (
        <div className="dm-modal-ov" onClick={() => {
          moveConfirm.target.setLatLng([moveConfirm.oldLat, moveConfirm.oldLng])
          setMoveConfirm(null)
        }}>
          <div className="meta-card" style={{ width: '100%', maxWidth: 400, textAlign: 'center', padding: '24px 20px', borderRadius: 8, boxShadow: '0 8px 30px rgba(0,0,0,0.15)' }} onClick={e => e.stopPropagation()}>
            <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#fef3c7', color: '#b45309', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01"/></svg>
            </div>
            <h3 style={{ margin: '0 0 8px 0', fontSize: 17, fontWeight: 700, color: '#1c1e21' }}>Relocate Facility?</h3>
            <p style={{ color: '#65676b', fontSize: 13, marginBottom: 20, lineHeight: 1.5 }}>
              Are you sure you want to move <strong>{moveConfirm.site.name}</strong> to the newly dropped map location?
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="meta-btn-secondary" style={{ flex: 1 }} onClick={() => {
                moveConfirm.target.setLatLng([moveConfirm.oldLat, moveConfirm.oldLng])
                setMoveConfirm(null)
              }}>Cancel</button>
              <button className="meta-btn-primary" style={{ flex: 1, background: '#16a34a' }} onClick={async () => {
                const payload = { lat: moveConfirm.newLat, lng: moveConfirm.newLng }
                const res = await saveSite(moveConfirm.site.id, payload)
                if (res.ok) {
                  showToast('Site moved successfully.')
                } else {
                  showToast('Failed to move site.')
                  moveConfirm.target.setLatLng([moveConfirm.oldLat, moveConfirm.oldLng])
                }
                setMoveConfirm(null)
              }}>Confirm Move</button>
            </div>
          </div>
        </div>
      )}

      {modal && (
        <SiteModal
          site={modal === 'add' ? null : modal}
          coords={modal === 'add' ? pendingCoords : null}
          barangays={barangays}
          barangayGeo={barangayGeo}
          onSave={handleSave}
          onClose={() => {
            if (pendingRef.current) { try { mapInstance.current?.removeLayer(pendingRef.current) } catch { } pendingRef.current = null }
            setPendingCoords(null)
            setModal(null)
          }}
        />
      )}

      {detailSite && (
        <SiteDetailModal
          site={detailSite}
          barangays={barangays}
          onClose={() => setDetailSite(null)}
        />
      )}

      {deleteConfirm && (
        <DeleteConfirmModal 
          site={deleteConfirm} 
          onConfirm={deleteSite} 
          onClose={() => setDeleteConfirm(null)} 
        />
      )}
      
      {outOfBoundsWarning && (
        <OutOfBoundsModal 
          warning={outOfBoundsWarning} 
          onClose={() => setOutOfBoundsWarning(null)} 
        />
      )}

      <div className="dm-workbench">

        {/* ── Top Header Toolbar ── */}
        <div className="dm-top-toolbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 6,
                background: '#e7f5eb', color: '#16a34a',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>
                <IcoMap size={18} color="#16a34a" />
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: '#1c1e21', letterSpacing: '-.02em' }}>
                    Dumpsite Management
                  </h2>
                  <span style={{
                    background: '#e7f5eb', color: '#15803d', border: '1px solid #bbf7d0',
                    fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, letterSpacing: '.04em'
                  }}>ADMIN</span>
                </div>
                <div style={{ fontSize: 11, color: '#65676b', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>Disposal facilities & transfer hubs across Lucena City</span>
                </div>
              </div>
            </div>
          </div>

          {/* Quick KPI Metrics */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: '#f0f2f5', padding: '4px 10px', borderRadius: 6,
              fontSize: 12, fontWeight: 600, color: '#1c1e21', border: '1px solid #e4e6eb'
            }}>
              <span style={{ color: '#65676b', fontSize: 11, textTransform: 'uppercase' }}>Total Sites:</span>
              <span>{sites.length}</span>
            </div>

            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: '#fef2f2', padding: '4px 10px', borderRadius: 6,
              fontSize: 12, fontWeight: 600, color: '#b91c1c', border: '1px solid #fecaca'
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#dc2626' }} />
              <span>{sites.filter(s => s.type === 'landfill').length} Landfills</span>
            </div>

            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: '#fffbeb', padding: '4px 10px', borderRadius: 6,
              fontSize: 12, fontWeight: 600, color: '#92400e', border: '1px solid #fde68a'
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#d97706' }} />
              <span>{sites.filter(s => s.type === 'dumpsite').length} Dumpsites</span>
            </div>

            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: '#eff6ff', padding: '4px 10px', borderRadius: 6,
              fontSize: 12, fontWeight: 600, color: '#1e40af', border: '1px solid #bfdbfe'
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#2563eb' }} />
              <span>{sites.filter(s => s.type === 'transfer').length} Transfer</span>
            </div>
          </div>

          {/* Top Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              className="meta-btn-primary"
              onClick={() => setAddMode(a => !a)}
              style={{
                background: addMode ? '#d97706' : '#16a34a',
                height: 34,
                fontSize: 12
              }}
            >
              {addMode ? (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  Cancel Pin Drop
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  + Add Site (Click Map)
                </>
              )}
            </button>
          </div>
        </div>

        {/* ── 3-Pane Workbench Workspace ── */}
        <div className="dm-workspace">

          {/* 1. LEFT SIDEBAR: Sites Directory */}
          <div className="dm-sidebar-left">
            <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid #e4e6eb' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#1c1e21', textTransform: 'uppercase', letterSpacing: '.03em' }}>
                  Sites Directory
                </span>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#65676b', background: '#f0f2f5', padding: '2px 8px', borderRadius: 10 }}>
                  {filtered.length} of {sites.length}
                </span>
              </div>

              {/* Search Bar */}
              <div style={{ position: 'relative', marginBottom: 10 }}>
                <input
                  type="text"
                  placeholder="Search site name or barangay..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  style={{
                    width: '100%',
                    height: 32,
                    fontSize: 12,
                    padding: '0 10px 0 30px',
                    borderRadius: 6,
                    border: '1px solid #ced0d4',
                    background: '#f8f9fa',
                    outline: 'none',
                    color: '#1c1e21',
                    boxSizing: 'border-box'
                  }}
                />
                <div style={{ position: 'absolute', left: 9, top: 8, color: '#8a8d91', pointerEvents: 'none' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                </div>
                {searchTerm && (
                  <button
                    onClick={() => setSearchTerm('')}
                    style={{ position: 'absolute', right: 8, top: 7, border: 'none', background: 'transparent', cursor: 'pointer', color: '#8a8d91', padding: 0 }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                )}
              </div>

              {/* Type Filter Pills */}
              <div className="meta-tabs-wrapper" style={{ gap: 2, padding: 2 }}>
                <button
                  className={`meta-tab-btn ${typeFilter === 'all' ? 'active' : ''}`}
                  onClick={() => setTypeFilter('all')}
                  style={{ fontSize: 10, padding: '4px 7px' }}
                >
                  All ({sites.length})
                </button>
                {TYPES.map(t => (
                  <button
                    key={t.value}
                    className={`meta-tab-btn ${typeFilter === t.value ? 'active' : ''}`}
                    onClick={() => setTypeFilter(t.value)}
                    style={{ fontSize: 10, padding: '4px 7px' }}
                  >
                    <TypeIcon type={t.value} size={10} color={typeFilter === t.value ? t.color : '#65676b'} />
                    {t.label} ({sites.filter(s => s.type === t.value).length})
                  </button>
                ))}
              </div>
            </div>

            {/* Scrollable Facility Cards */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px' }}>
              {loading && sites.length === 0 ? (
                <FeedCardSkeleton count={4} compact />
              ) : filtered.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 16px', color: '#65676b', fontSize: 13 }}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ced0d4" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ margin: '0 auto 8px', display: 'block' }}>
                    <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
                  </svg>
                  No facilities found matching your criteria.
                </div>
              ) : null}

              {filtered.map(site => {
                const t = typeMap[site.type] || TYPES[1]
                const isSelected = selected?.id === site.id
                const bName = (typeof site.barangay === 'object' ? site.barangay?.name : barangays.find(b => b.id === site.barangay)?.name) || site.barangay_name || 'Lucena City'
                const capPct = site.fill_percent ?? site.capacity_used ?? site.capacity ?? 0

                return (
                  <div
                    key={site.id}
                    className={`dm-ds-card${isSelected ? ' sel' : ''}`}
                    onClick={() => flyTo(site)}
                    style={{
                      flexDirection: 'column',
                      alignItems: 'stretch',
                      borderLeft: isSelected ? '3px solid #16a34a' : '1px solid #e4e6eb',
                      padding: '10px 12px',
                      marginBottom: 8,
                      borderRadius: 6,
                      background: isSelected ? '#f0fdf4' : '#ffffff'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                      <div style={{
                        width: 30, height: 30, borderRadius: 6,
                        background: `${t.color}15`, border: `1px solid ${t.color}35`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                      }}>
                        <TypeIcon type={site.type} size={15} color={t.color} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 12.5, color: '#1c1e21', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {site.name}
                        </div>
                        <div style={{ fontSize: 11, color: '#65676b', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ color: t.color, fontWeight: 600 }}>{t.label}</span>
                          <span>•</span>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bName}</span>
                        </div>
                      </div>
                    </div>

                    <div style={{ marginTop: 8, marginBottom: 2 }}>
                      <CapBar pct={capPct} />
                    </div>

                    {site.notes && (
                      <div style={{ fontSize: 11, color: '#65676b', marginTop: 3, fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {site.notes}
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: 6, marginTop: 8 }} onClick={e => e.stopPropagation()}>
                      <button
                        className="meta-btn-secondary"
                        style={{ flex: 1, height: 26, fontSize: 11, padding: 0 }}
                        onClick={() => setDetailSite(site)}
                      >
                        Details
                      </button>
                      <button
                        className="meta-btn-secondary"
                        style={{ flex: 1, height: 26, fontSize: 11, padding: 0 }}
                        onClick={() => setModal(site)}
                      >
                        Edit
                      </button>
                      <button
                        className="meta-btn-secondary"
                        style={{ flex: 1, height: 26, fontSize: 11, padding: 0, color: '#b91c1c', borderColor: '#fca5a5' }}
                        onClick={() => setDeleteConfirm(site)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* 2. CENTER CANVAS: Expansive Map */}
          <div className="dm-map-canvas">
            <div ref={mapRef} style={{ position: 'absolute', inset: 0, zIndex: 1 }} />
            {!mapReady && (
              <div style={{ position: 'absolute', inset: 0, zIndex: 5 }}>
                <MapSkeleton height="100%" dark label="Loading facilities map..." />
              </div>
            )}

            {/* Add Mode Floating Alert Banner */}
            {addMode && (
              <div style={{
                position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
                zIndex: 400, background: '#fffbeb', border: '1px solid #fde68a',
                boxShadow: '0 4px 16px rgba(0,0,0,0.12)', borderRadius: 8,
                padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 10,
                fontSize: 12.5, fontWeight: 600, color: '#92400e', animation: 'dmFadeUp .2s'
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="M13 13l6 6"/></svg>
                <span>Click anywhere on the map to drop a pin and register a new disposal site.</span>
                <button
                  onClick={() => setAddMode(false)}
                  style={{
                    background: '#fef3c7', border: '1px solid #fcd34d',
                    borderRadius: 4, padding: '2px 8px', fontSize: 11,
                    fontWeight: 700, color: '#78350f', cursor: 'pointer', marginLeft: 6
                  }}
                >
                  Cancel
                </button>
              </div>
            )}

            {/* Type Legend Overlay */}
            <div style={{
              position: 'absolute', bottom: 18, left: 18, zIndex: 400,
              background: '#ffffff', borderRadius: 8, padding: '10px 14px',
              border: '1px solid #ced0d4', fontSize: 11, color: '#65676b',
              boxShadow: '0 4px 12px rgba(0,0,0,.08)'
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: '#8a8d91', marginBottom: 6 }}>
                Facility Legend
              </div>
              {TYPES.map(t => (
                <div key={t.value} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <div style={{ width: 9, height: 9, borderRadius: '50%', background: t.color }} />
                  <TypeIcon type={t.value} size={13} color={t.color} />
                  <span style={{ color: '#1c1e21', fontWeight: 500 }}>{t.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 3. RIGHT COMMAND PANEL: Facility Inspector */}
          <div className="dm-command-panel">
            {selected ? (
              (() => {
                const curSite = sites.find(s => s.id === selected.id) || selected
                const t = typeMap[curSite.type] || TYPES[1]
                const bName = (typeof curSite.barangay === 'object' ? curSite.barangay?.name : barangays.find(b => b.id === curSite.barangay)?.name) || curSite.barangay_name || 'Lucena City'
                const capPct = curSite.fill_percent ?? curSite.capacity_used ?? curSite.capacity ?? 0
                const capColor = capPct > 80 ? '#b91c1c' : capPct > 60 ? '#b45309' : '#15803d'
                const staff = curSite.staff_accounts || []

                return (
                  <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                    {/* Panel Header */}
                    <div style={{ padding: '16px 20px', borderBottom: '1px solid #e4e6eb', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{
                          width: 40, height: 40, borderRadius: 8,
                          background: `${t.color}15`, border: `1px solid ${t.color}35`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                        }}>
                          <TypeIcon type={curSite.type} size={20} color={t.color} />
                        </div>
                        <div>
                          <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: '#1c1e21' }}>
                            {curSite.name}
                          </h3>
                          <div style={{ fontSize: 12, color: '#65676b', display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                            <span style={{ color: t.color, fontWeight: 600 }}>{t.label}</span>
                            <span>•</span>
                            <span>{bName}</span>
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => setSelected(null)}
                        style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#8a8d91', padding: 4 }}
                        title="Close Inspector"
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                    </div>

                    {/* Panel Scrollable Content */}
                    <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>

                      {/* Capacity Card */}
                      <div style={{ background: '#f8f9fa', borderRadius: 8, border: '1px solid #e4e6eb', padding: '14px 16px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                            Current Capacity Utilization
                          </span>
                          <span style={{ fontSize: 14, fontWeight: 800, color: capColor }}>
                            {capPct}%
                          </span>
                        </div>
                        <div style={{ height: 8, background: '#e4e6eb', borderRadius: 4, overflow: 'hidden', marginBottom: 6 }}>
                          <div style={{ width: `${capPct}%`, height: '100%', background: capColor, borderRadius: 4, transition: 'width .3s' }} />
                        </div>
                        <div style={{ fontSize: 11, color: '#65676b', display: 'flex', justifyContent: 'space-between' }}>
                          <span>0% (Empty)</span>
                          <span style={{ fontWeight: 600, color: capColor }}>
                            {capPct > 80 ? 'Critical Capacity' : capPct > 60 ? 'Moderate Inflow' : 'Optimal Capacity'}
                          </span>
                          <span>100% (Full)</span>
                        </div>
                      </div>

                      {/* Geolocation Details */}
                      <div style={{ background: '#ffffff', borderRadius: 8, border: '1px solid #e4e6eb', padding: '14px 16px' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 10 }}>
                          Location & Geofence
                        </span>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: '#65676b' }}>Barangay</span>
                            <span style={{ fontWeight: 600, color: '#1c1e21' }}>{bName}</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: '#65676b' }}>Coordinates</span>
                            <span style={{ fontFamily: 'monospace', fontWeight: 600, color: '#1c1e21' }}>
                              {Number(curSite.latitude).toFixed(6)}, {Number(curSite.longitude).toFixed(6)}
                            </span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: '#65676b' }}>City Jurisdiction</span>
                            <span style={{ color: '#16a34a', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                              Lucena City (Verified)
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Operational Staff */}
                      <div style={{ background: '#ffffff', borderRadius: 8, border: '1px solid #e4e6eb', padding: '14px 16px' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 8 }}>
                          Assigned Staff ({staff.length})
                        </span>
                        {staff.length === 0 ? (
                          <div style={{ fontSize: 12, color: '#8a8d91', fontStyle: 'italic' }}>
                            No dedicated facility operator accounts registered.
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {staff.map((ac, idx) => (
                              <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '4px 0' }}>
                                <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#f0f2f5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#65676b' }}>
                                  {ac.full_name?.[0]?.toUpperCase() || 'S'}
                                </div>
                                <div>
                                  <div style={{ fontWeight: 600, color: '#1c1e21' }}>{ac.full_name || 'Staff Member'}</div>
                                  <div style={{ fontSize: 11, color: '#65676b' }}>{ac.email}</div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Site Notes */}
                      {curSite.notes && (
                        <div style={{ background: '#ffffff', borderRadius: 8, border: '1px solid #e4e6eb', padding: '14px 16px' }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 6 }}>
                            Operational Notes
                          </span>
                          <div style={{ fontSize: 12, color: '#4b5563', lineHeight: 1.5 }}>
                            {curSite.notes}
                          </div>
                        </div>
                      )}

                    </div>

                    {/* Bottom Action Footer */}
                    <div style={{ padding: '14px 20px', borderTop: '1px solid #e4e6eb', background: '#f8f9fa', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          className="meta-btn-secondary"
                          style={{ flex: 1, height: 34, fontSize: 12 }}
                          onClick={() => setDetailSite(curSite)}
                        >
                          View Full Details
                        </button>
                        <button
                          className="meta-btn-secondary"
                          style={{ flex: 1, height: 34, fontSize: 12 }}
                          onClick={() => setModal(curSite)}
                        >
                          Edit Facility
                        </button>
                      </div>
                      <button
                        className="meta-btn-secondary"
                        style={{ width: '100%', height: 32, fontSize: 12, color: '#b91c1c', borderColor: '#fca5a5' }}
                        onClick={() => setDeleteConfirm(curSite)}
                      >
                        Delete Facility
                      </button>
                    </div>
                  </div>
                )
              })()
            ) : (
              /* Empty State */
              <div style={{
                flex: 1, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                padding: '40px 24px', textAlign: 'center', color: '#65676b'
              }}>
                <div style={{
                  width: 54, height: 54, borderRadius: '50%',
                  background: '#f0f2f5', border: '1px solid #ced0d4',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  marginBottom: 16, color: '#8a8d91'
                }}>
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1 1 18 0z"/>
                    <circle cx="12" cy="10" r="3"/>
                  </svg>
                </div>
                <h4 style={{ fontSize: 15, fontWeight: 700, color: '#1c1e21', margin: '0 0 6px' }}>
                  Facility Inspector
                </h4>
                <p style={{ fontSize: 12, color: '#65676b', margin: 0, maxWidth: 280, lineHeight: 1.5 }}>
                  Click any facility marker on the map or select from the directory list on the left to inspect its real-time capacity, location, and operational controls.
                </p>

                <div style={{
                  marginTop: 24, width: '100%', background: '#f8f9fa',
                  borderRadius: 8, border: '1px solid #e4e6eb', padding: '14px',
                  display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, textAlign: 'left'
                }}>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#65676b', textTransform: 'uppercase' }}>Landfills</div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: '#dc2626' }}>{sites.filter(s => s.type === 'landfill').length}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#65676b', textTransform: 'uppercase' }}>Dumpsites</div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: '#d97706' }}>{sites.filter(s => s.type === 'dumpsite').length}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#65676b', textTransform: 'uppercase' }}>Transfer Hubs</div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: '#2563eb' }}>{sites.filter(s => s.type === 'transfer').length}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#65676b', textTransform: 'uppercase' }}>Composting</div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: '#16a34a' }}>{sites.filter(s => s.type === 'composting').length}</div>
                  </div>
                </div>
              </div>
            )}
          </div>

        </div>

      </div>
    </DashboardLayout>
  )
}
