/**
 * DriverCollectionLog.jsx — Driver Weekly Collection Records & History
 * ---------------------------------------------------------------------
 * Displays verified stop collections, category breakdowns, and weekly stats.
 *
 * Supports dual display modes:
 *  1. Standalone full page (via /driver/log)
 *  2. Overlay modal / drawer (via isOverlay=true or onClose prop)
 *
 * Interconnected with RouteOverview and DriverStatusPanel.
 * Strictly SVG iconography (NO emojis) in compliance with project rules.
 */

import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  FileText,
  Calendar,
  Clock,
  MapPin,
  CheckCircle2,
  Check,
  Search,
  Filter,
  Truck,
  ChevronLeft,
  X,
  Layers,
  ArrowRight,
  TrendingUp,
  Tag,
  Activity,
  Maximize2
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import api from '../../api/client'
import useShiftTimer from '../../hooks/useShiftTimer'
import DriverSuiteHeader from './components/DriverSuiteHeader'
import DriverStatusPanel from './DriverStatusPanel'
import DriverHotspotAlert from './DriverHotspotAlert'
import { FeedCardSkeleton, SidebarWidgetSkeleton } from '../../components/ui/Skeleton'

// ─── CATEGORY CONFIG ──────────────────────────────────────────────────────────

const CATEGORY_CONFIG = {
  'Biodegradable': { color: '#15803d', bg: '#e7f5eb', border: '#bbf7d0' },
  'Recyclable': { color: '#1d4ed8', bg: '#dbeafe', border: '#bfdbfe' },
  'Mixed Waste': { color: '#b45309', bg: '#fef3c7', border: '#fde68a' },
  'Hazardous': { color: '#b91c1c', bg: '#fee2e2', border: '#fecaca' },
}

function CategoryBadge({ category }) {
  const cfg = CATEGORY_CONFIG[category] || {
    color: '#65676b',
    bg: '#f0f2f5',
    border: '#e4e6eb',
  }

  return (
    <span style={{
      background: cfg.bg,
      color: cfg.color,
      border: `1px solid ${cfg.border}`,
      borderRadius: 4,
      padding: '2px 6px',
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: '0.02em',
      textTransform: 'uppercase',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 3,
    }}>
      <Tag size={9} /> {category || 'Collection'}
    </span>
  )
}

// ─── STOP RECORD ITEM ─────────────────────────────────────────────────────────

