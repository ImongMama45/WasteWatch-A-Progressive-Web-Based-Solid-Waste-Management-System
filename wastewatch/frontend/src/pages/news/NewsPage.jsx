/**
 * NewsPage.jsx
 * ------------
 * WasteWatch — Lucena City Community Information Hub.
 * Redesigned editorial experience for city advisories, environmental activities,
 * collection schedule updates, emergency preparedness, and CENRO communications.
 *
 * Hierarchy:
 * 1. Page introduction ("What's happening in Lucena?")
 * 2. Important active advisories (ActiveAdvisoriesSection)
 * 3. Information categories (CategoryTabs)
 * 4. Search and discovery (NewsSearchBar)
 * 5. Storm and environmental preparedness (PreparednessSection)
 * 6. Latest updates and community stories (NewsFeed with responsive editorial cards)
 * 7. Cleanest barangay rankings (BarangaySpotlight)
 * 8. CENRO Facebook / Official Communications (CenroFacebookSection)
 *
 * Zero emojis. Material / Lucide icons only.
 */

import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Bell, MapPin, X, AlertTriangle } from 'lucide-react'
import Navbar from '../../components/Navbar'
import BottomNav from '../../components/BottomNav'
import { useAuth } from '../../context/AuthContext'
import { useOnline } from '../../hooks/useOnline'
import { useNewsItems } from '../../hooks/useNewsItems'
import { useEmergencyAlerts } from '../../hooks/useEmergencyAlerts'
import { useBarangaySpotlights } from '../../hooks/useBarangaySpotlights'
import api from '../../api/client'

import NewsHeader from './components/NewsHeader'
import FeaturedHeroCard from './components/FeaturedHeroCard'
import ActiveAdvisoriesSection from './components/ActiveAdvisoriesSection'
import BarangayScopeSelector from './components/BarangayScopeSelector'
import CategoryTabs from './components/CategoryTabs'
import NewsSearchBar from './components/NewsSearchBar'
import NewsFeed from './components/NewsFeed'
import PreparednessSection from './components/PreparednessSection'
import BarangaySpotlight from './components/BarangaySpotlight'
import CenroFacebookSection from './components/CenroFacebookSection'
import CommunityPreviewSection from './components/CommunityPreviewSection'
import CreatePostModal from './components/CreatePostModal'
import ArticleDetailModal from './components/ArticleDetailModal'
import EmergencyAlertDetailModal from './components/EmergencyAlertDetailModal'
import {
  filterNews,
  selectFeaturedAnnouncement,
  normalizeBarangayList,
  calculateFeedCountBreakdown,
} from './utils/newsUtils'
import { CATEGORY_TABS, getCategoryLabel } from './utils/newsConfig'

