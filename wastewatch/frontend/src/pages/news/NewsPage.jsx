/**
 * NewsPage.jsx — Main News & Announcements page
 * -----------------------------------------------
 * Route: /announcements (PrivateRoute)
 * Wrapped in DashboardLayout.
 * Renders all sub-sections.
 */

import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, PlusCircle } from 'lucide-react'
import DashboardLayout from '../../components/DashboardLayout'
import { useAuth } from '../../context/AuthContext'
import { useNewsItems } from '../../hooks/useNewsItems'
import { useEmergencyAlerts } from '../../hooks/useEmergencyAlerts'
import { useBarangaySpotlights } from '../../hooks/useBarangaySpotlights'

import EmergencyAlertBanner from './components/EmergencyAlertBanner'
import FeaturedNewsCarousel from './components/FeaturedNewsCarousel'
import CategoryTabs from './components/CategoryTabs'
import NewsSearchBar from './components/NewsSearchBar'
import NewsFeed from './components/NewsFeed'
import BarangaySpotlight from './components/BarangaySpotlight'

export default function NewsPage() {
  const { user } = useAuth()
  const navigate  = useNavigate()
  const isAdmin   = user?.role?.toLowerCase() === 'admin'

  const { items: newsItems, isRefreshing: itemsLoading } = useNewsItems()
  const { alerts, isRefreshing: alertsLoading } = useEmergencyAlerts()
  const { spotlights, isRefreshing: spotsLoading } = useBarangaySpotlights()

  const [category, setCategory] = useState('All')
  const [search, setSearch]     = useState('')

  // Count results for search hint
  const filteredCount = useMemo(() => {
    return newsItems.filter(item => {
      const matchCat    = category === 'All' || item.category === category
      const q           = search.toLowerCase()
      const matchSearch = !q || item.title.toLowerCase().includes(q) || item.description.toLowerCase().includes(q) || (item.barangay || '').toLowerCase().includes(q)
      return matchCat && matchSearch
    }).length
  }, [newsItems, category, search])

  const featuredItems = useMemo(() => newsItems.filter(item => item.is_featured), [newsItems])

  return (
    <DashboardLayout>
      <div className="page">

        {/* ── Page Header ── */}
        <div style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Bell size={22} strokeWidth={2} style={{ color: 'var(--accent)', flexShrink: 0 }} />
              <h2 className="section-title" style={{ margin: 0, fontSize: 20 }}>
                News & Announcements
              </h2>
            </div>
            {/* Admin — create button */}
            {isAdmin && (
              <button
                onClick={() => navigate('/admin/news/create')}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '8px 14px', borderRadius: 'var(--radius)',
                  background: 'var(--accent)', color: '#0d1117',
                  border: 'none', fontWeight: 700, fontSize: 12,
                  cursor: 'pointer', fontFamily: 'var(--font-body)',
                  whiteSpace: 'nowrap', flexShrink: 0,
                  transition: 'opacity .15s',
                }}
                onMouseEnter={e => e.currentTarget.style.opacity = '.85'}
                onMouseLeave={e => e.currentTarget.style.opacity = '1'}
              >
                <PlusCircle size={15} strokeWidth={2.5} />
                Create Post
              </button>
            )}
          </div>
          <p className="text-muted text-sm" style={{ margin: 0, paddingLeft: 30 }}>
            Stay updated with waste management activities and city advisories for Lucena City.
            {(itemsLoading || alertsLoading || spotsLoading) && <span style={{ marginLeft: 8, color: 'var(--accent)' }}>Updating...</span>}
          </p>
        </div>

        {/* ── Emergency Alert Banner ── */}
        <EmergencyAlertBanner alerts={alerts} />

        {/* ── Featured Carousel ── */}
        <FeaturedNewsCarousel items={featuredItems} />

        {/* ── Search ── */}
        <NewsSearchBar
          value={search}
          onChange={setSearch}
          resultCount={search ? filteredCount : undefined}
        />

        {/* ── Category Tabs ── */}
        <CategoryTabs active={category} onChange={setCategory} />

        {/* ── News Feed ── */}
        <NewsFeed
          items={newsItems}
          category={category}
          search={search}
        />

        {/* ── Barangay Spotlight ── */}
        <div style={{ marginTop: 24 }}>
          <BarangaySpotlight items={spotlights} />
        </div>

      </div>
    </DashboardLayout>
  )
}
