/**
 * NewsPage.jsx
 * ------------
 * WasteWatch News & Announcements hub.
 * Features:
 *   - Search and category filtering (preventing runtime type errors)
 *   - Featured news carousel with image support
 *   - Article detail modal with deep-linking (?article=<id>)
 *   - Create post modal for admin users with file size validation
 *   - Responsive, zero emojis, Material/Lucide SVG icons only.
 */

import { useState, useMemo, useEffect, useCallback } from 'react'
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
  const isAdmin = user?.role?.toLowerCase() === 'admin'

  const [searchParams, setSearchParams] = useSearchParams()
  const articleParam = searchParams.get('article')

  const { items: newsItems, isRefreshing: itemsLoading, refresh: refreshNews } = useNewsItems()
  const { alerts, isRefreshing: alertsLoading, refresh: refreshAlerts } = useEmergencyAlerts()
  const { spotlights, isRefreshing: spotsLoading, refresh: refreshSpots } = useBarangaySpotlights()

  const [category, setCategory] = useState('All')
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedArticle, setSelectedArticle] = useState(null)
  const [barangays, setBarangays] = useState(authBarangays || [])

  // Sync barangays from auth context or fetch if empty
  useEffect(() => {
    if (authBarangays && authBarangays.length > 0) {
      setBarangays(authBarangays)
    }
  }, [authBarangays])

  const openCreateModal = useCallback(async () => {
    if (barangays.length === 0) {
      try {
        const res = await api.get('/api/barangays/')
        if (res.data && Array.isArray(res.data)) {
          setBarangays(res.data)
        }
      } catch {
        // Fallback silent
      }
    }
    setModalOpen(true)
  }, [barangays.length])

  // Handle URL deep-linking for articles: ?article=<id>
  useEffect(() => {
    if (!articleParam) {
      setSelectedArticle(null)
      return
    }

    // Check if article is already loaded in news items or alerts
    const found =
      newsItems.find(i => String(i.id) === String(articleParam)) ||
      alerts.find(i => String(i.id) === String(articleParam))

    if (found) {
      setSelectedArticle(found)
    } else {
      // Fallback fetch single item from API
      let isMounted = true
      api
        .get(`/api/news/items/${articleParam}/`)
        .then(res => {
          if (isMounted && res.data) {
            setSelectedArticle(res.data)
          }
        })
        .catch(() => {
          api
            .get(`/api/news/alerts/${articleParam}/`)
            .then(res => {
              if (isMounted && res.data) {
                setSelectedArticle(res.data)
              }
            })
            .catch(() => {
              // Not found, ignore
            })
        })

      return () => {
        isMounted = false
      }
    }
  }, [articleParam, newsItems, alerts])

  function handleReadMore(article) {
    setSelectedArticle(article)
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      if (article?.id) {
        next.set('article', article.id)
      }
      return next
    })
  }

  function handleCloseArticle() {
    setSelectedArticle(null)
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.delete('article')
      return next
    })
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
      <div className="page" style={{ maxWidth: 1200, margin: '0 auto' }}>
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
            {(itemsLoading || alertsLoading || spotsLoading) && (
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

      {/* Article Detail Modal (Deep-linkable) */}
      {selectedArticle && (
        <ArticleDetailModal
          item={selectedArticle}
          onClose={handleCloseArticle}
        />
      )}

      <BottomNav />
    </div>
  )
}