export default function NewsPage() {
  const isOnline = useOnline()
  const { user, barangays: authBarangays } = useAuth()
  // Admin role check matches backend permissions exactly (role === 'admin' || is_staff)
  const isAdmin = Boolean(user && (user.role === 'admin' || user.is_staff))

  const [searchParams, setSearchParams] = useSearchParams()
  const articleParam = searchParams.get('article')
  const alertParam = searchParams.get('alert')

  // Barangay scope state: 'all' (default), 'city_wide', or barangay ID string
  const [scope, setScope] = useState('all')

  // Scope-aware news items hook: manages scope key resolution, caching, and fetch cancellation
  const {
    items: newsItems,
    loading: itemsLoading,
    isRefreshing: itemsRefreshing,
    error: itemsError,
    refresh: refreshNews,
  } = useNewsItems(scope)

  const { alerts, isRefreshing: alertsLoading, refresh: refreshAlerts, isOfflineCached: alertsOfflineCached } = useEmergencyAlerts()
  const { spotlights } = useBarangaySpotlights()

  const [category, setCategory] = useState('All')
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const articleRequestIdRef = useRef(0)
  const [articleLoading, setArticleLoading] = useState(false)
  const [fetchedArticle, setFetchedArticle] = useState(null)
  const [articleNotFound, setArticleNotFound] = useState(false)
  const [fetchedAlert, setFetchedAlert] = useState(null)
  const [alertNotFound, setAlertNotFound] = useState(false)
  const [barangays, setBarangays] = useState(() => normalizeBarangayList(authBarangays))
  const [barangaysLoading, setBarangaysLoading] = useState(false)

  // Initialize and synchronize barangays from auth context or official endpoint
  // Normalizes both plain array [...] and paginated { results: [...] } shapes
  useEffect(() => {
    const fromAuth = normalizeBarangayList(authBarangays)
    if (fromAuth.length > 0) {
      setBarangays(fromAuth)
      return
    }

    try {
      const cached = localStorage.getItem('ww_barangays')
      if (cached) {
        const parsed = normalizeBarangayList(JSON.parse(cached))
        if (parsed.length > 0) {
          setBarangays(parsed)
          return
        }
      }
    } catch { }

    let active = true
    setBarangaysLoading(true)
    api.get('/api/auth/barangays/')
      .then(res => {
        if (active) {
          const list = normalizeBarangayList(res.data)
          if (list.length > 0) {
            setBarangays(list)
            try { localStorage.setItem('ww_barangays', JSON.stringify(list)) } catch { }
          }
        }
      })
      .catch(() => {
        // Fallback to legacy endpoint if auth endpoint is unavailable
        if (active) {
          api.get('/api/barangays/')
            .then(res => {
              if (active) {
                const list = normalizeBarangayList(res.data)
                if (list.length > 0) {
                  setBarangays(list)
                  try { localStorage.setItem('ww_barangays', JSON.stringify(list)) } catch { }
                }
              }
            })
            .catch(() => { /* silent offline fallback */ })
        }
      })
      .finally(() => {
        if (active) setBarangaysLoading(false)
      })

    return () => { active = false }
  }, [authBarangays])

  const openCreateModal = useCallback(async () => {
    if (barangays.length === 0) {
      try {
        const res = await api.get('/api/auth/barangays/')
        const list = normalizeBarangayList(res.data)
        if (list.length > 0) {
          setBarangays(list)
        }
      } catch {
        // Fallback
        try {
          const res = await api.get('/api/barangays/')
          const list = normalizeBarangayList(res.data)
          if (list.length > 0) setBarangays(list)
        } catch { }
      }
    }
    setModalOpen(true)
  }, [barangays.length])

  // Derived active article: found in loaded newsItems or fetched fallback
  const activeArticle = useMemo(() => {
    if (!articleParam || !/^\d+$/.test(articleParam)) return null
    const targetId = String(parseInt(articleParam, 10))
    const inList = (newsItems || []).find(i => String(i.id) === targetId)
    if (inList) return inList
    if (fetchedArticle && String(fetchedArticle.id) === targetId) return fetchedArticle
    return null
  }, [articleParam, newsItems, fetchedArticle])

  // Derived active emergency alert: found in loaded alerts or fetched fallback
  const activeAlert = useMemo(() => {
    if (!alertParam || !/^\d+$/.test(alertParam)) return null
    const targetId = String(parseInt(alertParam, 10))
    const inList = (alerts || []).find(a => String(a.id) === targetId)
    if (inList) return inList
    if (fetchedAlert && String(fetchedAlert.id) === targetId) return fetchedAlert
    return null
  }, [alertParam, alerts, fetchedAlert])

  // Normalize conflicting URL parameters: emergency alert strictly takes precedence over article
  useEffect(() => {
    if (alertParam && articleParam) {
      setSearchParams(
        prev => {
          const next = new URLSearchParams(prev)
          next.delete('article')
          return next
        },
        { replace: true }
      )
    }
  }, [alertParam, articleParam, setSearchParams])

  // Fetch article if deep linked and not already present in loaded newsItems
  useEffect(() => {
    // 1. Parameter cleared / absent: immediate full reset
    if (!articleParam) {
      articleRequestIdRef.current++
      setFetchedArticle(null)
      setArticleNotFound(false)
      setArticleLoading(false)
      return
    }

    // 2. Malformed parameter: immediate validation failure without network request
    if (!/^\d+$/.test(articleParam)) {
      articleRequestIdRef.current++
      setFetchedArticle(null)
      setArticleNotFound(true)
      setArticleLoading(false)
      return
    }

    const canonicalId = String(parseInt(articleParam, 10))

    // 3. In-memory feed hit: instant resolution
    if ((newsItems || []).some(i => String(i.id) === canonicalId)) {
      articleRequestIdRef.current++
      setFetchedArticle(null)
      setArticleNotFound(false)
      setArticleLoading(false)
      return
    }

    // 4. Remote fetch required: increment token and invalidate previous fetched record immediately
    const requestId = ++articleRequestIdRef.current
    const controller = new AbortController()

    setFetchedArticle(null)
    setArticleNotFound(false)
    setArticleLoading(true)

    api
      .get(`/api/news/items/${canonicalId}/`, { signal: controller.signal })
      .then(res => {
        // Token & Identity Guard: Verify request is still authoritative and matches requested ID
        if (
          requestId === articleRequestIdRef.current &&
          res.data &&
          String(res.data.id) === canonicalId
        ) {
          setFetchedArticle(res.data)
          setArticleNotFound(false)
          setArticleLoading(false)
        }
      })
      .catch(err => {
        // Ignore deliberate cancellations
        if (err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED') return

        if (requestId === articleRequestIdRef.current) {
          setFetchedArticle(null)
          setArticleNotFound(true)
          setArticleLoading(false)
        }
      })

    return () => {
      controller.abort()
    }
  }, [articleParam, newsItems])

  // Fetch emergency alert if deep linked via ?alert=<id> and not already present
  useEffect(() => {
    if (!alertParam) {
      setFetchedAlert(null)
      setAlertNotFound(false)
      return
    }

    // Must be positive integer string
    if (!/^\d+$/.test(alertParam)) {
      setFetchedAlert(null)
      setAlertNotFound(true)
      return
    }

    const canonicalId = String(parseInt(alertParam, 10))
    if ((alerts || []).some(a => String(a.id) === canonicalId)) {
      setAlertNotFound(false)
      return
    }

    if (fetchedAlert && String(fetchedAlert.id) === canonicalId) {
      return
    }

    let active = true
    api
      .get(`/api/news/alerts/${canonicalId}/`)
      .then(res => {
        if (active && res.data) {
          setFetchedAlert(res.data)
          setAlertNotFound(false)
        }
      })
      .catch(() => {
        if (active) {
          setFetchedAlert(null)
          setAlertNotFound(true)
        }
      })

    return () => {
      active = false
    }
  }, [alertParam, alerts, fetchedAlert])

  function handleReadMore(article) {
    if (!article?.id) return
    const isAlreadyOpen = Boolean(searchParams.get('article'))
    setArticleNotFound(false)
    setSearchParams(
      prev => {
        const next = new URLSearchParams(prev)
        next.delete('alert') // Normalize: article selected, purge conflicting alert
        next.set('article', String(article.id))
        return next
      },
      // Push entry on initial feed open (replace: false), replace entry when switching intra-modal
      { replace: isAlreadyOpen }
    )
  }

  function handleCloseArticle() {
    articleRequestIdRef.current++
    setFetchedArticle(null)
    setArticleNotFound(false)
    setArticleLoading(false)
    setSearchParams(
      prev => {
        const next = new URLSearchParams(prev)
        next.delete('article')
        return next
      },
      { replace: true }
    )
  }

  function handleSelectAlert(alert) {
    if (!alert?.id) return
    setAlertNotFound(false)
    setSearchParams(
      prev => {
        const next = new URLSearchParams(prev)
        next.delete('article') // Prioritize alert modal
        next.set('alert', alert.id)
        return next
      },
      { replace: true }
    )
  }

  function handleCloseAlert() {
    setFetchedAlert(null)
    setAlertNotFound(false)
    setSearchParams(
      prev => {
        const next = new URLSearchParams(prev)
        next.delete('alert')
        return next
      },
      { replace: true }
    )
  }

  function handlePostPublished(type) {
    if (type === 'emergency') {
      refreshAlerts?.()
    } else {
      refreshNews?.()
    }
  }

  const handleRefreshAll = useCallback(() => {
    refreshNews?.()
    refreshAlerts?.()
  }, [refreshNews, refreshAlerts])

  // Discovery filtering status
  const isFilterActive = category !== 'All' || Boolean(search.trim())
  const isAnyFilterActive = isFilterActive || scope !== 'all'

  // Primary featured announcement selected from currently scoped items
  const heroItem = useMemo(() => selectFeaturedAnnouncement(newsItems), [newsItems])
  const heroId = heroItem?.id != null ? String(heroItem.id) : null

  // Show prominent hero card only when no category or search filter is active and hero exists
  const showHero = !isFilterActive && Boolean(heroItem)

  // Deduplicated feed items:
  // When hero is displayed above (showHero = true), exclude it from the feed below.
  // When category/search filtering is active, hero card is hidden and the hero announcement
  // becomes eligible for inclusion in the filtered feed grid if it matches!
  const feedItems = useMemo(() => {
    if (!showHero || !heroId) return newsItems || []
    return (newsItems || []).filter(item => String(item?.id) !== heroId)
  }, [newsItems, showHero, heroId])

  // Category counts are based on the complete currently scoped dataset (including hero)
  const categoryCounts = useMemo(() => {
    const counts = { All: (newsItems || []).length }
    CATEGORY_TABS.forEach(tab => {
      const id = typeof tab === 'object' ? tab.id : tab
      if (id !== 'All') {
        counts[id] = filterNews(newsItems, id, '').length
      }
    })
    return counts
  }, [newsItems])

  // Filtered items count for the visible feed
  const filteredItemsCount = useMemo(() => {
    return filterNews(feedItems, category, search).length
  }, [feedItems, category, search])

  // Explicit count breakdown explaining hero inclusion vs feed count
  const countBreakdown = useMemo(() => {
    const totalScoped = categoryCounts[category] ?? 0
    return calculateFeedCountBreakdown({
      totalScopedCount: totalScoped,
      feedCount: filteredItemsCount,
      showHero,
    })
  }, [categoryCounts, category, filteredItemsCount, showHero])

  // Resolved readable name for active scope
  const activeScopeName = useMemo(() => {
    if (scope === 'all') return 'All Lucena City'
    if (scope === 'city_wide') return 'City-Wide Only'
    const found = (barangays || []).find(b => String(b.id) === String(scope))
    return found ? found.name : `Barangay ${scope}`
  }, [scope, barangays])

  // Reset all filters action
  const handleResetAllFilters = useCallback(() => {
    setCategory('All')
    setSearch('')
    setScope('all')
  }, [])

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', paddingBottom: 80 }}>
      <Navbar />

      <main
        className="page ww-page-enter"
        style={{
          maxWidth: 1140,
          margin: '0 auto',
          paddingTop: 80,
          paddingLeft: 16,
          paddingRight: 16,
        }}
      >
        {/* 1. Dedicated Public Information Masthead */}
        <NewsHeader
          isAdmin={isAdmin}
          onCreateNotice={openCreateModal}
          onRefresh={handleRefreshAll}
          isRefreshing={itemsLoading || alertsLoading}
        />

        {/* 2. Important Active Advisories (Urgent, Pinned, Emergency) */}
        <ActiveAdvisoriesSection
          alerts={alerts}
          items={newsItems}
          excludeId={showHero ? heroId : null}
          category={category}
          search={search}
          onSelectAlert={handleSelectAlert}
          onReadMore={handleReadMore}
          isOfflineCached={alertsOfflineCached}
        />

        {/* 3. Featured Hero Announcement (Only when no category/search filter is active) */}
        {showHero && (
          <FeaturedHeroCard
            key={heroId ?? 'hero-empty'}
            item={heroItem}
            onReadMore={handleReadMore}
          />
        )}

        {/* 4. Search and Scope Discovery Controls */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
            marginBottom: 16,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ flex: '1 1 280px', minWidth: 240 }}>
            <NewsSearchBar
              value={search}
              onChange={setSearch}
              resultCount={search ? filteredItemsCount : undefined}
              activeCategory={category}
              containerStyle={{ marginBottom: 0 }}
            />
          </div>
          <div style={{ flex: '0 1 230px', minWidth: 200, width: 'auto' }}>
            <BarangayScopeSelector
              value={scope}
              onChange={setScope}
              barangays={barangays}
              isLoading={barangaysLoading}
            />
          </div>
        </div>

        {/* 5. Information Categories */}
        <CategoryTabs
          active={category}
          onChange={setCategory}
          counts={categoryCounts}
        />

        {/* Active Filter Indicators Bar */}
        {isAnyFilterActive && (
          <div
            role="region"
            aria-label="Active filters"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
              marginBottom: 18,
              padding: '8px 14px',
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 12,
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: '#64748b',
                textTransform: 'uppercase',
                letterSpacing: '.05em',
              }}
            >
              Filters:
            </span>

            {scope !== 'all' && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '3px 8px',
                  borderRadius: 16,
                  background: '#dcfce7',
                  color: '#15803d',
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                <MapPin size={11} strokeWidth={2.2} />
                <span>Scope: {activeScopeName}</span>
                <button
                  type="button"
                  aria-label="Reset barangay scope to All Lucena City"
                  onClick={() => setScope('all')}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#15803d',
                    cursor: 'pointer',
                    padding: 0,
                    marginLeft: 2,
                    display: 'inline-flex',
                    alignItems: 'center',
                  }}
                >
                  <X size={12} strokeWidth={2.5} />
                </button>
              </span>
            )}

            {category !== 'All' && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '3px 8px',
                  borderRadius: 16,
                  background: '#e0f2fe',
                  color: '#0369a1',
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                <span>Category: {getCategoryLabel(category)}</span>
                <button
                  type="button"
                  aria-label="Reset category to All Notices"
                  onClick={() => setCategory('All')}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#0369a1',
                    cursor: 'pointer',
                    padding: 0,
                    marginLeft: 2,
                    display: 'inline-flex',
                    alignItems: 'center',
                  }}
                >
                  <X size={12} strokeWidth={2.5} />
                </button>
              </span>
            )}

            {Boolean(search.trim()) && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '3px 8px',
                  borderRadius: 16,
                  background: '#fef3c7',
                  color: '#b45309',
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                <span>Search: &ldquo;{search.trim()}&rdquo;</span>
                <button
                  type="button"
                  aria-label="Clear search query"
                  onClick={() => setSearch('')}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#b45309',
                    cursor: 'pointer',
                    padding: 0,
                    marginLeft: 2,
                    display: 'inline-flex',
                    alignItems: 'center',
                  }}
                >
                  <X size={12} strokeWidth={2.5} />
                </button>
              </span>
            )}

            <button
              type="button"
              onClick={handleResetAllFilters}
              style={{
                background: 'none',
                border: 'none',
                color: '#dc2626',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
                padding: '2px 6px',
                marginLeft: 'auto',
              }}
            >
              Clear All
            </button>
          </div>
        )}

        {/* Scope API Error Feedback Banner */}
        {itemsError && (
          <div
            role="alert"
            style={{
              marginBottom: 20,
              padding: '12px 16px',
              borderRadius: 12,
              background: '#fef2f2',
              border: '1px solid #fecaca',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertTriangle size={16} strokeWidth={2.2} style={{ color: '#dc2626', flexShrink: 0 }} />
              <span style={{ fontSize: 13, color: '#991b1b', fontWeight: 600 }}>
                Unable to load updates for {activeScopeName}. Showing cached data if available.
              </span>
            </div>
            <button
              type="button"
              onClick={() => refreshNews?.()}
              style={{
                background: '#ffffff',
                border: '1px solid #fca5a5',
                color: '#dc2626',
                borderRadius: 8,
                padding: '5px 12px',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Retry
            </button>
          </div>
        )}

        {/* 6. Preparedness Protocol Guide (Storm, Typhoon & Monsoon Season) */}
        <PreparednessSection onSelectCategory={setCategory} />

        {/* 7. Latest Updates and Community Stories Feed */}
        <section aria-label="Latest updates and community stories" style={{ marginBottom: 32 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 14,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Bell size={18} strokeWidth={2.2} style={{ color: '#16a34a' }} />
              <h2 style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', margin: 0 }}>
                {category === 'All' ? 'Latest Updates & Community News' : `${getCategoryLabel(category)} Updates`}
              </h2>
            </div>
            <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>
              {countBreakdown.text}
            </div>
          </div>

          <NewsFeed
            items={feedItems}
            category={category}
            search={search}
            onReadMore={handleReadMore}
            onResetFilters={handleResetAllFilters}
            scope={scope}
            scopeName={activeScopeName}
            isLoading={itemsLoading}
            isRefreshing={itemsRefreshing}
            error={itemsError}
            isOnline={isOnline}
            onRetry={refreshNews}
          />
        </section>

        {/* 8. Community Discussion Preview ("This is what your community has to say.") */}
        <CommunityPreviewSection />

        {/* 9. Cleanest Barangay Rankings and Environmental Standings */}
        <BarangaySpotlight items={spotlights} />

        {/* 10. Official Lucena City CENRO Facebook & Social Hub */}
        <CenroFacebookSection />
      </main>

      {/* Admin Post Creation Modal */}
      {modalOpen && (
        <CreatePostModal
          barangays={barangays}
          onClose={() => setModalOpen(false)}
          onPublished={handlePostPublished}
        />
      )}

      {/* Emergency Alert Detail Modal (Keyed by ?alert=<id>, prioritized over article modal) */}
      {(activeAlert || alertNotFound) && (
        <EmergencyAlertDetailModal
          alert={activeAlert}
          notFound={alertNotFound}
          onClose={handleCloseAlert}
        />
      )}

      {/* Article Detail Modal (Supports deep linking ?article=<id>, loading, and 404 state; suppressed if alert modal is open) */}
      {!activeAlert && !alertNotFound && (Boolean(articleParam) || activeArticle || articleNotFound) && (
        <ArticleDetailModal
          item={activeArticle}
          loading={articleLoading}
          notFound={articleNotFound}
          onClose={handleCloseArticle}
        />
      )}

      <BottomNav />
    </div>
  )
}
