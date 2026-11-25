/**
 * CommunitySidebar.jsx
 * --------------------
 * Reddit-inspired desktop sidebar / mobile companion section for the Community page.
 *
 * Sections:
 * 1. About This Community (purpose, CENRO affiliation)
 * 2. Active Emergency Advisories (if present, deep-linked via ?alert=<id>)
 * 3. Official City Announcements (deep-linked via ?article=<id>)
 * 4. Community Guidelines
 * 5. Collection Schedule access
 *
 * Strict Iconography Rule: Zero emojis. Lucide SVG icons only.
 */

import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  Calendar,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { useNewsItems } from '../../news/hooks/useNewsItems'
import { useEmergencyAlerts } from '../../../hooks/useEmergencyAlerts'
import { SidebarWidgetSkeleton } from '../../../components/ui/Skeleton'

export default function CommunitySidebar({ scope = 'all' }) {
  const {
    items: newsItems,
    loading: itemsLoading,
  } = useNewsItems(scope)

  const {
    alerts,
  } = useEmergencyAlerts()

  const activeAlert = useMemo(() => {
    return alerts && alerts.length > 0 ? alerts[0] : null
  }, [alerts])

  const previewAnnouncements = useMemo(() => {
    return (newsItems || []).slice(0, 3)
  }, [newsItems])

  const isLoading = itemsLoading && (!newsItems || newsItems.length === 0)

  return (
    <aside
      aria-label="Community information, announcements, and guidelines"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      {/* 1. About Community Widget */}
      <div
        style={{
          background: '#ffffff',
          borderRadius: 8,
          border: '1px solid #e2e8f0',
          padding: '14px 16px',
          boxShadow: '0 1px 2px rgba(15, 23, 42, 0.02)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <Users size={15} style={{ color: '#16a34a' }} />
          <h3 style={{ fontSize: 13.5, fontWeight: 700, color: '#0f172a', margin: 0 }}>
            About WasteWatch Community
          </h3>
        </div>

        <p style={{ fontSize: 12.5, color: '#475569', lineHeight: 1.5, margin: '0 0 10px 0' }}>
          The official civic discussion and neighborhood waste reporting forum for Lucena City.
          Citizens, barangay officials, and city coordinators collaborate here to maintain clean neighborhoods.
        </p>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 11.5,
            color: '#64748b',
            borderTop: '1px solid #f1f5f9',
            paddingTop: 8,
          }}
        >
          <Building2 size={12} style={{ color: '#16a34a' }} />
          <span>Lucena City CENRO Affiliated</span>
        </div>
      </div>

      {/* 2. Critical Emergency Alert Banner (Restrained Red for Urgency) */}
      {activeAlert && (
        <div
          role="region"
          aria-label="Critical Emergency Advisory"
          style={{
            background: '#fef2f2',
            borderRadius: 8,
            padding: '12px 14px',
            border: '1px solid #fca5a5',
            borderLeft: '3px solid #dc2626',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <AlertTriangle size={13} style={{ color: '#dc2626' }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: '#991b1b', textTransform: 'uppercase', letterSpacing: 0.3 }}>
                Emergency Directive
              </span>
            </div>
            <span style={{ fontSize: 9.5, fontWeight: 700, background: '#dc2626', color: '#ffffff', padding: '1px 4px', borderRadius: 2 }}>
              ACTIVE
            </span>
          </div>

          <h4 style={{ fontSize: 13, fontWeight: 700, color: '#991b1b', margin: '0 0 4px', lineHeight: 1.35 }}>
            {activeAlert.title}
          </h4>

          {activeAlert.description && (
            <p
              style={{
                fontSize: 11.5,
                color: '#7f1d1d',
                margin: '0 0 8px',
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
              gap: 4,
              fontSize: 11.5,
              fontWeight: 700,
              color: '#b91c1c',
              textDecoration: 'none',
            }}
          >
            <span>View Directive</span>
            <ArrowRight size={11} strokeWidth={2.5} />
          </Link>
        </div>
      )}

      {/* 3. Official City Announcements Widget */}
      <div
        style={{
          background: '#ffffff',
          borderRadius: 8,
          border: '1px solid #e2e8f0',
          padding: '14px 16px',
          boxShadow: '0 1px 2px rgba(15, 23, 42, 0.02)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <h3 style={{ fontSize: 13.5, fontWeight: 700, color: '#0f172a', margin: 0 }}>
            Official Announcements
          </h3>
          <Link
            to="/announcements"
            style={{
              fontSize: 11.5,
              fontWeight: 600,
              color: '#16a34a',
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 2,
            }}
          >
            <span>View all</span>
            <ArrowRight size={11} />
          </Link>
        </div>

        {isLoading ? (
          <SidebarWidgetSkeleton rows={2} />
        ) : previewAnnouncements.length === 0 ? (
          <div style={{ fontSize: 12, color: '#94a3b8', padding: '6px 0' }}>
            No recent announcements.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {previewAnnouncements.map(item => (
              <Link
                key={item.id}
                to={`/announcements?article=${item.id}`}
                style={{
                  textDecoration: 'none',
                  display: 'block',
                  padding: '6px 0',
                  borderBottom: '1px solid #f1f5f9',
                }}
              >
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 2 }}>
                  <span>{item.category || item.type || 'Notice'}</span>
                  {item.barangay_name && <span> · {item.barangay_name}</span>}
                </div>
                <div
                  style={{
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: '#0f172a',
                    lineHeight: 1.35,
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

      {/* 4. Community Guidelines */}
      <div
        style={{
          background: '#ffffff',
          borderRadius: 8,
          border: '1px solid #e2e8f0',
          padding: '14px 16px',
          boxShadow: '0 1px 2px rgba(15, 23, 42, 0.02)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <ShieldCheck size={14} style={{ color: '#64748b' }} />
          <h3 style={{ fontSize: 13.5, fontWeight: 700, color: '#0f172a', margin: 0 }}>
            Community Guidelines
          </h3>
        </div>

        <ol
          style={{
            margin: 0,
            paddingLeft: 16,
            fontSize: 12,
            color: '#475569',
            lineHeight: 1.5,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          <li>Keep discussions centered on solid waste, cleanliness, and neighborhood programs.</li>
          <li>Be constructive and respectful toward fellow residents and sanitation staff.</li>
          <li>Provide accurate locations and details for reported waste concerns.</li>
          <li>Commercial spam, abusive language, or harassment will be removed.</li>
        </ol>
      </div>

      {/* 5. Waste Collection Schedule Shortcut */}
      <div
        style={{
          background: '#f8fafc',
          borderRadius: 8,
          border: '1px solid #e2e8f0',
          padding: '10px 14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Calendar size={13} style={{ color: '#16a34a' }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: '#0f172a' }}>
            Truck Collection Routes
          </span>
        </div>
        <Link
          to="/schedule"
          style={{
            fontSize: 11.5,
            fontWeight: 700,
            color: '#16a34a',
            textDecoration: 'none',
          }}
        >
          View Schedule →
        </Link>
      </div>
    </aside>
  )
}
