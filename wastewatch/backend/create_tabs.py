import os

components_dir = r"d:\Coding\Waste Watch\wastewatch\frontend\src\pages\admin\components"
os.makedirs(components_dir, exist_ok=True)

# 1. BarangayOverviewTab.jsx
overview_content = """import React, { useEffect, useRef } from 'react'
import L from 'leaflet'

export default function BarangayOverviewTab({ detail }) {
  const mapRef = useRef(null)
  const mapInstance = useRef(null)

  useEffect(() => {
    if (!mapRef.current || !detail) return

    // Clean up previous instance
    if (mapInstance.current) {
      mapInstance.current.remove()
      mapInstance.current = null
    }

    // Determine center
    let center = [13.93, 121.61] // Default Lucena City
    if (detail.boundary_geojson && detail.boundary_geojson.coordinates) {
      // Very basic centroid estimation from first ring
      const coords = detail.boundary_geojson.coordinates[0]
      if (coords && coords.length > 0) {
        center = [coords[0][1], coords[0][0]] // GeoJSON is [lng, lat], Leaflet is [lat, lng]
      }
    } else if (detail.latitude && detail.longitude) {
      center = [detail.latitude, detail.longitude]
    }

    // Initialize map
    const map = L.map(mapRef.current, {
      center: center,
      zoom: 15,
      zoomControl: false
    })
    mapInstance.current = map

    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map)

    L.control.zoom({ position: 'bottomright' }).addTo(map)

    // Layer 1: Boundary Polygon
    if (detail.boundary_geojson) {
      L.geoJSON(detail.boundary_geojson, {
        style: {
          color: '#2563EB',
          weight: 2,
          fillColor: '#3B82F6',
          fillOpacity: 0.1
        }
      }).addTo(map)
    } else if (detail.latitude && detail.longitude) {
      // Fallback Marker
      const icon = L.divIcon({
        className: 'custom-div-icon',
        html: `<div style="background:#2563EB; width:16px; height:16px; border-radius:50%; border:3px solid white; box-shadow:0 2px 5px rgba(0,0,0,0.3);"></div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11]
      })
      L.marker([detail.latitude, detail.longitude], { icon }).addTo(map)
        .bindTooltip("Boundary not yet mapped", { permanent: true, direction: 'top', offset: [0, -10] })
    }

    // Layer 2: Hotspot Pins
    if (detail.hotspots && detail.hotspots.length > 0) {
      detail.hotspots.forEach(h => {
        const severityColors = { high: '#DC2626', medium: '#D97706', low: '#10B981' }
        const color = severityColors[h.severity?.toLowerCase()] || '#64748B'
        
        const hIcon = L.divIcon({
          className: 'hotspot-icon',
          html: `<div style="background:${color}; width:12px; height:12px; border-radius:50%; border:2px solid white; box-shadow:0 2px 4px rgba(0,0,0,0.3);"></div>`,
          iconSize: [16, 16],
          iconAnchor: [8, 8]
        })
        
        const lat = h.latitude || h.lat
        const lng = h.longitude || h.lng
        if (lat && lng) {
          L.marker([lat, lng], { icon: hIcon }).addTo(map)
            .bindPopup(`<b>${h.name || 'Hotspot'}</b><br/>Severity: ${h.severity}`)
        }
      })
    }

    return () => {
      if (mapInstance.current) {
        mapInstance.current.remove()
        mapInstance.current = null
      }
    }
  }, [detail.id]) // key to detail.id (barangayId)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div 
        ref={mapRef} 
        style={{ 
          height: 360, width: '100%', borderRadius: 16, 
          background: '#E2E8F0', border: '1px solid rgba(0,0,0,0.06)',
          overflow: 'hidden', zIndex: 1
        }} 
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
        <StatCard title="Total Personnel" value={detail.officials?.length + detail.watchers?.length + detail.drivers?.length} icon="👥" color="#3B82F6" bg="#EFF6FF" />
        <StatCard title="Pending Concerns" value={detail.pending_concerns?.length || 0} icon="⚠️" color="#D97706" bg="#FFFBEB" />
        <StatCard title="Active Hotspots" value={detail.hotspots?.length || 0} icon="📍" color="#DC2626" bg="#FEF2F2" />
        <StatCard title="Open Escalations" value={detail.escalations?.length || 0} icon="🚨" color="#EF4444" bg="#FEF2F2" />
      </div>
    </div>
  )
}

function StatCard({ title, value, icon, color, bg }) {
  return (
    <div style={{ 
      background: '#fff', borderRadius: 12, padding: 20, 
      display: 'flex', alignItems: 'center', gap: 16,
      border: '1px solid rgba(0,0,0,0.06)'
    }}>
      <div style={{ width: 48, height: 48, borderRadius: 12, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{title}</div>
        <div style={{ fontSize: 24, fontWeight: 800, color: '#0F172A', marginTop: 2 }}>{value}</div>
      </div>
    </div>
  )
}
"""

with open(os.path.join(components_dir, 'BarangayOverviewTab.jsx'), 'w', encoding='utf-8') as f:
    f.write(overview_content)

