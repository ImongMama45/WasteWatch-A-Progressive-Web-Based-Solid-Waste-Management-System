import React, { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import api from '../../api/client'
import DashboardLayout from '../../components/DashboardLayout'
import BarangayOverviewTab from './components/BarangayOverviewTab'
import BarangayPersonnelTab from './components/BarangayPersonnelTab'
import BarangayConcernsTab from './components/BarangayConcernsTab'
import BarangayEscalationsTab from './components/BarangayEscalationsTab'

export default function BarangayDetail() {
  const { barangayId } = useParams()
  const navigate = useNavigate()
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeTab, setActiveTab] = useState('overview')
  const [leafletReady, setLeafletReady] = useState(!!window.L)

  useEffect(() => {
    if (window.L) return
    const link = Object.assign(document.createElement('link'),
      { rel: 'stylesheet', href: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css' })
    document.head.appendChild(link)
    const script = Object.assign(document.createElement('script'),
      { src: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js' })
    script.onload = () => setLeafletReady(true)
    document.head.appendChild(script)
  }, [])

  useEffect(() => {
    setActiveTab('overview')
  }, [barangayId])

  const fetchDetail = useCallback(() => {
    if (!barangayId) return
    api.get(`/api/accounts/barangay-management/${barangayId}/`)
      .then(res => setDetail(res.data))
      .catch(err => {
        console.error(err)
        setError('Failed to load barangay details')
      })
      .finally(() => setLoading(false))
  }, [barangayId])

  useEffect(() => {
    setLoading(true)
    fetchDetail()
    const interval = setInterval(fetchDetail, 30000)
    return () => clearInterval(interval)
  }, [fetchDetail])

  if (loading && !detail) return <div style={{ padding: 24 }}>Loading...</div>
  if (error) return <div style={{ padding: 24, color: 'red' }}>{error}</div>
  if (!detail) return null

  return (
    <DashboardLayout>
      <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <button 
        onClick={() => navigate('/admin/barangays')} 
        style={{ background: 'none', border: 'none', color: '#64748B', cursor: 'pointer', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 4, fontWeight: 600 }}
      >
        ← Back to Barangays
      </button>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0, color: '#1a2e1a' }}>Brgy {detail.name}</h1>
      </div>

      <div style={{ display: 'flex', gap: 24, borderBottom: '1px solid #E2E8F0', marginBottom: 24 }}>
        {['overview', 'personnel', 'concerns', 'escalations'].map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              background: 'none', border: 'none', padding: '12px 0', fontSize: 14, fontWeight: 600, cursor: 'pointer',
              color: activeTab === tab ? '#2563EB' : '#64748B',
              borderBottom: activeTab === tab ? '2px solid #2563EB' : '2px solid transparent',
              textTransform: 'capitalize'
            }}
          >
            {tab === 'concerns' ? 'Concerns & Hotspots' : tab}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && leafletReady && (
        <BarangayOverviewTab detail={detail} barangayId={barangayId} />
      )}

      {activeTab === 'personnel' && (
        <BarangayPersonnelTab detail={detail} fetchDetail={fetchDetail} />
      )}

      {activeTab === 'concerns' && (
        <BarangayConcernsTab detail={detail} />
      )}

      {activeTab === 'escalations' && (
        <BarangayEscalationsTab detail={detail} />
      )}
    </div>
    </DashboardLayout>
  )
}
