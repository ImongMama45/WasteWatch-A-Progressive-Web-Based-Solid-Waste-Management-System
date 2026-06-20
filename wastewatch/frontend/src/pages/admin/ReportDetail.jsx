import React, { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import api from '../../api/client'
import DashboardLayout from '../../components/DashboardLayout'

const TYPE_META = {
  overflow: { label: 'Overflow', color: '#ef4444', bg: 'rgba(239,68,68,0.1)' },
  illegal_dumping: { label: 'Illegal Dumping', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
  missed: { label: 'Missed Pickup', color: '#5dade2', bg: 'rgba(93,173,226,0.1)' },
}

const STATUS_META = {
  pending: { label: 'Pending', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
  approved: { label: 'Approved', color: '#22c55e', bg: 'rgba(34,197,94,0.1)' },
  rejected: { label: 'Rejected', color: '#ef4444', bg: 'rgba(239,68,68,0.1)' },
  resolved: { label: 'Resolved', color: '#3b82f6', bg: 'rgba(59,130,246,0.1)' },
}

const SEVERITY_COLORS = { high: '#ef4444', medium: '#f59e0b', low: '#22c55e' }

export default function ReportDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  
  const mapContainerRef = useRef(null)
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
    async function fetchReport() {
      try {
        const res = await api.get(`/api/watcher/reports/${id}/`)
        setReport(res.data)
      } catch (err) {
        setError(err.response?.status === 404 ? 'Report not found' : 'Failed to load report')
      } finally {
        setLoading(false)
      }
    }
    fetchReport()
  }, [id])

  useEffect(() => {
    if (!leafletReady || !mapContainerRef.current || !report || !report.latitude || !report.longitude) return
    const L = window.L

    const map = L.map(mapContainerRef.current, {
      zoomControl: true,
      scrollWheelZoom: false,
      attributionControl: false,
    }).setView([report.latitude, report.longitude], 16)

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png').addTo(map)

    const markerHtml = `
      <div style="
        background: #DC2626; color: white;
        width: 30px; height: 30px; border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 4px 12px rgba(220,38,38,0.4);
        border: 2px solid white; font-size: 14px;
      ">🗑️</div>
    `
    const icon = L.divIcon({ html: markerHtml, className: '', iconSize: [30, 30], iconAnchor: [15, 15] })
    L.marker([report.latitude, report.longitude], { icon }).addTo(map)

    return () => map.remove()
  }, [leafletReady, report, id])

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>Loading report...</div>
  if (error) return <div style={{ padding: 40, textAlign: 'center', color: '#DC2626' }}>{error}</div>
  if (!report) return null

  const tm = TYPE_META[report.issue_type] || TYPE_META.overflow
  const sm = STATUS_META[report.status] || STATUS_META.pending

  return (
    <DashboardLayout>
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '24px 16px' }}>
      
      <button onClick={() => navigate(-1)} style={{
        background: 'none', border: 'none', color: '#64748B',
        fontSize: 14, fontWeight: 600, cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 6, marginBottom: 24
      }}>
        <span style={{ fontSize: 18 }}>←</span> Back
      </button>

      <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #E2E8F0', overflow: 'hidden' }}>
        <div style={{ padding: '24px 24px 20px', borderBottom: '1px solid #E2E8F0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
            <div>
              <h1 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 800, color: '#0F172A' }}>
                Report #{report.id}
              </h1>
              <div style={{ fontSize: 13, color: '#64748B' }}>
                Submitted {new Date(report.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <span style={{
                background: sm.bg, color: sm.color,
                padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase'
              }}>{sm.label}</span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#F8FAFC', padding: '6px 12px', borderRadius: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8' }}>TYPE</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: tm.color }}>{tm.label}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#F8FAFC', padding: '6px 12px', borderRadius: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8' }}>SEVERITY</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: SEVERITY_COLORS[report.severity] || '#64748B' }}>
                {(report.severity || 'unknown').toUpperCase()}
              </span>
            </div>
          </div>
        </div>

        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 24 }}>
          
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#94A3B8', letterSpacing: '.06em', marginBottom: 8 }}>DESCRIPTION</div>
            <div style={{ fontSize: 14, color: '#0F172A', lineHeight: 1.6, background: '#F8FAFC', padding: 16, borderRadius: 8 }}>
              {report.description || <span style={{ color: '#94A3B8', fontStyle: 'italic' }}>No description provided.</span>}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 24 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#94A3B8', letterSpacing: '.06em', marginBottom: 4 }}>REPORTER</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#0F172A' }}>{report.user_name || 'Unknown'}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#94A3B8', letterSpacing: '.06em', marginBottom: 4 }}>BARANGAY</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#0F172A' }}>{report.barangay_name || 'Unknown'}</div>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#94A3B8', letterSpacing: '.06em', marginBottom: 4 }}>ADDRESS</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#0F172A' }}>{report.address || 'No address provided'}</div>
            </div>
          </div>

          {/* Photo Evidence */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#94A3B8', letterSpacing: '.06em', marginBottom: 12 }}>PHOTO EVIDENCE</div>
            {report.image ? (
              <img src={report.image} alt="Report Evidence" style={{ width: '100%', borderRadius: 12, border: '1px solid #E2E8F0' }} />
            ) : (
              <div style={{ padding: 32, background: '#F8FAFC', borderRadius: 12, border: '1px dashed #CBD5E1', textAlign: 'center', color: '#64748B' }}>
                <div style={{ fontSize: 24, marginBottom: 8 }}>📷</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>No photo submitted</div>
              </div>
            )}
          </div>

          {/* Map */}
          {report.latitude && report.longitude && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#94A3B8', letterSpacing: '.06em', marginBottom: 12 }}>LOCATION MAP</div>
              <div ref={mapContainerRef} style={{ height: 250, width: '100%', borderRadius: 12, border: '1px solid #E2E8F0', zIndex: 1 }} />
            </div>
          )}

        </div>
      </div>
    </div>
    </DashboardLayout>
  )
}
