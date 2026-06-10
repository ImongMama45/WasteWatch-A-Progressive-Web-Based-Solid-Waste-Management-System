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
import api from '../../api/client'

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

function SiteModal({ site, coords, onSave, onClose, barangays }) {
  const isEdit = !!site

  const [form, setForm] = useState(
    isEdit
      ? { name: site.name, type: site.type, barangay: site.barangay, notes: site.notes || '' }
      : { ...EMPTY_FORM }
  )
  const [account, setAccount] = useState({ ...EMPTY_ACCOUNT })
  const [detecting, setDetecting] = useState(false)
  const [detectedName, setDetectedName] = useState('')
  const [err, setErr] = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const setAc = (k, v) => setAccount(a => ({ ...a, [k]: v }))

  // ── Auto-detect barangay from coords via Nominatim ──
  useEffect(() => {
    if (isEdit || !coords) return
    setDetecting(true)
    setDetectedName('')
    const [lat, lng] = coords
    fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`)
      .then(r => r.json())
      .then(data => {
        // Nominatim returns suburb / village / neighbourhood for barangay-level
        const raw = data.address?.suburb
          || data.address?.village
          || data.address?.neighbourhood
          || data.address?.quarter
          || ''
        setDetectedName(raw)
        // Try to fuzzy-match against our barangay list
        if (raw) {
          const lc = raw.toLowerCase()
          const match = barangays.find(b =>
            b.name.toLowerCase().includes(lc) || lc.includes(b.name.toLowerCase())
          )
          if (match) set('barangay', match.id)
        }
      })
      .catch(() => { })
      .finally(() => setDetecting(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coords])

  function submit() {
    if (!form.name.trim()) { setErr('Site name is required.'); return }
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
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }} onClick={onClose}>
      <div style={{
        background: 'var(--surface)', borderRadius: 16, padding: 0,
        width: '100%', maxWidth: 460, boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }} onClick={e => e.stopPropagation()}>

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
              <span style={{ color: '#2ecc71', fontWeight: 700 }}>📍 {coords[0].toFixed(5)}, {coords[1].toFixed(5)}</span>
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
            <label className="form-label">Site Name</label>
            <input className="form-input" value={form.name}
              onChange={e => set('name', e.target.value)}
              placeholder="e.g. Main Landfill — Gulang-Gulang" />
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : '1fr 340px',
            gap: 16,
            height: isMobile ? 'auto' : 580,
          }}>
            <div>
              <label className="form-label">Type</label>
              <select className="form-input" value={form.type} onChange={e => set('type', e.target.value)}>
                {TYPES.map(t => <option key={t.value} value={t.value}>{t.emoji} {t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                Barangay
                {detecting && <span style={{ fontSize: 9, color: 'var(--text-muted)', fontStyle: 'italic', fontWeight: 400 }}>auto-detecting…</span>}
              </label>
              <select className="form-input" value={form.barangay} onChange={e => set('barangay', e.target.value)}>
                <option value="">{detecting ? 'Detecting…' : '— Select —'}</option>
                {barangays.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label className="form-label">Notes (optional)</label>
            <textarea className="form-input" rows={2} value={form.notes}
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
                <label className="form-label">Full Name</label>
                <input className="form-input" value={account.full_name}
                  onChange={e => setAc('full_name', e.target.value)}
                  placeholder="e.g. Gulang-Gulang Dumpsite" />
              </div>

              <div style={{ marginBottom: 12 }}>
                <label className="form-label">Email (username)</label>
                <input className="form-input" type="email" value={account.email}
                  onChange={e => setAc('email', e.target.value)}
                  placeholder="e.g. dumpsite.gulang@lucena.gov.ph" />
              </div>

              <div style={{ marginBottom: 16 }}>
                <label className="form-label">Password</label>
                <input className="form-input" type="password" value={account.password}
                  onChange={e => setAc('password', e.target.value)}
                  placeholder="Min. 6 characters" />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 22px', borderTop: '1px solid var(--border)', display: 'flex', gap: 10 }}>
          <button className="btn btn-outline" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={submit}>
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
  const capacity = site.capacity_used ?? site.capacity ?? 0
  const capColor = capacity > 80 ? '#e74c3c' : capacity > 60 ? '#f39c12' : '#2ecc71'
  const staff = site.staff_accounts || []

  const Row = ({ label, value, mono }) => (
    <div style={{ display: 'flex', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', width: 130, flexShrink: 0, textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</span>
      <span style={{ fontSize: 12, color: 'var(--text)', fontFamily: mono ? 'monospace' : undefined, wordBreak: 'break-all' }}>{value ?? '—'}</span>
    </div>
  )

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
      zIndex: 2100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }} onClick={onClose}>
      <div style={{
        background: 'var(--surface)', borderRadius: 18, padding: 0,
        width: '100%', maxWidth: 520, boxShadow: '0 24px 64px rgba(0,0,0,0.4)',
        maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }} onClick={e => e.stopPropagation()}>

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
              <span style={{ fontSize: 12, fontWeight: 700, color: capColor, width: 36, textAlign: 'right' }}>{capacity}%</span>
            </div>
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
          <button className="btn btn-outline" style={{ width: '100%' }} onClick={onClose}>Close</button>
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

// ── Main Component ────────────────────────────────────────────────────────────

export default function DumpsiteManagement() {
  const mapRef = useRef(null)
  const mapInstance = useRef(null)
  const markersRef = useRef({})       // id → leaflet marker
  const pendingRef = useRef(null)     // temp marker while modal is open

  const { sites, loading, saveSite, deleteSite: apiDeleteSite, createAccount } = useDumpsites()
  const [barangays, setBarangays] = useState([])

  const [mapReady, setMapReady] = useState(false)
  const [modal, setModal] = useState(null)  // null | 'add' | site obj
  const [pendingCoords, setPendingCoords] = useState(null)
  const [selected, setSelected] = useState(null)
  const [toast, setToast] = useState(null)
  const [typeFilter, setTypeFilter] = useState('all')
  const [addMode, setAddMode] = useState(false)
  const [detailSite, setDetailSite] = useState(null)  // site to show in detail popup

  // refs for closure access in Leaflet event handlers
  const addModeRef = useRef(false)
  addModeRef.current = addMode

  // ── Load Leaflet CDN ───────────────────────────────────────────────────────
  useEffect(() => {
    api.get('/api/barangays/').then(res => setBarangays(res.data))

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
      const marker = L.marker([lat, lng], { icon }).addTo(map)
      const t = typeMap[site.type] || TYPES[1]
      const bName = typeof site.barangay === 'object' ? site.barangay.name : site.barangay_name
      marker.bindPopup(`
        <div style="font-family:sans-serif;min-width:160px;">
          <strong style="color:${t.color}">${t.emoji} ${site.name}</strong><br/>
          <span style="color:#555;font-size:11px;">${t.label} · ${bName || 'Unknown'}</span><br/>
          <span style="color:#888;font-size:11px;">Capacity: ${site.capacity_used ?? 0}% full</span>
        </div>`)
      marker.on('click', () => setSelected(site))
      markersRef.current[site.id] = marker
    })
  }, [sites, mapReady])

  // ── cursor style when addMode active ──────────────────────────────────────
  useEffect(() => {
    if (!mapInstance.current) return
    mapInstance.current.getContainer().style.cursor = addMode ? 'crosshair' : ''
  }, [addMode])

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  async function handleSave(form, accountData) {
    let res
    if (modal === 'add') {
      const [lat, lng] = pendingCoords
      const payload = {
        name: form.name,
        type: form.type,
        barangay: form.barangay,
        lat,
        lng,
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
        notes: form.notes || '',
      }
      res = await saveSite(modal.id, payload)
      if (res.ok) showToast('✅ Site updated.')
    }
    if (res.ok) setModal(null)
    else alert(JSON.stringify(res.error))
  }

  async function deleteSite(id) {
    if (!window.confirm('Remove this site from the map?')) return
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
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  return (
    <DashboardLayout>

      {toast && (
        <div style={{
          position: 'fixed', top: 70, left: '50%', transform: 'translateX(-50%)',
          background: '#0f172a', color: '#fff', padding: '10px 22px',
          borderRadius: 12, zIndex: 9999, fontSize: 13, fontWeight: 600,
          border: '1px solid rgba(46,204,113,0.3)', whiteSpace: 'nowrap',
        }}>{toast}</div>
      )}

      {modal && (
        <SiteModal
          site={modal === 'add' ? null : modal}
          coords={modal === 'add' ? pendingCoords : null}
          barangays={barangays}
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

      <style>{`
        @keyframes ww-blink { 0%,100%{opacity:1} 50%{opacity:0.5} }
        .dm-row { transition:background .12s; cursor:pointer; }
        .dm-row:hover { background:var(--surface-2) !important; }
        .dm-site-btn { transition:all .15s; cursor:pointer; }
        .dm-site-btn:hover { opacity:.82; transform:scale(.97); }
      `}</style>

      <div className="page" style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 3 }}>
              <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 800, margin: 0 }}>
                Dumpsite & Landfill Map
              </h2>
              <span style={{
                background: 'rgba(231,76,60,0.1)', color: '#e74c3c',
                border: '1px solid rgba(231,76,60,0.3)',
                fontSize: 9, fontWeight: 800, padding: '3px 10px', borderRadius: 20,
              }}>ADMIN</span>
            </div>
            <p className="text-muted text-sm">Click the map to drop a new site pin. Click existing markers to manage them.</p>
          </div>

          <button
            className="dm-site-btn btn"
            onClick={() => setAddMode(a => !a)}
            style={{
              background: addMode ? '#f39c12' : 'var(--accent)', color: '#0d1117',
              border: 'none', borderRadius: 10, padding: '9px 18px', fontWeight: 700,
              alignSelf: 'flex-start',   // ← add this
            }}
          >
            {addMode ? '✕ Cancel — Click Map' : '+ Add Site (Click Map)'}
          </button>
        </div>

        {addMode && (
          <div style={{
            background: 'rgba(243,156,18,0.1)', border: '1px solid rgba(243,156,18,0.4)',
            borderRadius: 10, padding: '10px 16px', marginBottom: 14,
            fontSize: 13, color: '#f39c12', fontWeight: 600,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            🖱️ Click anywhere on the map below to place a new site pin.
          </div>
        )}



        {/* ── Two-column layout: map + side list ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'var(--dm-cols, 1fr 340px)', gap: 16, height: 'var(--dm-height, 580px)' }}
          ref={el => {
            if (!el) return
            const update = () => {
              const narrow = window.innerWidth < 500
              el.style.setProperty('--dm-cols', narrow ? '1fr' : '1fr 340px')
              el.style.setProperty('--dm-height', narrow ? 'auto' : '580px')
            }
            update()
            window.addEventListener('resize', update)
            return () => window.removeEventListener('resize', update)
          }}>

          {/* MAP */}
          <div className="card" style={{ padding: 0, overflow: 'hidden', position: 'relative', borderRadius: 14, height: isMobile ? 320 : '100%' }}>
            <div ref={mapRef} style={{ position: 'absolute', inset: 0, zIndex: 1 }} />
            {!mapReady && (
              <div style={{
                position: 'absolute', inset: 0, background: '#0f172a',
                display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 5,
              }}>
                <span style={{ color: '#5dade2', fontWeight: 600 }}>Loading Map…</span>
              </div>
            )}

            {/* Legend overlay */}
            <div style={{
              position: 'absolute', bottom: 16, left: 16, zIndex: 400,
              background: 'rgba(15,23,42,0.93)', borderRadius: 10, padding: '10px 14px',
              border: '1px solid rgba(255,255,255,0.1)',
            }}>
              {TYPES.map(t => (
                <div key={t.value} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                  <span style={{ fontSize: 14 }}>{t.emoji}</span>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: t.color }} />
                  <span style={{ color: '#cbd5e1', fontSize: 11 }}>{t.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* SIDE LIST */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, overflowY: isMobile ? 'visible' : 'auto', maxHeight: isMobile ? 'none' : 580 }}>

            {/* Type filter pills */}
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              <button className="dm-site-btn" onClick={() => setTypeFilter('all')} style={{
                padding: '4px 12px', borderRadius: 20, border: '1px solid',
                fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-body)',
                borderColor: typeFilter === 'all' ? 'var(--accent)' : 'var(--border)',
                color: typeFilter === 'all' ? 'var(--accent)' : 'var(--text-muted)',
                background: typeFilter === 'all' ? 'rgba(46,204,113,0.08)' : 'transparent',
              }}>All ({sites.length})</button>
              {TYPES.map(t => (
                <button key={t.value} className="dm-site-btn" onClick={() => setTypeFilter(t.value)} style={{
                  padding: '4px 12px', borderRadius: 20, border: '1px solid',
                  fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-body)',
                  borderColor: typeFilter === t.value ? t.color : 'var(--border)',
                  color: typeFilter === t.value ? t.color : 'var(--text-muted)',
                  background: typeFilter === t.value ? `${t.color}18` : 'transparent',
                }}>{t.emoji} {sites.filter(s => s.type === t.value).length}</button>
              ))}
            </div>

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
                <div
                  key={site.id}
                  className="dm-row"
                  onClick={() => flyTo(site)}
                  style={{
                    background: isSelected ? `${t.color}10` : 'var(--surface)',
                    border: `1px solid ${isSelected ? t.color : 'var(--border)'}`,
                    borderRadius: 12, padding: '12px 14px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                      background: `${t.color}18`, border: `1px solid ${t.color}44`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
                    }}>{t.emoji}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {site.name}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {t.label} · {(typeof site.barangay === 'object' ? site.barangay?.name : barangays.find(b => b.id === site.barangay)?.name) || site.barangay_name || 'Unknown'}
                      </div>
                    </div>
                    <span style={{
                      fontSize: 9, fontWeight: 800, padding: '2px 8px', borderRadius: 20,
                      background: `${t.color}18`, color: t.color, border: `1px solid ${t.color}44`,
                    }}>{t.label.toUpperCase()}</span>
                  </div>

                  <CapBar pct={site.capacity} />

                  {site.notes && (
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 5, fontStyle: 'italic' }}>
                      {site.notes}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                    <button className="dm-site-btn btn btn-outline btn-sm" style={{ flex: 1, fontSize: 11 }}
                      onClick={e => { e.stopPropagation(); setDetailSite(site) }}>
                      🔍 Details
                    </button>
                    <button className="dm-site-btn btn btn-outline btn-sm" style={{ flex: 1, fontSize: 11 }}
                      onClick={e => { e.stopPropagation(); setModal(site) }}>
                      ✏️ Edit
                    </button>
                    <button className="dm-site-btn btn btn-sm" style={{
                      background: 'rgba(231,76,60,0.07)', color: '#e74c3c',
                      border: '1px solid rgba(231,76,60,0.25)', fontSize: 11,
                    }} onClick={e => { e.stopPropagation(); deleteSite(site.id) }}>
                      🗑
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

      </div>
    </DashboardLayout>
  )
}
