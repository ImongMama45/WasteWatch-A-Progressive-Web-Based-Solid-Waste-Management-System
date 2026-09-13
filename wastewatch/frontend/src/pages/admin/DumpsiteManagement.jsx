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

const LUCENA_CENTER = [13.9373, 121.617]

const TYPES = [
  { value: 'landfill', label: 'Landfill', emoji: '🏔️', color: '#e74c3c' },
  { value: 'dumpsite', label: 'Open Dumpsite', emoji: '🗑️', color: '#f39c12' },
  { value: 'transfer', label: 'Transfer Station', emoji: '🏭', color: '#5dade2' },
  { value: 'composting', label: 'Composting Area', emoji: '🌿', color: '#2ecc71' },
]

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
  return `<div style="
    background:${t.color};border:2.5px solid white;border-radius:50% 50% 50% 0;
    transform:rotate(-45deg);width:36px;height:36px;
    display:flex;align-items:center;justify-content:center;
    box-shadow:0 4px 14px rgba(0,0,0,0.4);">
    <div style="transform:rotate(45deg);font-size:16px;">${t.emoji}</div>
  </div>`
}

function pendingMarkerHtml() {
  return `<div style="
    background:#fff;border:3px dashed #f39c12;border-radius:50%;
    width:36px;height:36px;display:flex;align-items:center;justify-content:center;
    font-size:18px;box-shadow:0 4px 14px rgba(0,0,0,0.3);
    animation:ww-blink 1s infinite;">📍</div>`
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
      fontSize: 9, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase',
      color: 'var(--text-muted)', marginBottom: 10, marginTop: 6,
      paddingBottom: 6, borderBottom: '1px solid var(--border)',
    }}>{label}</div>
  )

  return (
    <div className="dm-modal-ov" style={{ zIndex: 2000 }} onClick={onClose}>
      <div className="dm-modal" style={{ padding: 0, maxWidth: 460, display: 'flex', flexDirection: 'column', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding: '18px 22px 14px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontFamily: 'var(--font-head)', fontWeight: 800, fontSize: 17, margin: 0 }}>
            {isEdit ? 'Edit Site' : '+ Add New Site'}
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#888' }}>×</button>
        </div>

        {/* Scrollable body */}
        <div style={{ overflowY: 'auto', padding: '16px 22px' }}>

          {/* Coords + auto-detect status */}
          {coords && !isEdit && (
            <div style={{
              background: 'rgba(46,204,113,0.08)', border: '1px solid rgba(46,204,113,0.25)',
              borderRadius: 9, padding: '8px 12px', fontSize: 11, marginBottom: 16,
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span style={{ color: '#2ecc71', fontWeight: 700 }}>📍 Pinned Location</span>
              {detecting && <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Detecting barangay…</span>}
              {!detecting && detectedName && (
                <span style={{ color: 'var(--text-muted)' }}>· detected: <strong style={{ color: 'var(--text)' }}>{detectedName}</strong></span>
              )}
            </div>
          )}

          {err && (
            <div style={{
              background: 'rgba(231,76,60,0.08)', border: '1px solid rgba(231,76,60,0.3)',
              borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#e74c3c', marginBottom: 14,
            }}>{err}</div>
          )}

          {/* ── Site Info ── */}
          <SectionHead label="Site Information" />

          <div style={{ marginBottom: 12 }}>
            <label className="dm-label">Site Name</label>
            <input className="dm-input" value={form.name}
              onChange={e => set('name', e.target.value)}
              placeholder="e.g. Main Landfill — Gulang-Gulang" />
          </div>

          <SectionHead label="Location Coordinates" />
          <div style={{
            display: 'grid',
            gridTemplateColumns: window.innerWidth < 768 ? '1fr' : '1fr 1fr',
            gap: 16,
            marginBottom: 16,
          }}>
            <div>
              <label className="dm-label">Latitude</label>
              <input className="dm-input" type="number" step="any" value={form.lat}
                onChange={e => set('lat', e.target.value)}
                placeholder="e.g. 13.9373" />
            </div>
            <div>
              <label className="dm-label">Longitude</label>
              <input className="dm-input" type="number" step="any" value={form.lng}
                onChange={e => set('lng', e.target.value)}
                placeholder="e.g. 121.617" />
            </div>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: window.innerWidth < 768 ? '1fr' : '1fr 1fr',
            gap: 16,
            marginBottom: 16,
          }}>
            <div>
              <label className="dm-label">Type</label>
              <select className="dm-select" value={form.type} onChange={e => set('type', e.target.value)}>
                {TYPES.map(t => <option key={t.value} value={t.value}>{t.emoji} {t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="dm-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                Barangay
                {detecting && <span style={{ fontSize: 9, color: 'var(--text-muted)', fontStyle: 'italic', fontWeight: 400 }}>auto-detecting…</span>}
              </label>
              <select className="dm-select" value={form.barangay} onChange={e => set('barangay', e.target.value)}>
                <option value="">{detecting ? 'Detecting…' : '— Select —'}</option>
                {barangays.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label className="dm-label">Notes (optional)</label>
            <textarea className="dm-textarea" rows={2} value={form.notes}
              onChange={e => set('notes', e.target.value)} placeholder="Additional info…"
              style={{ resize: 'vertical' }} />
          </div>

          {/* ── Account Credentials (Add only) ── */}
          {!isEdit && (
            <>
              <SectionHead label="Dumpsite Account Credentials" />
              <div style={{
                background: 'rgba(93,173,226,0.06)', border: '1px solid rgba(93,173,226,0.2)',
                borderRadius: 9, padding: '8px 12px', fontSize: 11, color: 'var(--info)',
                marginBottom: 14,
              }}>
                🔑 These credentials will be used to log in as this dumpsite’s account.
              </div>

              <div style={{ marginBottom: 12 }}>
                <label className="dm-label">Full Name</label>
                <input className="dm-input" value={account.full_name}
                  onChange={e => setAc('full_name', e.target.value)}
                  placeholder="e.g. Gulang-Gulang Dumpsite" />
              </div>

              <div style={{ marginBottom: 12 }}>
                <label className="dm-label">Email (username)</label>
                <input className="dm-input" type="email" value={account.email}
                  onChange={e => setAc('email', e.target.value)}
                  placeholder="e.g. dumpsite.gulang@lucena.gov.ph" />
              </div>

              <div style={{ marginBottom: 16 }}>
                <label className="dm-label">Password</label>
                <input className="dm-input" type="password" value={account.password}
                  onChange={e => setAc('password', e.target.value)}
                  placeholder="Min. 6 characters" />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 22px', borderTop: '1px solid var(--border)', display: 'flex', gap: 10 }}>
          <button className="dm-btn-ghost" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
          <button className="dm-btn-primary" style={{ flex: 1 }} onClick={submit}>
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
  const capColor = capacity > 80 ? '#e74c3c' : capacity > 60 ? '#f39c12' : '#2ecc71'
  const staff = site.staff_accounts || []

  const Row = ({ label, value, mono }) => (
    <div style={{ display: 'flex', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', width: 130, flexShrink: 0, textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</span>
      <span style={{ fontSize: 12, color: 'var(--text)', fontFamily: mono ? 'monospace' : undefined, wordBreak: 'break-all' }}>{value ?? '—'}</span>
    </div>
  )

  return (
    <div className="dm-modal-ov" style={{ zIndex: 2100 }} onClick={onClose}>
      <div className="dm-modal" style={{ padding: 0, maxWidth: 520, display: 'flex', flexDirection: 'column', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{
          background: `linear-gradient(135deg, ${t.color}22, ${t.color}08)`,
          borderBottom: `1px solid ${t.color}33`,
          padding: '18px 22px', display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12, flexShrink: 0,
            background: `${t.color}22`, border: `1px solid ${t.color}44`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
          }}>{t.emoji}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-head)', fontSize: 17, fontWeight: 800, color: 'var(--text)', marginBottom: 2 }}>{site.name}</div>
            <div style={{ fontSize: 11, color: t.color, fontWeight: 700 }}>{t.label} · {bName}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#888', flexShrink: 0 }}>×</button>
        </div>

        {/* Scrollable body */}
        <div style={{ overflowY: 'auto', padding: '16px 22px' }}>

          {/* ── Site Details ── */}
          <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 8 }}>Site Details</div>
          <Row label="Site ID" value={`#${site.id}`} mono />
          <Row label="Name" value={site.name} />
          <Row label="Type" value={`${t.emoji} ${t.label}`} />
          <Row label="Barangay" value={bName} />
          <Row label="Notes" value={site.notes || '—'} />

          {/* Capacity bar */}
          <div style={{ display: 'flex', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', width: 130, flexShrink: 0, textTransform: 'uppercase', letterSpacing: '.05em' }}>Capacity Used</span>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1, background: 'var(--border)', borderRadius: 20, height: 7, overflow: 'hidden' }}>
                <div style={{ width: `${capacity}%`, height: '100%', background: capColor, borderRadius: 20, transition: 'width .5s' }} />
              </div>
              <span style={{ fontSize: 12, fontWeight: 700, color: capColor, minWidth: 36, textAlign: 'right' }}>{capacity}%</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', width: 130, flexShrink: 0, textTransform: 'uppercase', letterSpacing: '.05em' }}>Current Fill (KG)</span>
            <span style={{ fontSize: 12, color: 'var(--text)', fontFamily: 'monospace' }}>
              {Number(site.current_fill_kg || 0).toLocaleString()} / {Number(site.max_capacity_kg || 50000).toLocaleString()} kg
            </span>
          </div>

          {/* ── Coordinates ── */}
          <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '.1em', textTransform: 'uppercase', margin: '14px 0 8px' }}>Coordinates</div>
          <Row label="Latitude" value={Number(site.latitude).toFixed(6)} mono />
          <Row label="Longitude" value={Number(site.longitude).toFixed(6)} mono />

          {/* ── Linked Accounts ── */}
          <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '.1em', textTransform: 'uppercase', margin: '14px 0 8px' }}>
            Linked Accounts ({staff.length})
          </div>
          {staff.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '10px 0', fontStyle: 'italic' }}>No accounts linked to this site.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {staff.map(u => (
                <div key={u.id} style={{
                  background: 'var(--bg)', border: '1px solid var(--border)',
                  borderRadius: 10, padding: '10px 12px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                    <div style={{
                      width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                      background: 'rgba(93,173,226,.15)', border: '1px solid rgba(93,173,226,.3)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 13, fontWeight: 800, color: 'var(--info)',
                    }}>{u.full_name?.[0]?.toUpperCase() || '?'}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.full_name}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</div>
                    </div>
                    <span style={{
                      fontSize: 8, fontWeight: 800, padding: '2px 8px', borderRadius: 20, flexShrink: 0,
                      background: u.is_active ? 'rgba(46,204,113,.12)' : 'rgba(231,76,60,.12)',
                      color: u.is_active ? 'var(--accent)' : 'var(--danger)',
                      border: u.is_active ? '1px solid rgba(46,204,113,.3)' : '1px solid rgba(231,76,60,.3)',
                      textTransform: 'uppercase',
                    }}>{u.is_active ? 'Active' : 'Inactive'}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {[{ label: 'Role', val: u.role }, { label: 'Barangay', val: u.barangay || '—' }, { label: 'Joined', val: u.created_at }].map(p => (
                      <div key={p.label} style={{
                        display: 'flex', gap: 4, alignItems: 'center',
                        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '2px 8px',
                      }}>
                        <span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 600 }}>{p.label}:</span>
                        <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text)' }}>{p.val}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ padding: '12px 22px', borderTop: '1px solid var(--border)' }}>
          <button className="dm-btn-ghost" style={{ width: '100%' }} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

// ── Capacity Bar ──────────────────────────────────────────────────────────────

function CapBar({ pct }) {
  const p = Number(pct) || 0
  const color = p > 80 ? '#e74c3c' : p > 60 ? '#f39c12' : '#2ecc71'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, background: '#ddd', borderRadius: 20, height: 5, overflow: 'hidden' }}>
        <div style={{ width: `${p}%`, height: '100%', background: color, borderRadius: 20 }} />
      </div>
      <span style={{ fontSize: 10, color: '#888', width: 28, textAlign: 'right' }}>{p}%</span>
    </div>
  )
}

// ── Warning Modals ────────────────────────────────────────────────────────────

function DeleteConfirmModal({ site, onConfirm, onClose }) {
  if (!site) return null
  return (
    <div className="dm-modal-ov" style={{ zIndex: 3000 }} onClick={onClose}>
      <div className="dm-modal" style={{ padding: 0, maxWidth: 420, overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '24px 24px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
          <div style={{ width: 56, height: 56, background: 'rgba(239, 68, 68, 0.1)', color: '#EF4444', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/></svg>
          </div>
          <h3 style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)', marginBottom: 8, fontFamily: 'var(--font-head)' }}>Delete Dumpsite?</h3>
          <p style={{ fontSize: 14, color: 'var(--text)', marginBottom: 16 }}>
            You are about to permanently delete <strong>{site.name}</strong>.
          </p>
          <div style={{ background: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.2)', padding: '12px 16px', borderRadius: 8, fontSize: 13, color: '#EF4444', textAlign: 'left', lineHeight: 1.5 }}>
            <strong style={{ display: 'block', marginBottom: 4 }}>⚠️ Impact Warning:</strong>
            This action cannot be undone. All collection logs and routes associated with this facility may lose relational integrity, and linked accounts will be orphaned.
          </div>
        </div>
        <div style={{ padding: '16px 24px 24px', display: 'flex', gap: 12 }}>
          <button className="dm-btn-ghost" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
          <button className="dm-btn-primary" style={{ flex: 1, background: '#EF4444' }} onClick={() => { onConfirm(site.id); onClose() }}>Delete Permanently</button>
        </div>
      </div>
    </div>
  )
}

function OutOfBoundsModal({ warning, onClose }) {
  if (!warning) return null
  return (
    <div className="dm-modal-ov" style={{ zIndex: 3000 }} onClick={onClose}>
      <div className="dm-modal" style={{ padding: 0, maxWidth: 420, overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '24px 24px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
          <div style={{ width: 56, height: 56, background: 'rgba(245, 158, 11, 0.1)', color: '#F59E0B', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01"/></svg>
          </div>
          <h3 style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)', marginBottom: 8, fontFamily: 'var(--font-head)' }}>{warning.title}</h3>
          <p style={{ fontSize: 14, color: 'var(--text)', marginBottom: 16 }}>
            {warning.message}
          </p>
          <div style={{ background: 'rgba(245, 158, 11, 0.05)', border: '1px solid rgba(245, 158, 11, 0.2)', padding: '12px 16px', borderRadius: 8, fontSize: 13, color: '#B45309', textAlign: 'left', lineHeight: 1.5 }}>
            <strong style={{ display: 'block', marginBottom: 4 }}>ℹ️ Why?</strong>
            {warning.reason}
          </div>
        </div>
        <div style={{ padding: '16px 24px 24px', display: 'flex' }}>
          <button className="dm-btn-primary" style={{ width: '100%', background: '#F59E0B', color: '#fff' }} onClick={onClose}>Acknowledge</button>
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
        <div style="font-family:sans-serif;min-width:160px;">
          <strong style="color:${t.color}">${t.emoji} ${site.name}</strong><br/>
          <span style="color:#555;font-size:11px;">${t.label} · ${bName || 'Unknown'}</span><br/>
          <span style="color:#888;font-size:11px;">Capacity: ${site.fill_percent ?? site.capacity_used ?? 0}% full</span><br/>
          <span style="color:#3498db;font-size:10px;font-style:italic;margin-top:4px;display:inline-block;">💡 Drag marker to move</span>
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
          showToast(`✅ Site added. ⚠️ Account error: ${accRes.error}`)
        } else {
          showToast('✅ Site added and account created.')
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
      if (res.ok) showToast('✅ Site updated.')
    }
    if (res.ok) setModal(null)
    else notify({ variant: 'error-outline', message: getApiErrorMessage(res.error, 'Failed to save site.') })
  }

  async function deleteSite(id) {
    const res = await apiDeleteSite(id)
    if (res.ok) {
      if (selected?.id === id) setSelected(null)
      showToast('🗑 Site removed.')
    }
  }

  function flyTo(site) {
    if (!mapInstance.current) return
    mapInstance.current.flyTo([Number(site.latitude), Number(site.longitude)], 16, { duration: 1 })
    setSelected(site)
  }

  const filtered = useMemo(() =>
    typeFilter === 'all' ? sites : sites.filter(s => s.type === typeFilter)
    , [sites, typeFilter])

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

    /* ── Page layout ── */
    .dm-page { padding: 24px; max-width: 1280px; margin: 0 auto; }

    /* ── Builder grid ── */
    .dm-builder-grid { display:grid; grid-template-columns:1fr 360px; gap:18px; align-items:start; }
    .dm-map-wrap { position:relative; border-radius:14px; overflow:hidden; height:640px; background:var(--surface-2); border:1px solid var(--border); box-shadow:var(--shadow-sm); }
    .dm-map-toggle { display:none; }

    /* ── Panel card ── */
    .dm-panel { background:var(--surface); border:1px solid var(--border); border-radius:14px; padding:20px; box-shadow:var(--shadow-sm); animation:dmFadeUp .18s; }
    .dm-panel-title { font-family:var(--font-head); font-size:15px; font-weight:700; color:var(--text); margin:0 0 2px; }
    .dm-panel-sub   { font-size:12px; color:var(--text-muted); margin:0 0 18px; }

    /* ── Form ── */
    .dm-label { display:block; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.07em; color:var(--text-muted); margin-bottom:5px; }
    .dm-input, .dm-select, .dm-textarea { width:100%; background:var(--surface); border:1.5px solid var(--border); border-radius:9px; padding:9px 12px; font-size:13px; color:var(--text); transition:border-color .14s,box-shadow .14s; outline:none; box-sizing:border-box; font-family:var(--font-body); box-shadow:var(--shadow-xs); }
    .dm-input:focus, .dm-select:focus, .dm-textarea:focus { border-color:var(--accent); box-shadow:0 0 0 3px rgba(22,163,74,.1); }
    .dm-input::placeholder, .dm-textarea::placeholder { color:var(--text-light); }
    .dm-select option { background:#fff; color:var(--text); }

    /* ── Dumpsite card ── */
    .dm-ds-card { border-radius:10px; padding:13px 14px; margin-bottom:9px; display:flex; align-items:center; gap:12px; cursor:pointer; transition:all .13s; border:1.5px solid var(--border); background:var(--surface); }
    .dm-ds-card:hover { border-color:rgba(22,163,74,.35); background:rgba(22,163,74,.03); }
    .dm-ds-card.sel { border-color:var(--accent); background:rgba(22,163,74,.06); }

    /* ── Buttons ── */
    .dm-btn-primary { background:var(--accent); color:#fff; border:none; border-radius:9px; padding:9px 17px; font-size:13px; font-weight:600; cursor:pointer; transition:all .14s; display:inline-flex; align-items:center; gap:6px; font-family:var(--font-body); justify-content:center; box-shadow:0 1px 3px rgba(22,163,74,.25); }
    .dm-btn-primary:hover { background:var(--accent-dim); }
    .dm-btn-primary:active { transform:scale(.97); }
    .dm-btn-primary:disabled { opacity:.35; cursor:not-allowed; transform:none; }
    
    .dm-btn-ghost { background:var(--surface-2); color:var(--text-muted); border:1px solid var(--border); border-radius:9px; padding:9px 17px; font-size:13px; font-weight:600; cursor:pointer; transition:all .14s; font-family:var(--font-body); justify-content:center; }
    .dm-btn-ghost:hover { color:var(--text); border-color:var(--border-2); background:var(--surface-3); }

    .dm-btn-edit  { background:rgba(37,99,235,.06); color:#2563EB; border:1px solid rgba(37,99,235,.2); border-radius:7px; padding:5px 11px; font-size:11px; font-weight:600; cursor:pointer; transition:all .13s; display:inline-flex; align-items:center; gap:5px; font-family:var(--font-body); }
    .dm-btn-edit:hover { background:rgba(37,99,235,.12); }

    .dm-btn-del   { background:rgba(220,38,38,.06); color:#DC2626; border:1px solid rgba(220,38,38,.18); border-radius:7px; padding:5px 11px; font-size:11px; font-weight:600; cursor:pointer; transition:all .13s; display:inline-flex; align-items:center; gap:5px; font-family:var(--font-body); }
    .dm-btn-del:hover { background:rgba(220,38,38,.12); }
    
    .dm-btn-sm { padding:6px 12px; font-size:12px; border-radius:8px; }

    /* ── Modal overlay ── */
    .dm-modal-ov { position:fixed; inset:0; background:rgba(0,0,0,.45); z-index:9998; display:flex; align-items:center; justify-content:center; padding:16px; backdrop-filter:blur(4px); }
    .dm-modal    { background:var(--surface); border:1px solid var(--border); border-radius:16px; padding:24px; width:100%; max-width:440px; max-height:85vh; overflow-y:auto; animation:dmModalIn .18s; box-shadow:var(--shadow-lg); }
    .dm-modal::-webkit-scrollbar { width:4px; }
    .dm-modal::-webkit-scrollbar-thumb { background:var(--border-2); border-radius:2px; }

    /* ── Toast ── */
    .dm-toast { position:fixed; top:70px; left:50%; transform:translateX(-50%); background:var(--surface); color:var(--text); padding:10px 20px; border-radius:10px; z-index:9999; font-size:13px; font-weight:600; border:1px solid var(--border); white-space:nowrap; animation:dmToastIn .2s; box-shadow:var(--shadow-lg); }

    .dm-spinner { width:10px; height:10px; border-radius:50%; border:2px solid var(--border); border-top-color:var(--accent); animation:dmSpin .75s linear infinite; flex-shrink:0; }

    @media (max-width:900px) {
      .dm-builder-grid { grid-template-columns:1fr; }
      .dm-map-wrap { height:360px; display:none; }
      .dm-map-wrap.vis { display:block; }
      .dm-map-toggle { display:flex; width:100%; align-items:center; justify-content:center; gap:8px; padding:10px; margin-bottom:12px; border-radius:10px; border:1px solid var(--border); background:var(--surface); font-size:13px; font-weight:600; color:var(--text); cursor:pointer; }
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
          <div className="dm-modal" style={{ maxWidth: 400, textAlign: 'center' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>⚠️</div>
            <h3 style={{ margin: '0 0 12px 0', fontSize: 18, color: 'var(--text)' }}>Move Dumpsite?</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 24, lineHeight: 1.5 }}>
              Are you sure you want to move <strong>{moveConfirm.site.name}</strong> to the new location?
            </p>
            <div style={{ display: 'flex', gap: 12 }}>
              <button className="dm-btn-ghost" style={{ flex: 1 }} onClick={() => {
                moveConfirm.target.setLatLng([moveConfirm.oldLat, moveConfirm.oldLng])
                setMoveConfirm(null)
              }}>Cancel</button>
              <button className="dm-btn-primary" style={{ flex: 1, background: '#e74c3c' }} onClick={async () => {
                const payload = { lat: moveConfirm.newLat, lng: moveConfirm.newLng }
                const res = await saveSite(moveConfirm.site.id, payload)
                if (res.ok) {
                  showToast('✅ Site moved successfully.')
                } else {
                  showToast('❌ Failed to move site.')
                  moveConfirm.target.setLatLng([moveConfirm.oldLat, moveConfirm.oldLng])
                }
                setMoveConfirm(null)
              }}>Yes, Move It</button>
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

      <div className="dm-page">

        {/* ── Header ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 22, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 4 }}>
              <h2 style={{ fontSize: 22, fontWeight: 800, margin: 0, color: 'var(--text)', fontFamily: 'var(--font-head)', letterSpacing: '-.02em' }}>Dumpsite Management</h2>
              <span style={{ background: 'rgba(231,76,60,0.1)', color: '#e74c3c', border: '1px solid rgba(231,76,60,0.3)', fontSize: 9, fontWeight: 800, padding: '3px 9px', borderRadius: 20, letterSpacing: '.06em' }}>ADMIN</span>
            </div>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>Manage disposal facilities, landfills, and transfer stations.</p>
          </div>
          <button className="dm-btn-primary" onClick={() => setAddMode(a => !a)} style={{ background: addMode ? '#D97706' : 'var(--accent)' }}>
            {addMode ? '✕ Cancel — Click Map' : '+ Add Site (Click Map)'}
          </button>
        </div>

        {addMode && (
          <div style={{ padding: '8px 11px', background: 'rgba(217,119,6,.06)', border: '1px solid rgba(217,119,6,.2)', borderRadius: 9, fontSize: 11, color: 'var(--warning)', marginBottom: 16 }}>
            🖱️ Click anywhere on the map below to place a new site pin.
          </div>
        )}



        {/* ── Two-column layout: map + side list ── */}

        <button className="dm-map-toggle" onClick={() => { setShowMap(v => !v); setTimeout(() => { try { mapInstance.current?.invalidateSize() } catch { } }, 50) }}>
          <IcoMap size={14} color="var(--text-muted)" />
          {showMap ? 'Hide Map' : 'Show Map'}
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>{showMap ? '▲' : '▼'}</span>
        </button>

        <div className="dm-builder-grid">

          {/* MAP */}
          <div className={`dm-map-wrap${showMap ? ' vis' : ''}`}>
            <div ref={mapRef} style={{ position: 'absolute', inset: 0, zIndex: 1 }} />
            {!mapReady && (
              <div style={{ position: 'absolute', inset: 0, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 5 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div className="dm-spinner" /><span style={{ color: 'var(--accent)', fontWeight: 600, fontSize: 13 }}>Loading Map…</span>
                </div>
              </div>
            )}

            {/* Legend overlay */}
            <div style={{
              position: 'absolute', bottom: 14, left: 14, zIndex: 400,
              background: 'rgba(255,255,255,.94)', backdropFilter: 'blur(6px)', borderRadius: 10, padding: '9px 13px',
              border: '1px solid var(--border)', fontSize: 11, color: 'var(--text-muted)', boxShadow: 'var(--shadow-sm)'
            }}>
              {TYPES.map(t => (
                <div key={t.value} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{ fontSize: 13 }}>{t.emoji}</span>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: t.color }} />
                  <span style={{ color: 'var(--text-muted)' }}>{t.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* SIDE LIST */}
          <div className="dm-panel" style={{ display: 'flex', flexDirection: 'column', gap: 0, padding: 16, maxHeight: 640 }}>
            <p className="dm-panel-title">Sites Directory</p>
            <p className="dm-panel-sub" style={{ marginBottom: 12 }}>Filter and manage locations.</p>

            {/* Type filter pills */}
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 14 }}>
              <button onClick={() => setTypeFilter('all')} style={{
                padding: '4px 12px', borderRadius: 20, border: '1px solid',
                fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-body)', cursor: 'pointer', transition: 'all .12s',
                borderColor: typeFilter === 'all' ? 'var(--accent)' : 'transparent',
                color: typeFilter === 'all' ? 'var(--accent)' : 'var(--text-muted)',
                background: typeFilter === 'all' ? 'rgba(22,163,74,.08)' : 'var(--surface-2)',
              }}>All ({sites.length})</button>
              {TYPES.map(t => (
                <button key={t.value} onClick={() => setTypeFilter(t.value)} style={{
                  padding: '4px 12px', borderRadius: 20, border: '1px solid',
                  fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-body)', cursor: 'pointer', transition: 'all .12s',
                  borderColor: typeFilter === t.value ? t.color : 'transparent',
                  color: typeFilter === t.value ? t.color : 'var(--text-muted)',
                  background: typeFilter === t.value ? `${t.color}18` : 'var(--surface-2)',
                }}>{t.emoji} {sites.filter(s => s.type === t.value).length}</button>
              ))}
            </div>

            <div style={{ flex: 1, overflowY: 'auto', paddingRight: 4 }}>
              {/* Site cards */}
              {filtered.length === 0 && (
                <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--text-muted)', fontSize: 13 }}>
                  No sites found.
                </div>
              )}

              {filtered.map(site => {
                const t = typeMap[site.type] || TYPES[1]
                const isSelected = selected?.id === site.id
                return (
                  <div key={site.id} className={`dm-ds-card${isSelected ? ' sel' : ''}`} onClick={() => flyTo(site)} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 34, height: 34, borderRadius: 9, background: isSelected ? `${t.color}22` : 'var(--surface-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, flexShrink: 0 }}>
                        {t.emoji}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)', marginBottom: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {site.name}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {t.label} · {(typeof site.barangay === 'object' ? site.barangay?.name : barangays.find(b => b.id === site.barangay)?.name) || site.barangay_name || 'Unknown'}
                        </div>
                      </div>
                    </div>
                    
                    <div style={{ marginTop: 6, marginBottom: 2 }}>
                      <CapBar pct={site.fill_percent ?? site.capacity_used ?? site.capacity ?? 0} />
                    </div>

                    {site.notes && (
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, fontStyle: 'italic' }}>
                        {site.notes}
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                      <button className="dm-btn-edit" style={{ flex: 1, justifyContent: 'center' }} onClick={e => { e.stopPropagation(); setDetailSite(site) }}>
                        Details
                      </button>
                      <button className="dm-btn-edit" style={{ flex: 1, justifyContent: 'center' }} onClick={e => { e.stopPropagation(); setModal(site) }}>
                        Edit
                      </button>
                      <button className="dm-btn-del" style={{ flex: 1, justifyContent: 'center' }} onClick={e => { e.stopPropagation(); setDeleteConfirm(site) }}>
                        Delete
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

      </div>
    </DashboardLayout>
  )
}
