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
import { NEWS_ITEMS } from './data/newsData'

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

  const [category, setCategory] = useState('All')
  const [search, setSearch]     = useState('')

  // Count results for search hint
  const filteredCount = useMemo(() => {
    return NEWS_ITEMS.filter(item => {
      const matchCat    = category === 'All' || item.category === category
      const q           = search.toLowerCase()
      const matchSearch = !q || item.title.toLowerCase().includes(q) || item.description.toLowerCase().includes(q) || (item.barangay || '').toLowerCase().includes(q)
      return matchCat && matchSearch
    }).length
  }, [category, search])

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
          </p>
        </div>

        {/* ── Emergency Alert Banner ── */}
        <EmergencyAlertBanner />

        {/* ── Featured Carousel ── */}
        <FeaturedNewsCarousel />

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
          items={NEWS_ITEMS}
          category={category}
          search={search}
        />

        {/* ── Barangay Spotlight ── */}
        <div style={{ marginTop: 24 }}>
          <BarangaySpotlight />
        </div>

      </div>
    </DashboardLayout>
  )
}
