/**
 * NewsPage.jsx
 * ------------
 * WasteWatch News & Announcements hub.
 * Features:
 *   - Search and category filtering (preventing runtime type errors)
 *   - Featured news carousel with image support
 *   - Article detail modal with deep-linking (?article=<id>) and 404 not-found handling
 *   - History replacement ({ replace: true }) to prevent Back button traps
 *   - Create post modal for admin users with file size validation
 *   - Responsive, zero emojis, Material/Lucide SVG icons only.
 */

import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Bell, PlusCircle } from 'lucide-react'
import Navbar from '../../components/Navbar'
import BottomNav from '../../components/BottomNav'
import { useAuth } from '../../context/AuthContext'
import { useNewsItems } from '../../hooks/useNewsItems'
import { useEmergencyAlerts } from '../../hooks/useEmergencyAlerts'
import { useBarangaySpotlights } from '../../hooks/useBarangaySpotlights'
import api from '../../api/client'

import EmergencyAlertBanner from './components/EmergencyAlertBanner'
import FeaturedNewsCarousel from './components/FeaturedNewsCarousel'
import CategoryTabs from './components/CategoryTabs'
import NewsSearchBar from './components/NewsSearchBar'
import NewsFeed from './components/NewsFeed'
import BarangaySpotlight from './components/BarangaySpotlight'
import CreatePostModal from './components/CreatePostModal'
import ArticleDetailModal from './components/ArticleDetailModal'
import { filterNews } from './utils/newsUtils'

export default function NewsPage() {
  const { user, barangays: authBarangays } = useAuth()
  // Admin role check matches backend permissions exactly (role === 'admin' || is_staff)
  const isAdmin = Boolean(user && (user.role === 'admin' || user.is_staff))

  const [searchParams, setSearchParams] = useSearchParams()
  const articleParam = searchParams.get('article')

  const { items: newsItems, isRefreshing: itemsLoading, refresh: refreshNews } = useNewsItems()
  const { alerts, isRefreshing: alertsLoading, refresh: refreshAlerts } = useEmergencyAlerts()
  const { spotlights } = useBarangaySpotlights()

  const [category, setCategory] = useState('All')
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [fetchedArticle, setFetchedArticle] = useState(null)
  const [articleNotFound, setArticleNotFound] = useState(false)
  const [barangays, setBarangays] = useState(authBarangays || [])

  // Sync barangays from auth context or fetch lightweight auth endpoint
  useEffect(() => {
    if (authBarangays && authBarangays.length > 0) {
      setBarangays(authBarangays)
    }
  }, [authBarangays])

  const openCreateModal = useCallback(async () => {
    if (barangays.length === 0) {
      try {
        const res = await api.get('/api/auth/barangays/')
        if (res.data && Array.isArray(res.data)) {
          setBarangays(res.data)
        }
      } catch {
        // Fallback silent
      }
    }
    setModalOpen(true)
  }, [barangays.length])

  // Derived active article: found in loaded newsItems or fetched fallback
  const activeArticle = useMemo(() => {
    if (!articleParam) return null
    const targetId = String(articleParam)
    const inList = (newsItems || []).find(i => String(i.id) === targetId)
    if (inList) return inList
    if (fetchedArticle && String(fetchedArticle.id) === targetId) return fetchedArticle
    return null
  }, [articleParam, newsItems, fetchedArticle])

  // Fetch article if deep linked and not already present
  useEffect(() => {
    if (!articleParam) {
      setFetchedArticle(null)
      setArticleNotFound(false)
      return
    }

    const targetId = String(articleParam)
    if ((newsItems || []).some(i => String(i.id) === targetId)) {
      setArticleNotFound(false)
      return
    }

    if (fetchedArticle && String(fetchedArticle.id) === targetId) {
      return
    }

    let active = true
    api
      .get(`/api/news/items/${targetId}/`)
      .then(res => {
        if (active && res.data) {
          setFetchedArticle(res.data)
          setArticleNotFound(false)
        }
      })
      .catch(() => {
        if (active) {
          setFetchedArticle(null)
          setArticleNotFound(true)
        }
      })

    return () => {
      active = false
    }
  }, [articleParam, newsItems, fetchedArticle])

  function handleReadMore(article) {
    if (!article?.id) return
    setArticleNotFound(false)
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.set('article', article.id)
      return next
    }, { replace: true })
  }

  function handleCloseArticle() {
    setFetchedArticle(null)
    setArticleNotFound(false)
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.delete('article')
      return next
    }, { replace: true })
  }

  function handlePostPublished(type) {
    if (type === 'emergency') {
      refreshAlerts?.()
    } else {
      refreshNews?.()
    }
  }

  const filteredCount = useMemo(() => {
    return filterNews(newsItems, category, search).length
  }, [newsItems, category, search])

  const featuredItems = useMemo(() => {
    return (newsItems || []).filter(i => i.is_featured)
  }, [newsItems])

  return (
    <div>
      <Navbar />
      <div className="page" style={{ maxWidth: 1200, margin: '0 auto', paddingTop: 24 }}>
        {/* Header */}
        <div style={{ marginBottom: 18 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 12,
              marginBottom: 4,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Bell size={22} strokeWidth={2} style={{ color: 'var(--accent)', flexShrink: 0 }} />
              <h2 className="section-title" style={{ margin: 0, fontSize: 20 }}>
                News &amp; Announcements
              </h2>
            </div>
            {isAdmin && (
              <button
                type="button"
                onClick={openCreateModal}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 14px',
                  borderRadius: 'var(--radius)',
                  background: 'var(--accent)',
                  color: '#0d1117',
                  border: 'none',
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: 'pointer',
                  fontFamily: 'var(--font-body)',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                  transition: 'opacity .15s',
                }}
              >
                <PlusCircle size={15} strokeWidth={2.5} />
                Create Post
              </button>
            )}
          </div>
          <p className="text-muted text-sm" style={{ margin: 0, paddingLeft: 30 }}>
            Stay updated with waste management activities and city advisories for Lucena City.
            {(itemsLoading || alertsLoading) && (
              <span style={{ marginLeft: 8, color: 'var(--accent)' }}>Updating...</span>
            )}
          </p>
        </div>

        {/* Emergency Alerts */}
        <EmergencyAlertBanner alerts={alerts} />

        {/* Featured Carousel */}
        <FeaturedNewsCarousel items={featuredItems} onReadMore={handleReadMore} />

        {/* Search */}
        <NewsSearchBar
          value={search}
          onChange={setSearch}
          resultCount={search ? filteredCount : undefined}
        />

        {/* Category Tabs */}
        <CategoryTabs active={category} onChange={setCategory} />

        {/* News Feed */}
        <NewsFeed
          items={newsItems}
          category={category}
          search={search}
          onReadMore={handleReadMore}
        />

        {/* Barangay Spotlight */}
        <div style={{ marginTop: 24 }}>
          <BarangaySpotlight items={spotlights} />
        </div>
      </div>

      {/* Create Post Modal */}
      {modalOpen && (
        <CreatePostModal
          barangays={barangays}
          onClose={() => setModalOpen(false)}
          onPublished={handlePostPublished}
        />
      )}

      {/* Article Detail Modal (Deep-linkable or 404 state) */}
      {(activeArticle || articleNotFound) && (
        <ArticleDetailModal
          item={activeArticle}
          notFound={articleNotFound}
          onClose={handleCloseArticle}
        />
      )}

      <BottomNav />
    </div>
  )
}
