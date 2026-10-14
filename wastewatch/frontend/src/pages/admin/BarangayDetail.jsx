import React, { useState, useEffect, useCallback } from 'react'
import { X } from 'lucide-react'
import api from '../../api/client'
import BarangayOverviewTab from './components/BarangayOverviewTab'
import BarangayPersonnelTab from './components/BarangayPersonnelTab'
import BarangayConcernsTab from './components/BarangayConcernsTab'
import BarangayEscalationsTab from './components/BarangayEscalationsTab'

export default function BarangayDetailModal({ barangayId, onClose }) {
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

  if (loading && !detail) return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#fff', padding: 24, borderRadius: 16 }}>Loading...</div>
    </div>
  )
  if (error) return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ background: '#fff', padding: 24, borderRadius: 16, color: 'red' }}>{error}</div>
    </div>
  )
  if (!detail) return null

  return (
    <div style={{ 
      position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.6)', 
      backdropFilter: 'blur(4px)', zIndex: 1000, 
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 
    }} onClick={onClose}>
      
      <div style={{ 
        background: '#F8FAFC', width: '100%', maxWidth: 1000, height: '90vh', 
        borderRadius: 24, boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)', 
        display: 'flex', flexDirection: 'column', overflow: 'hidden'
      }} onClick={e => e.stopPropagation()}>
        
        {/* Sticky Header */}
        <div style={{ padding: '24px 32px', background: '#fff', borderBottom: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0, color: '#0F172A', letterSpacing: '-0.02em' }}>
              Brgy {detail.name}
            </h1>
          </div>
          <button 
            onClick={onClose} 
            style={{ background: '#F1F5F9', border: 'none', borderRadius: '50%', width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#64748B', transition: 'background 0.2s' }}
            onMouseEnter={e => e.currentTarget.style.background = '#E2E8F0'}
            onMouseLeave={e => e.currentTarget.style.background = '#F1F5F9'}
          >
            <X size={20} />
          </button>
        </div>

        {/* Scrollable Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 32 }}>
          
          {/* Tabs */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          {['overview', 'personnel', 'concerns', 'escalations'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                background: activeTab === tab ? '#0F172A' : '#fff', 
                border: '1px solid', borderColor: activeTab === tab ? '#0F172A' : '#E2E8F0',
                padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                color: activeTab === tab ? '#fff' : '#64748B',
                borderRadius: 20, textTransform: 'capitalize', transition: 'all 0.2s'
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
      </div>
    </div>
  )
}