function CollectionRecordItem({ entry, isLast }) {
  return (
    <div style={{ position: 'relative', display: 'flex', gap: 12 }}>
      {/* Timeline connector */}
      {!isLast && (
        <div style={{
          position: 'absolute',
          left: 13,
          top: 28,
          bottom: -8,
          width: 2,
          background: '#e4e6eb',
        }} />
      )}

      {/* Check circle */}
      <div style={{
        width: 28,
        height: 28,
        borderRadius: '50%',
        flexShrink: 0,
        background: '#e7f5eb',
        border: '1px solid #bbf7d0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#15803d',
        zIndex: 1,
      }}>
        <Check size={14} strokeWidth={2.5} />
      </div>

      {/* Record details */}
      <div style={{
        flex: 1,
        minWidth: 0,
        background: '#ffffff',
        border: '1px solid #e4e6eb',
        borderRadius: 6,
        padding: '10px 12px',
        marginBottom: 8,
        boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600, fontSize: 13, color: '#1c1e21' }}>
            {entry.address || entry.label || 'Collection stop'}
          </span>
          {entry.collectedAt && (
            <span style={{
              fontSize: 11,
              fontWeight: 500,
              color: '#65676b',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}>
              <Clock size={11} /> {entry.collectedAt}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <CategoryBadge category={entry.category} />

          {entry.barangay && (
            <span style={{
              fontSize: 11,
              color: '#65676b',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
            }}>
              <MapPin size={11} /> {entry.barangay}
            </span>
          )}

          {entry.note && (
            <span style={{
              fontSize: 11,
              color: '#65676b',
              background: '#f0f2f5',
              border: '1px solid #e4e6eb',
              borderRadius: 4,
              padding: '1px 6px',
            }}>
              {entry.note}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export default function DriverCollectionLog({ isOverlay = false, open = true, onClose }) {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [history, setHistory] = useState([])
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('All')
  const [statusOverlayOpen, setStatusOverlayOpen] = useState(false)
  const [hotspotsOverlayOpen, setHotspotsOverlayOpen] = useState(false)

  const { shiftActive } = useShiftTimer()

  useEffect(() => {
    Promise.all([
      api.get('/api/driver/stops/history/week/').catch(() => ({ data: [] })),
      api.get('/api/driver/shift/profile/').catch(() => ({ data: null })),
    ]).then(([histRes, profRes]) => {
      if (histRes.data) setHistory(histRes.data)
      if (profRes.data) setProfile(profRes.data)
    }).finally(() => setLoading(false))
  }, [])

  // Filtered entries
  const filteredHistory = useMemo(() => {
    return history.filter(item => {
      const matchesSearch = !searchQuery.trim() ||
        (item.address && item.address.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (item.barangay && item.barangay.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (item.note && item.note.toLowerCase().includes(searchQuery.toLowerCase()))

      const matchesCat = selectedCategory === 'All' || item.category === selectedCategory
      return matchesSearch && matchesCat
    })
  }, [history, searchQuery, selectedCategory])

  // Group by date
  const grouped = useMemo(() => {
    return filteredHistory.reduce((acc, stop) => {
      if (!stop.date) return acc
      if (!acc[stop.date]) acc[stop.date] = []
      acc[stop.date].push(stop)
      return acc
    }, {})
  }, [filteredHistory])

  const sortedDates = useMemo(() => {
    return Object.keys(grouped).sort((a, b) => new Date(b) - new Date(a))
  }, [grouped])

  // Summary stats
  const stats = useMemo(() => {
    const totalStops = history.length
    const activeDays = new Set(history.map(h => h.date)).size

    const catCounts = {}
    history.forEach(h => {
      if (h.category) catCounts[h.category] = (catCounts[h.category] || 0) + 1
    })

    let topCategory = '—'
    let maxCount = 0
    Object.entries(catCounts).forEach(([cat, cnt]) => {
      if (cnt > maxCount) {
        maxCount = cnt
        topCategory = cat
      }
    })

    return { totalStops, activeDays, topCategory, catCounts }
  }, [history])

  if (isOverlay && !open) return null

  const content = (
    <div>
      <style>{`
        @keyframes dclSlideIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .dcl-item { animation: dclSlideIn 0.2s ease-out; }
      `}</style>

      {/* ── UNIFIED DRIVER SUITE HEADER (When standalone page) ── */}
      {!isOverlay && (
        <DriverSuiteHeader
          activeTab="logs"
          title="Weekly Collection Log"
          subtitle="Your verified waste collection stops over the last 7 days"
          truck={profile?.truck || profile?.plateNumber}
          barangay={profile?.barangay}
          shiftActive={shiftActive}
          opStatus={shiftActive ? 'on_shift' : 'off_shift'}
          onOpenOverlay={(modalKey) => {
            if (modalKey === 'status') setStatusOverlayOpen(true)
            else if (modalKey === 'hotspots') setHotspotsOverlayOpen(true)
            else if (modalKey === 'route') navigate('/driver/route')
          }}
          rightContent={
            <div style={{
              background: '#ffffff',
              border: '1px solid #e4e6eb',
              borderRadius: 8,
              padding: '6px 14px',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
            }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#65676b', textTransform: 'uppercase' }}>
                  Weekly Total
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#15803d' }}>
                  {loading ? '—' : stats.totalStops} <span style={{ fontSize: 12, color: '#65676b', fontWeight: 500 }}>stops</span>
                </div>
              </div>
            </div>
          }
        />
      )}

      {/* ── OVERLAY HEADER (When in modal mode) ── */}
      {isOverlay && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
          paddingBottom: 12,
          borderBottom: '1px solid #e4e6eb',
        }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#1c1e21' }}>
              Weekly Collection Records
            </h2>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: '#65676b' }}>
              {profile?.truck ? `${profile.truck} · ` : ''}Completed collection audit trail
            </p>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              style={{
                background: '#f0f2f5',
                border: '1px solid #e4e6eb',
                borderRadius: 6,
                padding: 6,
                color: '#65676b',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <X size={16} />
            </button>
          )}
        </div>
      )}

      {/* ── RESPONSIVE 2-COLUMN LAYOUT (DESKTOP) / STACKED (MOBILE) ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
        gap: 16,
        alignItems: 'start',
      }}>
        {/* ── LEFT COLUMN: SEARCH, FILTERS & DAILY TIMELINE ── */}
        <div style={{ flex: '1 1 600px' }}>
          {/* SEARCH & CATEGORY FILTER BAR */}
          <div style={{
            background: '#ffffff',
            border: '1px solid #e4e6eb',
            borderRadius: 8,
            padding: '14px 16px',
            marginBottom: 14,
            boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
          }}>
            {/* Search */}
            <div style={{ position: 'relative', marginBottom: 10 }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#65676b' }} />
              <input
                type="text"
                placeholder="Search completed stop addresses or barangay…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  height: 36,
                  padding: '0 12px 0 32px',
                  borderRadius: 6,
                  border: '1px solid #ced0d4',
                  background: '#ffffff',
                  color: '#1c1e21',
                  fontSize: 13,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Category Pills */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', marginRight: 4 }}>
                Filter:
              </span>
              {['All', 'Biodegradable', 'Recyclable', 'Mixed Waste', 'Hazardous'].map(cat => {
                const isActive = selectedCategory === cat
                return (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                      background: isActive ? '#e7f5eb' : '#ffffff',
                      color: isActive ? '#15803d' : '#1c1e21',
                      border: `1px solid ${isActive ? '#bbf7d0' : '#ced0d4'}`,
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {cat}
                  </button>
                )
              })}
            </div>
          </div>

          {/* TIMELINE LOGS GROUPED BY DATE */}
          {loading ? (
            <FeedCardSkeleton count={4} compact />
          ) : sortedDates.length === 0 ? (
            <div style={{
              background: '#ffffff',
              border: '1px solid #e4e6eb',
              borderRadius: 8,
              textAlign: 'center',
              padding: '40px 20px',
            }}>
              <div style={{
                width: 44, height: 44, borderRadius: '50%',
                background: '#f0f2f5',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 10px', color: '#65676b',
              }}>
                <FileText size={20} />
              </div>
              <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 3px', color: '#1c1e21' }}>
                No Collections Found
              </h3>
              <p style={{ fontSize: 12, color: '#65676b', maxWidth: 300, margin: '0 auto' }}>
                {searchQuery || selectedCategory !== 'All'
                  ? 'No stops matched your search or category filter.'
                  : 'No completed collections recorded in the last 7 days.'}
              </p>
            </div>
          ) : (
            <div className="ww-stagger">
              {sortedDates.map(date => {
                const [y, m, d] = date.split('-')
                const dayName = new Date(y, m - 1, d).toLocaleDateString('en-US', {
                  weekday: 'long', month: 'short', day: 'numeric',
                })
                const dayStops = grouped[date]

                return (
                  <div
                    key={date}
                    className="dcl-item"
                    style={{
                      background: '#ffffff',
                      border: '1px solid #e4e6eb',
                      borderRadius: 8,
                      padding: '16px 18px',
                      marginBottom: 12,
                      boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                    }}
                  >
                    {/* Date Header */}
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: 12,
                      paddingBottom: 8,
                      borderBottom: '1px solid #f0f2f5',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Calendar size={15} style={{ color: '#15803d' }} />
                        <h2 style={{ fontSize: 13, fontWeight: 700, margin: 0, color: '#1c1e21' }}>
                          {dayName.toUpperCase()}
                        </h2>
                      </div>
                      <span style={{
                        background: '#e7f5eb',
                        color: '#15803d',
                        border: '1px solid #bbf7d0',
                        borderRadius: 4,
                        padding: '1px 6px',
                        fontSize: 11,
                        fontWeight: 600,
                      }}>
                        {dayStops.length} {dayStops.length === 1 ? 'stop' : 'stops'}
                      </span>
                    </div>

                    {/* Stops in this day */}
                    <div>
                      {dayStops.map((entry, idx) => (
                        <CollectionRecordItem
                          key={entry.id || `${date}-${idx}`}
                          entry={entry}
                          isLast={idx === dayStops.length - 1}
                        />
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* ── RIGHT COLUMN: WEEKLY ANALYTICS SUMMARY ── */}
        <div style={{ flex: '1 1 320px' }}>
          {/* KPI Metrics Card */}
          {loading ? (
            <div style={{
              background: '#ffffff',
              border: '1px solid #e4e6eb',
              borderRadius: 8,
              padding: '18px 20px',
              marginBottom: 16,
              boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
            }}>
              <SidebarWidgetSkeleton rows={4} showHeader />
            </div>
          ) : (
          <div className="ww-fade-in" style={{
            background: '#ffffff',
            border: '1px solid #e4e6eb',
            borderRadius: 8,
            padding: '18px 20px',
            marginBottom: 16,
            boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
          }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: '#1c1e21', textTransform: 'uppercase', letterSpacing: '0.04em', margin: '0 0 14px' }}>
              Weekly Performance
            </h3>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 16 }}>
              <div style={{
                background: '#f8fafc',
                border: '1px solid #e4e6eb',
                borderRadius: 6,
                padding: '12px',
                textAlign: 'center',
              }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#15803d' }}>{stats.totalStops}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#65676b', textTransform: 'uppercase', marginTop: 2 }}>
                  Completed
                </div>
              </div>

              <div style={{
                background: '#f8fafc',
                border: '1px solid #e4e6eb',
                borderRadius: 6,
                padding: '12px',
                textAlign: 'center',
              }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#1d4ed8' }}>{stats.activeDays}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#65676b', textTransform: 'uppercase', marginTop: 2 }}>
                  Active Days
                </div>
              </div>
            </div>

            {/* Waste Category Breakdown */}
            <div style={{ borderTop: '1px solid #f0f2f5', paddingTop: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', marginBottom: 10 }}>
                Category Distribution
              </div>

              {Object.keys(CATEGORY_CONFIG).map(cat => {
                const count = stats.catCounts?.[cat] || 0
                const pct = stats.totalStops > 0 ? Math.round((count / stats.totalStops) * 100) : 0
                const cfg = CATEGORY_CONFIG[cat]

                return (
                  <div key={cat} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                      <span style={{ color: '#1c1e21' }}>{cat}</span>
                      <span style={{ color: cfg.color }}>{count} ({pct}%)</span>
                    </div>
                    <div style={{ background: '#f0f2f5', height: 6, borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: cfg.color, borderRadius: 3 }} />
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Quick Link to Map */}
            <button
              onClick={() => navigate('/driver/route')}
              style={{
                width: '100%',
                height: 36,
                borderRadius: 6,
                background: '#16a34a',
                border: 'none',
                color: '#ffffff',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                marginTop: 16,
                boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                transition: 'background 0.15s ease',
              }}
              onMouseOver={e => e.currentTarget.style.background = '#15803d'}
              onMouseOut={e => e.currentTarget.style.background = '#16a34a'}
            >
              <MapPin size={14} /> View Active Route Map <ArrowRight size={13} />
            </button>
          </div>
          )}
        </div>
      </div>

      {/* ── MODAL OVERLAY: DRIVER STATUS PANEL ── */}
      {statusOverlayOpen && (
        <DriverStatusPanel
          isOverlay={true}
          open={true}
          onClose={() => setStatusOverlayOpen(false)}
        />
      )}

      {/* ── MODAL OVERLAY: HOTSPOT ALERTS ── */}
      {hotspotsOverlayOpen && (
        <DriverHotspotAlert
          isOverlay={true}
          open={true}
          onClose={() => setHotspotsOverlayOpen(false)}
        />
      )}
    </div>
  )

  // Overlay container vs standalone page
  if (isOverlay) {
    return (
      <div style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1100,
        background: 'rgba(0, 0, 0, 0.6)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px 16px',
      }}>
        <div style={{
          background: '#ffffff',
          borderRadius: 8,
          border: '1px solid #e4e6eb',
          maxWidth: 900,
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
          padding: 24,
          boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
        }}>
          {content}
        </div>
      </div>
    )
  }

  return (
    <div style={{ background: '#f0f2f5', minHeight: '100vh', padding: '20px 24px 80px' }}>
      <div style={{ maxWidth: 1240, margin: '0 auto' }}>
        {content}
      </div>
    </div>
  )
}
