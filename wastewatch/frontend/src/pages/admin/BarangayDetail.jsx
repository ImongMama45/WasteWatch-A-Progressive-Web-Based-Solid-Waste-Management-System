import React, { useState, useEffect, useCallback } from 'react'
import { X } from 'lucide-react'
import api from '../../api/client'
import BarangayOverviewTab from './components/BarangayOverviewTab'
import BarangayPersonnelTab from './components/BarangayPersonnelTab'
import BarangayConcernsTab from './components/BarangayConcernsTab'
import BarangayEscalationsTab from './components/BarangayEscalationsTab'
import { DetailModalSkeleton } from '../../components/ui/Skeleton'

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
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.45)',
      zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
    }} onClick={onClose}>
      <div
        className="ww-scale-in"
        style={{
          background: '#ffffff', width: '100%', maxWidth: 1000, maxHeight: '88vh',
          borderRadius: 12, border: '1px solid #e4e6eb',
          boxShadow: '0 8px 30px rgba(0,0,0,0.15)',
          overflow: 'hidden'
        }}
        onClick={e => e.stopPropagation()}
      >
        <DetailModalSkeleton />
      </div>
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
      position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.45)', 
      zIndex: 1000, 
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 
    }} onClick={onClose}>
      
      <div className="ww-scale-in" style={{ 
        background: '#f0f2f5', width: '100%', maxWidth: 1000, height: '88vh', 
        borderRadius: 8, border: '1px solid #e4e6eb',
        boxShadow: '0 8px 30px rgba(0,0,0,0.15)', 
        display: 'flex', flexDirection: 'column', overflow: 'hidden'
      }} onClick={e => e.stopPropagation()}>
        
        {/* Sticky Header */}
        <div style={{ padding: '16px 24px', background: '#ffffff', borderBottom: '1px solid #e4e6eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: '#050505', letterSpacing: '-0.02em' }}>
              Brgy. {detail.name}
            </h1>
            <span style={{ fontSize: 12, color: '#65676b' }}>
              Operations Profile &amp; Incident Records
            </span>
          </div>
          <button 
            type="button"
            onClick={onClose} 
            style={{
              background: '#ffffff',
              border: '1px solid #ccd0d5',
              borderRadius: 6,
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: '#65676b',
              transition: 'all 0.15s ease'
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Scrollable Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          
          {/* Tabs */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 18, background: '#ffffff', padding: 6, borderRadius: 6, border: '1px solid #e4e6eb' }}>
          {['overview', 'personnel', 'concerns', 'escalations'].map(tab => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              style={{
                background: activeTab === tab ? '#e7f3ed' : 'transparent', 
                border: activeTab === tab ? '1px solid #bbf7d0' : '1px solid transparent',
                padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                color: activeTab === tab ? '#166534' : '#65676b',
                borderRadius: 6, textTransform: 'capitalize', transition: 'all 0.15s ease'
              }}
            >
              {tab === 'concerns' ? 'Concerns & Hotspots' : tab}
            </button>
          ))}
        </div>

        {activeTab === 'overview' && (
          <BarangayOverviewTab detail={detail} barangayId={barangayId} leafletReady={leafletReady} />
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