# 2. BarangayPersonnelTab.jsx
personnel_content = """import React, { useState, useEffect } from 'react'
import api from '../../api/client'

export default function BarangayPersonnelTab({ detail, fetchDetail }) {
  const [assigningRole, setAssigningRole] = useState(null)
  const [unassignedUsers, setUnassignedUsers] = useState([])
  const [loadingUsers, setLoadingUsers] = useState(false)
  
  // Modal state
  const [selectedUser, setSelectedUser] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const openAssignModal = (role) => {
    setAssigningRole(role)
    setLoadingUsers(true)
    api.get(`/api/accounts/barangay-management/unassigned-users/?role=${role}`)
      .then(res => setUnassignedUsers(res.data))
      .catch(console.error)
      .finally(() => setLoadingUsers(false))
  }

  const closeAssignModal = () => {
    setAssigningRole(null)
    setSelectedUser('')
    setUnassignedUsers([])
  }

  const handleAssign = () => {
    if (!selectedUser || isSubmitting) return
    setIsSubmitting(true)
    api.patch(`/api/accounts/barangay-management/${detail.id}/assign-personnel/`, {
      user_id: selectedUser,
      role: assigningRole
    })
      .then(() => {
        fetchDetail()
        closeAssignModal()
      })
      .catch(console.error)
      .finally(() => setIsSubmitting(false))
  }

  const roleNames = {
    brgy_official: 'Barangay Official',
    watcher: 'Watcher',
    driver: 'Driver'
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
      
      <PersonnelSection 
        title="Barangay Officials" 
        role="brgy_official" 
        users={detail.officials} 
        onAssign={() => openAssignModal('brgy_official')} 
      />
      
      <PersonnelSection 
        title="Watchers" 
        role="watcher" 
        users={detail.watchers} 
        onAssign={() => openAssignModal('watcher')} 
      />
      
      <PersonnelSection 
        title="Drivers" 
        role="driver" 
        users={detail.drivers} 
        onAssign={() => openAssignModal('driver')} 
      />

      {assigningRole && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', padding: 32, borderRadius: 16, width: '100%', maxWidth: 400, boxShadow: '0 20px 40px rgba(0,0,0,0.2)' }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: 18, color: '#0F172A' }}>Assign {roleNames[assigningRole]}</h3>
            <p style={{ fontSize: 13, color: '#64748B', marginBottom: 20 }}>
              Select a citizen to promote to this role and assign them to Brgy {detail.name}. Note: Users already assigned to other roles are not listed here.
            </p>

            {loadingUsers ? (
              <div style={{ padding: 20, textAlign: 'center', color: '#64748B' }}>Loading eligible users...</div>
            ) : (
              <select 
                value={selectedUser}
                onChange={e => setSelectedUser(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #E2E8F0', marginBottom: 24, fontSize: 14 }}
              >
                <option value="">Select a user...</option>
                {unassignedUsers.map(u => (
                  <option key={u.id} value={u.id}>{u.full_name} ({u.email})</option>
                ))}
              </select>
            )}

            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button 
                onClick={closeAssignModal}
                style={{ padding: '8px 16px', background: '#F1F5F9', border: 'none', borderRadius: 8, color: '#475569', fontWeight: 600, cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button 
                onClick={handleAssign}
                disabled={!selectedUser || isSubmitting}
                style={{ 
                  padding: '8px 16px', background: '#2563EB', border: 'none', borderRadius: 8, color: '#fff', fontWeight: 600, 
                  cursor: (!selectedUser || isSubmitting) ? 'not-allowed' : 'pointer', opacity: (!selectedUser || isSubmitting) ? 0.6 : 1
                }}
              >
                {isSubmitting ? 'Assigning...' : 'Assign User'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function PersonnelSection({ title, role, users, onAssign }) {
  const isMissing = !users || users.length === 0

  return (
    <div style={{ background: '#fff', borderRadius: 16, border: '1px solid rgba(0,0,0,0.06)', overflow: 'hidden' }}>
      <div style={{ padding: '16px 24px', background: '#F8FAFC', borderBottom: '1px solid rgba(0,0,0,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: 16, color: '#0F172A', fontWeight: 700 }}>{title}</h3>
        <button 
          onClick={onAssign}
          style={{ 
            background: isMissing ? '#FEF2F2' : '#EFF6FF', 
            color: isMissing ? '#DC2626' : '#2563EB', 
            border: isMissing ? '1px solid #FCA5A5' : '1px solid transparent',
            padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer'
          }}
        >
          + Assign Now
        </button>
      </div>

      <div style={{ padding: 24 }}>
        {isMissing ? (
          <div style={{ 
            display: 'flex', alignItems: 'center', gap: 12, background: '#FEF2F2', padding: 16, borderRadius: 12, border: '1px dashed #FCA5A5' 
          }}>
            <div style={{ fontSize: 24 }}>⚠️</div>
            <div>
              <div style={{ fontWeight: 700, color: '#991B1B', fontSize: 14 }}>No {title.toLowerCase()} assigned</div>
              <div style={{ color: '#B91C1C', fontSize: 13 }}>This barangay lacks required personnel. Operations may be impacted.</div>
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
            {users.map(u => (
              <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: 16, borderRadius: 12, border: '1px solid #E2E8F0' }}>
                <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#CBD5E1', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 18 }}>
                  {u.full_name?.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div style={{ fontWeight: 700, color: '#0F172A', fontSize: 14 }}>{u.full_name}</div>
                  <div style={{ color: '#64748B', fontSize: 12 }}>{u.email}</div>
                  <div style={{ marginTop: 6, display: 'inline-block', padding: '2px 8px', background: u.is_active ? '#DCFCE7' : '#F1F5F9', color: u.is_active ? '#16A34A' : '#64748B', fontSize: 10, fontWeight: 800, borderRadius: 10 }}>
                    {u.is_active ? 'ACTIVE' : 'INACTIVE'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
"""

with open(os.path.join(components_dir, 'BarangayPersonnelTab.jsx'), 'w', encoding='utf-8') as f:
    f.write(personnel_content)

print("Tabs created.")
