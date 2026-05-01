/**
 * pages/admin/TruckManagement.jsx
 * --------------------------------
 * Admin: Truck & Driver Management
 * - Truck list with plate, status, driver, crew
 * - Add / Edit truck modal
 * - Assign driver and crew members
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import DashboardLayout from '../../components/DashboardLayout'

// ─── Mock Data ───────────────────────────────────────────────────────────────

const INITIAL_TRUCKS = [
  {
    id: 1, plate: 'LCN-001', model: 'Isuzu Elf', status: 'active',
    driver: 'Juan Dela Cruz', crew: ['Pedro Santos', 'Mario Reyes'],
    zone: 'Zone 3 — 5th Ave', capacity: 85, lastService: '2026-04-10',
  },
  {
    id: 2, plate: 'LCN-002', model: 'Hino 300', status: 'active',
    driver: 'Ana Mendoza', crew: ['Carlo Ramos'],
    zone: 'Zone 1 — Main St', capacity: 60, lastService: '2026-04-08',
  },
  {
    id: 3, plate: 'LCN-003', model: 'Isuzu Elf', status: 'maintenance',
    driver: null, crew: [],
    zone: 'Unassigned', capacity: 0, lastService: '2026-03-30',
  },
  {
    id: 4, plate: 'LCN-004', model: 'Mitsubishi Canter', status: 'active',
    driver: 'Jose Bautista', crew: ['Liza Torres', 'Ramon Cruz', 'Ben Aquino'],
    zone: 'Zone 4 — Quezon Blvd', capacity: 92, lastService: '2026-04-12',
  },
  {
    id: 5, plate: 'LCN-005', model: 'Hino 300', status: 'inactive',
    driver: null, crew: [],
    zone: 'Unassigned', capacity: 0, lastService: '2026-02-20',
  },
]

const ALL_DRIVERS = [
  'Juan Dela Cruz', 'Ana Mendoza', 'Jose Bautista',
  'Maria Reyes', 'Carlo Ramos', 'Liza Torres', 'Pedro Santos',
]

const ALL_CREW = [
  'Pedro Santos', 'Mario Reyes', 'Carlo Ramos', 'Liza Torres',
  'Ramon Cruz', 'Ben Aquino', 'Tony Flores', 'Danny Mercado',
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_META = {
  active: { label: 'Active', color: '#2ecc71', bg: 'rgba(46,204,113,0.1)', border: 'rgba(46,204,113,0.3)' },
  maintenance: { label: 'Maintenance', color: '#f39c12', bg: 'rgba(243,156,18,0.1)', border: 'rgba(243,156,18,0.3)' },
  inactive: { label: 'Inactive', color: '#e74c3c', bg: 'rgba(231,76,60,0.1)', border: 'rgba(231,76,60,0.3)' },
}

function StatusBadge({ status }) {
  const m = STATUS_META[status] || STATUS_META.inactive
  return (
    <span style={{
      background: m.bg, border: `1px solid ${m.border}`, color: m.color,
      borderRadius: 20, padding: '2px 10px', fontSize: 9, fontWeight: 800,
      letterSpacing: '.06em', whiteSpace: 'nowrap',
    }}>
      {m.label.toUpperCase()}
    </span>
  )
}

function CapacityBar({ pct }) {
  const color = pct > 80 ? '#e74c3c' : pct > 55 ? '#f39c12' : '#2ecc71'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, background: '#e0e0e0', borderRadius: 20, height: 6, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 20, transition: 'width .4s' }} />
      </div>
      <span style={{ fontSize: 10, color: '#888', width: 28, textAlign: 'right' }}>{pct}%</span>
    </div>
  )
}

// ─── Modal ────────────────────────────────────────────────────────────────────

const EMPTY_FORM = { plate: '', model: '', status: 'active', driver: '', crew: [], zone: '', lastService: '' }

function TruckModal({ truck, onSave, onClose }) {
  const [form, setForm] = useState(truck ? {
    plate: truck.plate, model: truck.model, status: truck.status,
    driver: truck.driver || '', crew: [...truck.crew],
    zone: truck.zone, lastService: truck.lastService,
  } : { ...EMPTY_FORM })
  const [crewInput, setCrewInput] = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const addCrew = (name) => {
    if (!name || form.crew.includes(name)) return
    set('crew', [...form.crew, name])
    setCrewInput('')
  }

  const removeCrew = (name) => set('crew', form.crew.filter(c => c !== name))

  const availableDrivers = ALL_DRIVERS.filter(d => d !== form.driver)
  const availableCrew = ALL_CREW.filter(c => !form.crew.includes(c))

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
      zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 16,
    }} onClick={onClose}>
      <div style={{
        background: 'var(--surface)', borderRadius: 16, padding: 24,
        width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
      }} onClick={e => e.stopPropagation()}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h3 style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 800, margin: 0 }}>
            {truck ? 'Edit Truck' : 'Add New Truck'}
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#888' }}>×</button>
        </div>

        {/* Plate & Model */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
          <div>
            <label className="form-label">Plate Number</label>
            <input className="form-input" value={form.plate} onChange={e => set('plate', e.target.value)} placeholder="LCN-001" />
          </div>
          <div>
            <label className="form-label">Model</label>
            <input className="form-input" value={form.model} onChange={e => set('model', e.target.value)} placeholder="Isuzu Elf" />
          </div>
        </div>

        {/* Status & Zone */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
          <div>
            <label className="form-label">Status</label>
            <select className="form-input" value={form.status} onChange={e => set('status', e.target.value)}>
              <option value="active">Active</option>
              <option value="maintenance">Maintenance</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <div>
            <label className="form-label">Last Service</label>
            <input className="form-input" type="date" value={form.lastService} onChange={e => set('lastService', e.target.value)} />
          </div>
        </div>

        {/* Zone */}
        <div style={{ marginBottom: 14 }}>
          <label className="form-label">Assigned Zone</label>
          <input className="form-input" value={form.zone} onChange={e => set('zone', e.target.value)} placeholder="Zone 1 — Main St" />
        </div>

        {/* Driver */}
        <div style={{ marginBottom: 14 }}>
          <label className="form-label">Assigned Driver</label>
          <select className="form-input" value={form.driver} onChange={e => set('driver', e.target.value)}>
            <option value="">— No Driver —</option>
            {ALL_DRIVERS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>

        {/* Crew */}
        <div style={{ marginBottom: 20 }}>
          <label className="form-label">Crew Members</label>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <select
              className="form-input"
              value={crewInput}
              onChange={e => setCrewInput(e.target.value)}
              style={{ flex: 1 }}
            >
              <option value="">— Select crew member —</option>
              {availableCrew.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <button
              onClick={() => addCrew(crewInput)}
              style={{
                background: 'var(--accent)', color: '#0d1117', border: 'none',
                borderRadius: 8, padding: '0 14px', fontWeight: 700, cursor: 'pointer',
              }}
            >Add</button>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {form.crew.length === 0 && (
              <span style={{ fontSize: 12, color: '#aaa' }}>No crew assigned yet.</span>
            )}
            {form.crew.map(c => (
              <span key={c} style={{
                background: 'var(--surface-2)', border: '1px solid var(--border)',
                borderRadius: 20, padding: '4px 10px', fontSize: 12,
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                {c}
                <button
                  onClick={() => removeCrew(c)}
                  style={{ background: 'none', border: 'none', color: '#e74c3c', cursor: 'pointer', fontSize: 14, padding: 0, lineHeight: 1 }}
                >×</button>
              </span>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-outline" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            style={{ flex: 1 }}
            onClick={() => {
              if (!form.plate.trim()) return alert('Plate number is required.')
              onSave(form)
            }}
          >
            {truck ? 'Save Changes' : 'Add Truck'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function TruckManagement() {
  const navigate = useNavigate()
  const [trucks, setTrucks] = useState(INITIAL_TRUCKS)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState(null)   // null | 'add' | truck object
  const [expanded, setExpanded] = useState(null)
  const [toast, setToast] = useState(null)

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  function handleSave(form) {
    if (modal === 'add') {
      setTrucks(prev => [...prev, { ...form, id: Date.now(), capacity: 0 }])
      showToast('✅ Truck added successfully.')
    } else {
      setTrucks(prev => prev.map(t => t.id === modal.id ? { ...t, ...form } : t))
      showToast('✅ Truck updated successfully.')
    }
    setModal(null)
  }

  function deleteTruck(id) {
    if (!window.confirm('Delete this truck record?')) return
    setTrucks(prev => prev.filter(t => t.id !== id))
    setExpanded(null)
    showToast('🗑 Truck removed.')
  }

  const filtered = trucks.filter(t => {
    const matchStatus = filter === 'all' || t.status === filter
    const matchSearch = !search ||
      t.plate.toLowerCase().includes(search.toLowerCase()) ||
      (t.driver || '').toLowerCase().includes(search.toLowerCase()) ||
      t.zone.toLowerCase().includes(search.toLowerCase())
    return matchStatus && matchSearch
  })

  const counts = {
    all: trucks.length,
    active: trucks.filter(t => t.status === 'active').length,
    maintenance: trucks.filter(t => t.status === 'maintenance').length,
    inactive: trucks.filter(t => t.status === 'inactive').length,
  }

  return (
    <DashboardLayout>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: 70, left: '50%', transform: 'translateX(-50%)',
          background: '#0f172a', color: '#fff', padding: '10px 22px',
          borderRadius: 12, zIndex: 9999, fontSize: 13, fontWeight: 600,
          border: '1px solid rgba(46,204,113,0.3)', whiteSpace: 'nowrap',
          animation: 'fadeSlideIn .2s',
        }}>{toast}</div>
      )}

      {/* Modal */}
      {modal && (
        <TruckModal
          truck={modal === 'add' ? null : modal}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}

      <style>{`
        @keyframes fadeSlideIn { from{opacity:0;transform:translateX(-50%) translateY(-8px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }
        @keyframes slideDown { from{opacity:0;transform:translateY(-6px)} to{opacity:1;transform:translateY(0)} }
        .truck-row { transition: box-shadow .18s, border-color .18s; cursor: pointer; }
        .truck-row:hover { box-shadow: 0 4px 18px rgba(0,0,0,.08); }
        .tm-filter-btn { transition: all .15s; cursor: pointer; }
        .tm-filter-btn:hover { opacity: .8; }
      `}</style>

      <div className="page">

        {/* ── Page Header ── */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 3 }}>
              <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 800, margin: 0 }}>
                Truck & Driver Management
              </h2>
              <span style={{
                background: 'rgba(93,173,226,0.1)', color: '#5dade2',
                border: '1px solid rgba(93,173,226,0.3)',
                fontSize: 9, fontWeight: 800, padding: '3px 10px', borderRadius: 20,
              }}>ADMIN</span>
            </div>
            <p className="text-muted text-sm">Manage fleet, assign drivers and crew members.</p>
          </div>
          <button
            className="btn btn-primary"
            onClick={() => setModal('add')}
          >
            + Add Truck
          </button>
        </div>

        {/* ── KPI Strip ── */}
        <div className="stat-grid" style={{ marginBottom: 20 }}>
          {[
            { label: 'Total Trucks', value: counts.all, color: '#ffffffff', icon: '' },
            { label: 'Active', value: counts.active, color: '#2ecc71', icon: '' },
            { label: 'Maintenance', value: counts.maintenance, color: '#f39c12', icon: '' },
            { label: 'Inactive', value: counts.inactive, color: '#e74c3c', icon: '' },
          ].map(s => (
            <div key={s.label} className="stat-card">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <div className="label">{s.label}</div>
                <span style={{ fontSize: 16 }}>{s.icon}</span>
              </div>
              <div className="value" style={{ color: s.color, fontSize: 30 }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* ── Filters + Search ── */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{
            display: 'flex', gap: 4,
            background: 'var(--surface-2)', borderRadius: 10, padding: 4,
          }}>
            {['all', 'active', 'maintenance', 'inactive'].map(f => (
              <button key={f} className="tm-filter-btn" onClick={() => setFilter(f)} style={{
                padding: '6px 14px', borderRadius: 8, border: 'none',
                fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-body)',
                background: filter === f ? 'var(--surface)' : 'transparent',
                color: filter === f ? 'var(--text)' : 'var(--text-muted)',
                boxShadow: filter === f ? '0 1px 4px rgba(0,0,0,.08)' : 'none',
              }}>
                {f.charAt(0).toUpperCase() + f.slice(1)} ({counts[f]})
              </button>
            ))}
          </div>

          <input
            className="form-input"
            placeholder="   Search plate, driver, zone…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ maxWidth: 260, marginLeft: 'auto' }}
          />
        </div>

        {/* ── Truck List ── */}
        <div>
          {filtered.length === 0 && (
            <div className="card" style={{ textAlign: 'center', padding: '36px 20px' }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>🚛</div>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>No trucks found</div>
              <div className="text-muted text-sm">Try adjusting your filter or search.</div>
            </div>
          )}

          {filtered.map(truck => {
            const isOpen = expanded === truck.id
            const sm = STATUS_META[truck.status]
            return (
              <div
                key={truck.id}
                className="truck-row"
                style={{
                  background: 'var(--surface)',
                  border: `1px solid ${isOpen ? sm.border : 'var(--border)'}`,
                  borderRadius: 14, marginBottom: 10, overflow: 'hidden',
                }}
              >
                {/* ── Row header ── */}
                <div
                  style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14 }}
                  onClick={() => setExpanded(p => p === truck.id ? null : truck.id)}
                >
                  {/* Icon */}
                  <div style={{
                    width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                    background: `${sm.bg}`,
                    border: `1px solid ${sm.border}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
                  }}>🚛</div>

                  {/* Main info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 3 }}>
                      <span style={{ fontFamily: 'var(--font-head)', fontWeight: 800, fontSize: 15 }}>{truck.plate}</span>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{truck.model}</span>
                      <StatusBadge status={truck.status} />
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                      {truck.driver ? `👤 ${truck.driver}` : '👤 No driver assigned'} &nbsp;·&nbsp; {truck.zone}
                    </div>
                    {truck.status === 'active' && <CapacityBar pct={truck.capacity} />}
                  </div>

                  {/* Crew count */}
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>Crew</div>
                    <div style={{
                      fontFamily: 'var(--font-head)', fontWeight: 800, fontSize: 20,
                      color: truck.crew.length === 0 ? '#e74c3c' : 'var(--text)',
                    }}>{truck.crew.length}</div>
                  </div>

                  {/* Chevron */}
                  <div style={{
                    fontSize: 16, color: 'var(--text-muted)',
                    transform: isOpen ? 'rotate(90deg)' : 'rotate(0)',
                    transition: 'transform .2s', flexShrink: 0,
                  }}>›</div>
                </div>

                {/* ── Expanded detail ── */}
                {isOpen && (
                  <div
                    style={{ borderTop: '1px solid var(--border)', padding: '16px', animation: 'slideDown .18s' }}
                    onClick={e => e.stopPropagation()}
                  >
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>

                      {/* Driver card */}
                      <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '12px 14px' }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '.07em', marginBottom: 8 }}>DRIVER</div>
                        {truck.driver ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{
                              width: 32, height: 32, borderRadius: '50%',
                              background: 'var(--accent)', color: '#0d1117',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontWeight: 800, fontSize: 13,
                            }}>{truck.driver[0]}</div>
                            <span style={{ fontSize: 13, fontWeight: 600 }}>{truck.driver}</span>
                          </div>
                        ) : (
                          <span style={{ fontSize: 12, color: '#e74c3c' }}>Not assigned</span>
                        )}
                      </div>

                      {/* Last service */}
                      <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '12px 14px' }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '.07em', marginBottom: 6 }}>LAST SERVICE</div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>
                          {truck.lastService || '—'}
                        </div>
                      </div>
                    </div>

                    {/* Crew list */}
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '.07em', marginBottom: 8 }}>
                        CREW MEMBERS ({truck.crew.length})
                      </div>
                      {truck.crew.length === 0 ? (
                        <div style={{ fontSize: 12, color: '#e74c3c' }}>No crew assigned to this truck.</div>
                      ) : (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {truck.crew.map(c => (
                            <span key={c} style={{
                              background: 'var(--surface)', border: '1px solid var(--border)',
                              borderRadius: 20, padding: '4px 12px', fontSize: 12, fontWeight: 500,
                              display: 'flex', alignItems: 'center', gap: 6,
                            }}>
                              <span style={{
                                width: 18, height: 18, borderRadius: '50%', background: '#5dade2',
                                color: '#fff', fontSize: 9, fontWeight: 800,
                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                              }}>{c[0]}</span>
                              {c}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Action buttons */}
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        className="btn btn-outline btn-sm"
                        style={{ flex: 1 }}
                        onClick={() => setModal(truck)}
                      >
                        ✏️ Edit / Reassign
                      </button>
                      <button
                        className="btn btn-sm"
                        style={{ background: 'rgba(231,76,60,0.08)', color: '#e74c3c', border: '1px solid rgba(231,76,60,0.3)' }}
                        onClick={() => deleteTruck(truck.id)}
                      >
                        🗑 Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

      </div>
    </DashboardLayout>
  )
}
