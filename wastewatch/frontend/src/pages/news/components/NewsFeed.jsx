/**
 * NewsFeed.jsx
 * -------------
 * Responsive editorial grid of NewsCard items.
 * Uses shared filterNews and sortNews utils.
 * Zero emojis.
 */

import { FileSearch, WifiOff, AlertCircle } from 'lucide-react'
import NewsCard from './NewsCard'
import './NewsCard.css'
import {
  filterNews,
  sortNews,
  getCategoryLabel,
  resolveFeedDisplayState,
} from '../utils/newsUtils'

export default function NewsFeed({
  items = [],
  category = 'All',
  search = '',
  onReadMore,
  onResetFilters,
  scope = 'all',
  scopeName = '',
  isLoading = false,
  isRefreshing = false,
  error = null,
  isOnline = true,
  onRetry,
}) {
  const filtered = filterNews(items, category, search)
  const sorted = sortNews(filtered)

  const displayState = resolveFeedDisplayState({
    items,
    filteredCount: sorted.length,
    isLoading,
    error,
    isOnline,
  })

  // 1. Initial Loading Skeleton State (prevents showing "No notices found" on initial mount)
  if (displayState === 'INITIAL_LOADING') {
    return (
      <div
        role="status"
        aria-label="Loading Lucena City notices"
        className="ww-news-grid"
      >
        {[1, 2, 3, 4, 5, 6].map(n => (
          <div
            key={`skeleton-${n}`}
            className="nc-editorial-card"
            style={{ cursor: 'default' }}
          >
            {/* Standardized 160px Media Skeleton Block matching live cards */}
            <div className="nc-skeleton-media nc-skeleton-pulse" />

            {/* Skeleton Body Content */}
            <div className="nc-body-content">
              {/* Badges strip skeleton */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 12,
                }}
              >
                <div
                  className="nc-skeleton-pulse"
                  style={{
                    height: 18,
                    width: '32%',
                    background: '#f1f5f9',
                    borderRadius: 20,
                  }}
                />
                <div
                  className="nc-skeleton-pulse"
                  style={{
                    height: 16,
                    width: '18%',
                    background: '#f1f5f9',
                    borderRadius: 20,
                  }}
                />
              </div>

              {/* Title 2-line skeleton */}
              <div
                className="nc-skeleton-pulse"
                style={{
                  height: 18,
                  width: '85%',
                  background: '#f1f5f9',
                  borderRadius: 6,
                  marginBottom: 8,
                }}
              />
              <div
                className="nc-skeleton-pulse"
                style={{
                  height: 18,
                  width: '60%',
                  background: '#f1f5f9',
                  borderRadius: 6,
                  marginBottom: 12,
                }}
              />

              {/* Description 3-line skeleton */}
              <div
                className="nc-skeleton-pulse"
                style={{
                  height: 12,
                  width: '95%',
                  background: '#f8fafc',
                  borderRadius: 4,
                  marginBottom: 6,
                }}
              />
              <div
                className="nc-skeleton-pulse"
                style={{
                  height: 12,
                  width: '90%',
                  background: '#f8fafc',
                  borderRadius: 4,
                  marginBottom: 6,
                }}
              />
              <div
                className="nc-skeleton-pulse"
                style={{
                  height: 12,
                  width: '70%',
                  background: '#f8fafc',
                  borderRadius: 4,
                  marginBottom: 16,
                }}
              />

              {/* Footer Meta Row Skeleton */}
              <div
                style={{
                  marginTop: 'auto',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingTop: 12,
                  borderTop: '1px solid #f1f5f9',
                }}
              >
                <div style={{ display: 'flex', gap: 8, width: '55%' }}>
                  <div
                    className="nc-skeleton-pulse"
                    style={{ height: 12, width: '45%', background: '#f1f5f9', borderRadius: 4 }}
                  />
                  <div
                    className="nc-skeleton-pulse"
                    style={{ height: 12, width: '45%', background: '#f1f5f9', borderRadius: 4 }}
                  />
                </div>
                <div
                  className="nc-skeleton-pulse"
                  style={{ height: 14, width: '25%', background: '#f1f5f9', borderRadius: 4 }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  // 2. Offline with no cached data
  if (displayState === 'OFFLINE') {
    return (
      <div
        role="status"
        style={{
          padding: '48px 24px',
          textAlign: 'center',
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: 14,
          boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            background: '#f1f5f9',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 14px',
            color: '#64748b',
          }}
        >
          <WifiOff size={24} strokeWidth={1.8} />
        </div>
        <h4 style={{ fontWeight: 700, fontSize: 16, color: '#0f172a', margin: '0 0 6px 0' }}>
          You are currently offline
        </h4>
        <p style={{ fontSize: 13, color: '#64748b', margin: 0, maxWidth: 420, marginInline: 'auto' }}>
          No cached notices are available for {scope !== 'all' ? scopeName || scope : 'this section'}. Reconnect to the internet to load current municipal notices.
        </p>
      </div>
    )
  }

  // 3. Error state with no cached data
  if (displayState === 'ERROR') {
    return (
      <div
        role="alert"
        style={{
          padding: '48px 24px',
          textAlign: 'center',
          background: '#ffffff',
          border: '1px solid #fecaca',
          borderRadius: 14,
          boxShadow: '0 1px 3px rgba(220,38,38,0.04)',
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            background: '#fee2e2',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 14px',
            color: '#dc2626',
          }}
        >
          <AlertCircle size={24} strokeWidth={1.8} />
        </div>
        <h4 style={{ fontWeight: 700, fontSize: 16, color: '#991b1b', margin: '0 0 6px 0' }}>
          Unable to load notices
        </h4>
        <p style={{ fontSize: 13, color: '#7f1d1d', margin: 0, maxWidth: 420, marginInline: 'auto', marginBottom: onRetry ? 16 : 0 }}>
          An error occurred while loading public notices for {scope !== 'all' ? scopeName || scope : 'Lucena City'}. Please check your connection and retry.
        </p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 18px',
              borderRadius: 9,
              background: '#dc2626',
              color: '#ffffff',
              border: 'none',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        )}
      </div>
    )
  }

  // 4. Empty Result State (Successful fetch returned 0 matching notices)
  if (displayState === 'EMPTY') {
    const isFiltered = category !== 'All' || Boolean(search.trim()) || scope !== 'all'

    return (
      <div
        style={{
          padding: '48px 24px',
          textAlign: 'center',
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: 14,
          boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            background: '#f1f5f9',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 14px',
            color: '#64748b',
          }}
        >
          <FileSearch size={24} strokeWidth={1.8} />
        </div>
        <h4 style={{ fontWeight: 700, fontSize: 16, color: '#0f172a', margin: '0 0 6px 0' }}>
          No notices found
        </h4>
        <p style={{ fontSize: 13, color: '#64748b', margin: 0, maxWidth: 420, marginInline: 'auto', lineHeight: 1.5 }}>
          {search
            ? `We couldn't find any notices matching "${search}" in "${getCategoryLabel(category)}"${scope !== 'all' ? ` for ${scopeName || scope}` : ''}. Try checking your spelling or clearing filters.`
            : category !== 'All'
            ? `There are currently no active ${getCategoryLabel(category)} updates published${scope !== 'all' ? ` for ${scopeName || scope}` : ' for Lucena City'}.`
            : scope !== 'all'
            ? `There are currently no notices published for ${scopeName || scope}. Check back later or view All Lucena City notices.`
            : `There are currently no active updates published for this section.`}
        </p>

        {isFiltered && onResetFilters && (
          <div style={{ marginTop: 18 }}>
            <button
              type="button"
              onClick={onResetFilters}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 18px',
                borderRadius: 9,
                background: '#16a34a',
                color: '#ffffff',
                border: 'none',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'background .15s ease',
                boxShadow: '0 1px 3px rgba(22,163,74,0.2)',
              }}
            >
              Reset All Filters
            </button>
          </div>
        )}
      </div>
    )
  }

  // 5. Data Ready State (including background refreshing where existing cards remain displayed)
  return (
    <div
      className="ww-news-grid"
      style={{
        opacity: isRefreshing ? 0.85 : 1,
        transition: 'opacity .15s ease',
      }}
    >
      {sorted.map((item, i) => (
        <NewsCard
          key={item.id}
          item={item}
          animDelay={i * 30}
          onReadMore={onReadMore}
        />
      ))}
    </div>
  )
}
