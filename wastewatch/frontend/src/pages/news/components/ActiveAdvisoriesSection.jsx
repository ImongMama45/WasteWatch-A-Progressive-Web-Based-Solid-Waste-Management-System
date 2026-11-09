/**
 * ActiveAdvisoriesSection.jsx
 * ----------------------------
 * Prominent, structured municipal advisory section.
 * Visually distinguishes standalone EmergencyAlert directives from urgent NewsItem notices.
 * Features genuine accessible buttons, collapsible disclosure (>2 items), offline provenance indicator,
 * and zero emojis.
 */

import { useState, useMemo } from 'react'
import { ShieldAlert, AlertCircle, Pin, ArrowRight, Calendar, MapPin, ChevronDown, ChevronUp, WifiOff } from 'lucide-react'
import {
  filterNews,
  normalizeEmergencyAlert,
  normalizeUrgentNewsItem,
  resolveAdvisoryUrgencyTheme,
} from '../utils/newsUtils'
import './ActiveAdvisoriesSection.css'

export default function ActiveAdvisoriesSection({
  alerts = [],
  items = [],
  onSelectAlert,
  onReadMore,
  excludeId = null,
  category = 'All',
  search = '',
  isOfflineCached = false,
}) {
  const [expanded, setExpanded] = useState(false)

  // 1. Normalize and combine advisories with deterministic urgency ordering
  const allAdvisories = useMemo(() => {
    // Tier 1: Standalone Critical EmergencyAlert Directives
    const normalizedAlerts = (alerts || [])
      .map(normalizeEmergencyAlert)
      .filter(Boolean)
      .map((norm, idx) => ({ ...norm, rawAlert: alerts[idx] }))

    // Tier 2: Scoped Urgent NewsItems (filtered by active category/search context)
    const filteredNews = filterNews(items, category, search)
    const urgentItems = (filteredNews || []).filter(
      i => {
        if (excludeId != null && String(i?.id) === String(excludeId)) return false
        const cat = typeof i?.category === 'string' ? i.category.trim().toLowerCase() : ''
        const isEmergencyCat =
          cat === 'emergency' ||
          cat === 'emergencies' ||
          i?.category === 'Emergency' ||
          i?.category === 'Emergencies'
        return i?.type === 'emergency' || isEmergencyCat || i?.priority === 'high' || Boolean(i?.is_pinned)
      }
    )

    const normalizedNews = urgentItems
      .map(normalizeUrgentNewsItem)
      .filter(Boolean)

    // Combined with strict civic urgency ordering:
    // 1. EmergencyAlert directives & Emergency NewsItems
    // 2. High Priority NewsItems
    // 3. Pinned Notices
    // 4. Date descending
    const combined = [...normalizedAlerts, ...normalizedNews].sort((a, b) => {
      const rank = item => {
        if (item.source === 'alert') return 4
        if (item.urgencyLevel === 'emergency') return 3
        if (item.urgencyLevel === 'high_priority') return 2
        if (item.urgencyLevel === 'pinned') return 1
        return 0
      }
      const rankDiff = rank(b) - rank(a)
      if (rankDiff !== 0) return rankDiff

      const dateA = a.date ? new Date(a.date).getTime() : 0
      const dateB = b.date ? new Date(b.date).getTime() : 0
      return dateB - dateA
    })

    return combined
  }, [alerts, items, excludeId, category, search])

  if (allAdvisories.length === 0) return null

  const hasMore = allAdvisories.length > 2
  const visibleAdvisories = expanded || !hasMore ? allAdvisories : allAdvisories.slice(0, 2)

  return (
    <section aria-label="Important active advisories and emergency directives" className="aas-section">
      {/* Header bar with count and optional offline cache indicator */}
      <div className="aas-header-bar">
        <div className="aas-title-wrap">
          <h3 className="aas-section-heading">
            <ShieldAlert size={16} strokeWidth={2.5} />
            <span>Active Advisories ({allAdvisories.length})</span>
          </h3>
        </div>

        {isOfflineCached && (
          <span className="aas-offline-tag" title="Showing cached advisories saved locally on your device">
            <WifiOff size={11} strokeWidth={2.2} />
            <span>Offline Cached Data</span>
          </span>
        )}
      </div>

      {/* Advisory Cards List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {visibleAdvisories.map((advisory) => {
          const theme = resolveAdvisoryUrgencyTheme(advisory)
          const isEmergency = theme.urgencyLevel === 'emergency'
          const isHigh = theme.urgencyLevel === 'high_priority'
          const AdvisoryIcon = isEmergency ? ShieldAlert : isHigh ? AlertCircle : Pin

          const formattedDate = (() => {
            try {
              if (!advisory.date) return ''
              return new Date(advisory.date).toLocaleDateString('en-PH', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })
            } catch {
              return advisory.date || ''
            }
          })()

          function handleAction() {
            if (advisory.source === 'alert') {
              onSelectAlert?.(advisory.rawAlert || advisory)
            } else {
              onReadMore?.(advisory.rawItem || advisory)
            }
          }

          return (
            <div
              key={`${advisory.source}-${advisory.id}`}
              className="aas-card"
              style={{
                background: theme.bg,
                border: `1px solid ${theme.border}`,
                borderLeft: `4px solid ${theme.leftBorderColor}`,
              }}
            >
              {/* Thematic Icon Box */}
              <div
                className="aas-icon-box"
                style={{
                  background: theme.badgeBg,
                  color: theme.badgeColor,
                }}
              >
                <AdvisoryIcon size={18} strokeWidth={2.2} />
              </div>

              {/* Advisory Content Column */}
              <div className="aas-content-col">
                <div className="aas-badge-strip">
                  <span
                    className="aas-badge-pill"
                    style={{
                      background: theme.badgeBg,
                      color: theme.badgeColor,
                    }}
                  >
                    {theme.badgeLabel}
                  </span>

                  {advisory.barangayName && advisory.source === 'news' && (
                    <span className="aas-meta-text">
                      <MapPin size={11} strokeWidth={2} />
                      {advisory.barangayName}
                    </span>
                  )}

                  {formattedDate && (
                    <span className="aas-meta-text">
                      <Calendar size={11} strokeWidth={2} />
                      {formattedDate}
                    </span>
                  )}
                </div>

                <h4
                  className="aas-card-title"
                  style={{ color: theme.titleColor }}
                >
                  {advisory.title}
                </h4>

                <p className="aas-card-body">
                  {advisory.body}
                </p>
              </div>

              {/* Genuine Accessible Detail Action Button */}
              <button
                type="button"
                className="aas-action-btn"
                onClick={handleAction}
                aria-label={`${theme.actionLabel}: ${advisory.title}`}
                style={{
                  background: theme.leftBorderColor,
                  color: '#ffffff',
                }}
              >
                <span>{theme.actionLabel}</span>
                <ArrowRight size={13} strokeWidth={2.5} />
              </button>
            </div>
          )
        })}
      </div>

      {/* Expand / Collapse Disclosure Control when > 2 advisories exist */}
      {hasMore && (
        <button
          type="button"
          className="aas-disclosure-btn"
          onClick={() => setExpanded(prev => !prev)}
          aria-expanded={expanded}
        >
          <span>{expanded ? 'Show Fewer Advisories' : `View All Active Advisories (${allAdvisories.length})`}</span>
          {expanded ? <ChevronUp size={14} strokeWidth={2.5} /> : <ChevronDown size={14} strokeWidth={2.5} />}
        </button>
      )}
    </section>
  )
}
