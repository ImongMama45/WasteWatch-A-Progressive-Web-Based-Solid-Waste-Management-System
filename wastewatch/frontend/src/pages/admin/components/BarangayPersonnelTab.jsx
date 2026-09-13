import React, { useState, useEffect } from 'react'
import api from '../../../api/client'

export default function BarangayPersonnelTab({ detail, fetchDetail }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
      <PersonnelSection
        title="Barangay Officials"
        role="brgy_official"
        people={detail.officials || []}
        barangayId={detail.id}
        onAssigned={fetchDetail}
      />
      <PersonnelSection
        title="Watchers"
        role="watcher"
        people={detail.watchers || []}
        barangayId={detail.id}
        onAssigned={fetchDetail}
      />
      <PersonnelSection
        title="Drivers"
        role="driver"
        people={detail.drivers || []}
        barangayId={detail.id}
        onAssigned={fetchDetail}
      />
    </div>
  )
}

function PersonnelSection({ title, people, role, barangayId, onAssigned }) {
  const [modalOpen, setModalOpen] = useState(false)

  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ fontSize: 13, fontWeight: 800, color: '#94A3B8', letterSpacing: '.06em', margin: 0 }}>
          {title.toUpperCase()}
        </h3>
        <button onClick={() => setModalOpen(true)} style={{
          fontSize: 12, fontWeight: 600, color: '#2563EB',
          background: '#EFF6FF', border: 'none', borderRadius: 6,
          padding: '4px 10px', cursor: 'pointer'
        }}>+ Assign</button>
      </div>

      {people.length === 0 ? (
        // Empty state — visually prominent, not just greyed text
        <div style={{
          padding: '16px', borderRadius: 10, border: '1.5px dashed #FCA5A5',
          background: '#FEF2F2', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#DC2626' }}>
            ⚠️ No {title.toLowerCase()} assigned to this barangay
          </span>
          <button onClick={() => setModalOpen(true)} style={{
            background: '#DC2626', color: '#fff', border: 'none',
            borderRadius: 8, padding: '8px 14px', fontSize: 12,
            fontWeight: 700, cursor: 'pointer'
          }}>Assign Now</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {people.map(person => (
            <div key={person.id} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '12px 16px', background: '#fff',
              border: '1px solid #E2E8F0', borderRadius: 10
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: '50%',
                background: '#E2E8F0', display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                fontSize: 14, fontWeight: 800, color: '#475569', flexShrink: 0
              }}>
                {person.full_name?.[0] || '?'}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A' }}>{person.full_name}</div>
                <div style={{ fontSize: 12, color: '#64748B' }}>{person.contact_number || person.email || '—'}</div>
              </div>
              <span style={{
                fontSize: 10, fontWeight: 800, letterSpacing: '.05em',
                padding: '3px 8px', borderRadius: 20,
                background: person.is_active ? '#F0FDF4' : '#F1F5F9',
                color: person.is_active ? '#16A34A' : '#94A3B8'
              }}>
                {person.is_active ? 'ACTIVE' : 'INACTIVE'}
              </span>
            </div>
          ))}
        </div>
      )}

      {modalOpen && (
        <AssignPersonnelModal
          role={role}
          barangayId={barangayId}
          onClose={() => setModalOpen(false)}
          onSuccess={() => { setModalOpen(false); onAssigned() }}
        />
      )}
    </div>
  )
}

function AssignPersonnelModal({ role, barangayId, onClose, onSuccess }) {
  const [users, setUsers] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    // Fetch eligible users for this role — backend should filter by role type
    api.get(`/api/accounts/barangay-management/unassigned-users/?role=${role}`)
      .then(res => setUsers(res.data))
      .catch(() => setError('Failed to load users'))
  }, [role])

  async function handleConfirm() {
    if (!selectedId || submitting) return
    setSubmitting(true)  // Lock immediately — prevents double-tap
    try {
      await api.patch(`/api/accounts/barangay-management/${barangayId}/assign-personnel/`, {
        role,
        user_id: selectedId,
      })
      onSuccess()  // triggers parent refetch — no stale data
    } catch (err) {
      setError(err.response?.data?.error || 'Assignment failed.')
      setSubmitting(false)  // Only re-enable on error
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 24, width: '100%', maxWidth: 400 }}>
        <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 800 }}>Assign {role.replace('_', ' ')}</h3>
        <p style={{ fontSize: 13, color: '#64748B', margin: '4px 0 16px' }}>
          Users currently assigned elsewhere will be moved to this barangay.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 240, overflowY: 'auto', marginBottom: 16 }}>
          {users.map(u => (
            <button key={u.id} onClick={() => setSelectedId(u.id)} style={{
              padding: '10px 14px', borderRadius: 8, textAlign: 'left',
              border: `1.5px solid ${selectedId === u.id ? '#2563EB' : '#E2E8F0'}`,
              background: selectedId === u.id ? '#EFF6FF' : '#fff',
              cursor: 'pointer', width: '100%',
            }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#0F172A' }}>{u.full_name}</div>
              {u.current_barangay ? (
                <div style={{ fontSize: 11, color: '#F59E0B', marginTop: 2, fontWeight: 600 }}>
                  ⚠️ Currently assigned to: {u.current_barangay}
                </div>
              ) : (
                <div style={{ fontSize: 11, color: '#10B981', marginTop: 2, fontWeight: 600 }}>
                  ✓ Unassigned — available
                </div>
              )}
            </button>
          ))}
          {users.length === 0 && !error && (
            <p style={{ color: '#94A3B8', fontSize: 13 }}>No unassigned {role.replace('_', ' ')}s available.</p>
          )}
        </div>

        {error && <p style={{ color: '#DC2626', fontSize: 12, marginBottom: 12 }}>{error}</p>}

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} disabled={submitting} style={{
            flex: 1, padding: 12, borderRadius: 10, border: '1px solid #E2E8F0',
            background: '#fff', color: '#64748B', fontWeight: 600, cursor: 'pointer'
          }}>Cancel</button>
          <button onClick={handleConfirm} disabled={!selectedId || submitting} style={{
            flex: 2, padding: 12, borderRadius: 10, border: 'none',
            background: selectedId && !submitting ? '#2563EB' : '#E2E8F0',
            color: selectedId && !submitting ? '#fff' : '#94A3B8',
            fontWeight: 700, cursor: selectedId && !submitting ? 'pointer' : 'not-allowed'
          }}>
            {submitting ? 'Assigning…'
              : users.find(u => u.id === selectedId)?.current_barangay
                ? '⚠️ Reassign to This Barangay'
                : 'Confirm Assignment'}
          </button>
        </div>
      </div>
    </div>
  )
}
