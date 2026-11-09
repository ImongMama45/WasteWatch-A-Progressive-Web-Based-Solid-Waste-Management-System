/**
 * CommunitySidebar.jsx
 * --------------------
 * Desktop sidebar / mobile companion section for the Community page.
 * Displays:
 * 1. Active Emergency Advisories (deep-linked via ?alert=<id>)
 * 2. Official Lucena City announcements & notices preview (deep-linked via ?article=<id>)
 * 3. Scope-aware filtering respecting the active barangay selection
 * 4. Community Guidelines & Waste Schedule shortcut
 *
 * Strict Iconography Rule: Zero emojis. Lucide SVG icons only.
 */

import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  Bell,
  AlertTriangle,
  ArrowRight,
  ShieldCheck,
  Building2,
  Calendar,
  Sparkles,
  ExternalLink,
  MapPin,
  Flame,
} from 'lucide-react'
import { useNewsItems } from '../../news/hooks/useNewsItems'
import { useEmergencyAlerts } from '../../../hooks/useEmergencyAlerts'
import { SidebarWidgetSkeleton } from '../../../components/ui/Skeleton'

export default function CommunitySidebar({ scope = 'all' }) {
  // Use official scope-aware news hook established in Phase 5.2
  const {
    items: newsItems,
    loading: itemsLoading,
    error: itemsError,
  } = useNewsItems(scope)

  // Use emergency alerts hook for separate emergency advisory presentation
  const {
    alerts,
    isRefreshing: alertsLoading,
    error: alertsError,
  } = useEmergencyAlerts()

  const activeAlert = useMemo(() => {
    return alerts && alerts.length > 0 ? alerts[0] : null
  }, [alerts])

  const previewAnnouncements = useMemo(() => {
    return (newsItems || []).slice(0, 4)
  }, [newsItems])

  const isLoading = itemsLoading && (!newsItems || newsItems.length === 0)

  return (
    <aside
      aria-label="Official announcements and community guidelines"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
      }}
    >
      {/* 1. Critical Emergency Alert Banner (if active) */}
      {activeAlert && (
        <div
          role="region"
          aria-label="Critical Emergency Advisory"
          style={{
            background: 'linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)',
            borderRadius: 14,
            padding: '16px 18px',
            border: '1.5px solid #ef4444',
            boxShadow: '0 2px 8px rgba(239, 68, 68, 0.12)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 6,
                  background: '#dc2626',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <AlertTriangle size={14} strokeWidth={2.5} />
              </div>
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 800,
                  color: '#b91c1c',
                  letterSpacing: 0.5,
                  textTransform: 'uppercase',
                }}
              >
                Emergency Advisory
              </span>
            </div>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                background: '#dc2626',
                color: '#ffffff',
                padding: '1px 6px',
                borderRadius: 4,
                letterSpacing: 0.3,
              }}
            >
              ACTIVE
            </span>
          </div>

          <h4
            style={{
              fontSize: 13.5,
              fontWeight: 800,
              color: '#991b1b',
              margin: '0 0 6px',
              lineHeight: 1.35,
            }}
          >
            {activeAlert.title}
          </h4>

          {activeAlert.description && (
            <p
              style={{
                fontSize: 12,
                color: '#7f1d1d',
                margin: '0 0 10px',
                lineHeight: 1.4,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {activeAlert.description}
            </p>
          )}

          <Link
            to={`/announcements?alert=${activeAlert.id}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 12,
              fontWeight: 700,
              color: '#b91c1c',
              textDecoration: 'none',
              padding: '5px 10px',
              borderRadius: 6,
              background: '#ffffff',
              border: '1px solid #fca5a5',
              transition: 'background 0.15s',
            }}
          >
            <span>View Directive</span>
            <ArrowRight size={12} strokeWidth={2.5} />
          </Link>
        </div>
      )}

      {/* 2. Official City Announcements Card */}
      <div
        style={{
          background: '#ffffff',
          borderRadius: 14,
          padding: '20px 20px',
          border: '1.5px solid #16a34a',
          boxShadow: '0 2px 6px rgba(22, 163, 74, 0.08)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 6,
                background: '#f0fdf4',
                color: '#16a34a',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Building2 size={16} />
            </div>
            <div>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#16a34a', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Official Notices
              </span>
              <h3 style={{ fontSize: 15, fontWeight: 800, color: '#0f172a', margin: 0 }}>
                City Announcements
              </h3>
            </div>
          </div>
          <Link
            to="/announcements"
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: '#16a34a',
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
            }}
          >
            <span>View All</span>
            <ArrowRight size={13} />
          </Link>
        </div>

        <p style={{ fontSize: 12.5, color: '#64748b', margin: '0 0 14px', lineHeight: 1.45 }}>
          Verified public communications from Lucena City CENRO and LGU administration.
        </p>

        {isLoading ? (
          <SidebarWidgetSkeleton rows={3} />
        ) : previewAnnouncements.length === 0 ? (
          <div style={{ fontSize: 12, color: '#94a3b8', padding: '10px 0', textAlign: 'center' }}>
            No active announcements for this scope.
          </div>
        ) : (
          <div className="ww-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {previewAnnouncements.map(item => (
              <Link
                key={item.id}
                to={`/announcements?article=${item.id}`}
                style={{
                  textDecoration: 'none',
                  display: 'block',
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: 8,
                  padding: '10px 12px',
                  transition: 'background 0.15s, border-color 0.15s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: '1px 6px',
                      borderRadius: 4,
                      background: item.priority === 'high' ? '#fee2e2' : '#f0fdf4',
                      color: item.priority === 'high' ? '#dc2626' : '#15803d',
                      textTransform: 'uppercase',
                    }}
                  >
                    {item.category || item.type || 'Notice'}
                  </span>
                  <span style={{ fontSize: 11, color: '#94a3b8' }}>
                    {item.barangay_name || 'City-Wide'}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: '#0f172a',
                    lineHeight: 1.35,
                    marginBottom: 2,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {item.title}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* 3. Civic Community Guidelines Card */}
      <div
        style={{
          background: '#ffffff',
          borderRadius: 14,
          padding: '20px 20px',
          border: '1px solid #e2e8f0',
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              background: '#eff6ff',
              color: '#2563eb',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ShieldCheck size={16} />
          </div>
          <h3 style={{ fontSize: 15, fontWeight: 800, color: '#0f172a', margin: 0 }}>
            Community Guidelines
          </h3>
        </div>

        <ul
          style={{
            margin: 0,
            paddingLeft: 16,
            fontSize: 12.5,
            color: '#475569',
            lineHeight: 1.6,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <li>Keep discussions centered on solid waste, cleanliness, and neighborhood programs.</li>
          <li>Be constructive and respectful toward fellow residents and sanitation personnel.</li>
          <li>Accurate locations and details help barangay teams resolve issues faster.</li>
          <li>Commercial advertising, abusive language, or harassment will be removed by city moderators.</li>
        </ul>
      </div>

      {/* 4. Waste Schedule Link Card */}
      <div
        style={{
          background: '#f8fafc',
          borderRadius: 14,
          padding: '16px 18px',
          border: '1px solid #e2e8f0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
            Looking for truck routes?
          </div>
          <div style={{ fontSize: 12, color: '#64748b' }}>
            Check collection schedules and live tracking.
          </div>
        </div>
        <Link
          to="/schedule"
          style={{
            background: '#ffffff',
            border: '1px solid #cbd5e1',
            borderRadius: 8,
            padding: '6px 12px',
            fontSize: 12,
            fontWeight: 700,
            color: '#0f172a',
            textDecoration: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          Schedule
        </Link>
      </div>
    </aside>
  )
}
