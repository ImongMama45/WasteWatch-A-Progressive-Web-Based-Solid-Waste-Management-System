/**
 * pages/dashboard/PublicDashboard.jsx
 * ------------------------------------
 * PWA public landing dashboard — accessible without login, works fully offline.
 * Mobile-first. Desktop layout handled via CSS media queries.
 */

import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import Navbar from '../../components/Navbar'
import BottomNav from '../../components/BottomNav'
import OfflineBanner from '../../components/OfflineBanner'
import { useAuth } from '../../context/AuthContext'
import { useOnline } from '../../hooks/useOnline'
import { useCache } from '../../hooks/useCache'
import api from '../../api/client'
import '../../styles/pages/PublicDashboard.css'

// ─── Constants ────────────────────────────────────────────────────────────────

const LS_KEY = 'ww_offline_reports'

const HERO_SLIDES = [
  {
    title: 'The Intelligent Future of Lucena City Waste Management',
    subtitle: 'Connecting Solid Waste Collection with GIS, ML, and PWA Technology for a Cleaner, Greener Lucena!',
  },
  {
    title: 'Report Garbage Problems Instantly',
    subtitle: 'Capture your location offline, submit reports anytime — we sync when you\'re back online.',
  },
  {
    title: 'Track Your Collection Schedule',
    subtitle: 'Know exactly when the garbage truck comes to your barangay.',
  },
]

const FALLBACK_ANNOUNCEMENTS = [
  {
    id: 1,
    title: 'CENRO Conducted 31-day Segregation Test',
    body: 'Lucena City CENRO strictly implements proper waste segregation. Let us unite and make Lucena clean!',
    image: 'https://images.unsplash.com/photo-1532996122724-e3c354a0b15b?auto=format&fit=crop&q=80&w=600',
    date: '2026-04-20',
  },
  {
    id: 2,
    title: 'New Garbage Collection Trucks Arrived',
    body: 'The local government procured 5 new garbage trucks to improve collection efficiency across all barangays.',
    image: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?auto=format&fit=crop&q=80&w=600',
    date: '2026-04-15',
  },
  {
    id: 3,
    title: 'Illegal Dumping Alert — Barangay 1',
    body: 'Multiple reports near 5th Ave. Residents please be vigilant and report any suspicious dumping activity.',
    image: 'https://images.unsplash.com/photo-1567174891668-5b08b0f3e80a?auto=format&fit=crop&q=80&w=600',
    date: '2026-04-10',
  },
]

const FALLBACK_SCHEDULE = [
  { day: 'Monday', zone: 'Barangay Isabang', time: '6:00 AM – 10:00 AM', isNext: true, status: 'upcoming' },
  { day: 'Wednesday', zone: 'Barangay Gulang-Gulang', time: 'N/A', isNext: false, status: 'missed' },
  { day: 'Monday', zone: 'Barangay Isabang', time: '6:00 AM – 10:00 AM', isNext: false, status: 'upcoming' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getStoredReports() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '[]')
  } catch {
    return []
  }
}

function saveStoredReports(reports) {
  localStorage.setItem(LS_KEY, JSON.stringify(reports))
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PublicDashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const isOnline = useOnline()

  const [announcements, setAnnouncements] = useCache('announcements', FALLBACK_ANNOUNCEMENTS)
  const [schedule, setSchedule] = useCache('schedule', FALLBACK_SCHEDULE)

  const [heroSlide, setHeroSlide] = useState(0)
  const [annSlide, setAnnSlide] = useState(0)
  const [reports, setReports] = useState([])
  const [isSyncing, setIsSyncing] = useState(false)
  const [lastSync, setLastSync] = useState(null)

  // ── Load reports from localStorage ──────────────────────────────────────────
  useEffect(() => {
    setReports(getStoredReports())
  }, [])

  // ── Hero auto-play ───────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setHeroSlide(p => (p + 1) % HERO_SLIDES.length), 4500)
    return () => clearInterval(t)
  }, [])

  // ── Announcement auto-play ────────────────────────────────────────────────────
  useEffect(() => {
    if (announcements.length <= 1) return
    const t = setInterval(() => setAnnSlide(p => (p + 1) % announcements.length), 5000)
    return () => clearInterval(t)
  }, [announcements.length])

  // ── Online → sync pending reports & refresh data ─────────────────────────────
  const syncAndRefresh = useCallback(async () => {
    if (!isOnline || isSyncing) return
    setIsSyncing(true)
    try {
      // 1. Fetch fresh data from server
      const [annRes] = await Promise.allSettled([
        api.get('/api/public/announcements/').catch(() => null),
      ])
      if (annRes.status === 'fulfilled' && annRes.value?.data) {
        setAnnouncements(annRes.value.data)
      }

      // 2. Sync unsynced offline reports
      const current = getStoredReports()
      const hasUnsynced = current.some(r => !r.synced)
      if (hasUnsynced) {
        const updated = await Promise.all(
          current.map(async (report) => {
            if (report.synced) return report
            try {
              await api.post('/api/reports/', report)
              return { ...report, synced: true, syncedAt: new Date().toISOString() }
            } catch {
              return report
            }
          })
        )
        saveStoredReports(updated)
        setReports(updated)
      }

      setLastSync(new Date())
    } catch (err) {
      console.error('Sync error:', err)
    } finally {
      setIsSyncing(false)
    }
  }, [isOnline]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isOnline) syncAndRefresh()
  }, [isOnline, syncAndRefresh])

  // ── Derived ──────────────────────────────────────────────────────────────────
  const nextCollection = schedule.find(s => s.isNext) || schedule[0]
  const unsyncedCount = reports.filter(r => !r.synced).length
  const currentAnn = announcements[annSlide] || announcements[0]
  const currentHero = HERO_SLIDES[heroSlide]

  return (
    <div className="pd-container">
      <OfflineBanner />
      <Navbar />

      {/* ════════════════════════════════════════════════
          HERO CAROUSEL
      ════════════════════════════════════════════════ */}
      <section className="pd-hero">
        <div className="pd-hero__overlay" />

        {/* Slide content — animate with key for fade transition */}
        <div className="pd-hero__content" key={heroSlide}>
          <h1 className="pd-hero__title">{currentHero.title}</h1>
          <p className="pd-hero__subtitle">{currentHero.subtitle}</p>
          <div className="pd-hero__buttons">
            <button
              className="pd-btn pd-btn--primary"
              onClick={() => document.getElementById('pd-schedule')?.scrollIntoView({ behavior: 'smooth' })}
            >
              Explore The App
            </button>
            <button
              className="pd-btn pd-btn--outline-white"
              onClick={() => navigate('/about')}
            >
              Learn How
            </button>
          </div>
        </div>

        {/* Dots */}
        <div className="pd-dots pd-hero__dots">
          {HERO_SLIDES.map((_, i) => (
            <button
              key={i}
              className={`pd-dot${heroSlide === i ? ' pd-dot--active' : ''}`}
              onClick={() => setHeroSlide(i)}
              aria-label={`Slide ${i + 1}`}
            />
          ))}
        </div>

        {/* Pending sync chip — shown on hero for visibility */}
        {unsyncedCount > 0 && (
          <div className="pd-sync-chip">
            <span className="pd-sync-chip__dot" />
            {unsyncedCount} Pending Sync
          </div>
        )}
      </section>

      {/* ════════════════════════════════════════════════
          FEATURE CARDS
      ════════════════════════════════════════════════ */}
      <div className="pd-features">
        <button className="pd-feature-card" onClick={() => navigate('/map')}>
          <svg className="pd-feature-card__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span>Smart GIS<br />Mapping</span>
        </button>

        <button className="pd-feature-card pd-feature-card--orange" onClick={() => document.getElementById('pd-schedule')?.scrollIntoView({ behavior: 'smooth' })}>
          <svg className="pd-feature-card__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
            <path d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
          </svg>
          <span>Optimized<br />Collection</span>
        </button>

        <button className="pd-feature-card" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
          <svg className="pd-feature-card__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
            <line x1="12" y1="18" x2="12.01" y2="18" />
          </svg>
          <span>Citizen<br />Portal</span>
        </button>
      </div>

      {/* ════════════════════════════════════════════════
          ANNOUNCEMENTS CAROUSEL
      ════════════════════════════════════════════════ */}
      <section className="pd-section pd-announcements">
        <div className="pd-section__header">
          <h2 className="pd-section__title">Announcements</h2>
          <button className="pd-btn pd-btn--dark-sm" onClick={() => navigate('/announcements')}>
            Read More Articles
          </button>
        </div>

        {/* Carousel card */}
        <div className="pd-ann-card">
          <img
            key={annSlide}
            src={currentAnn?.image}
            alt={currentAnn?.title}
            className="pd-ann-card__img"
          />
          <div className="pd-ann-card__fade" />
          <div className="pd-ann-card__content">
            <h3 className="pd-ann-card__title">{currentAnn?.title}</h3>
            <p className="pd-ann-card__body">{currentAnn?.body}</p>
            <button
              className="pd-btn pd-btn--white-sm"
              onClick={() => navigate(`/announcements/${currentAnn?.id}`)}
            >
              Read More &rsaquo;
            </button>
          </div>

          {/* Prev / Next arrows */}
          {announcements.length > 1 && (
            <>
              <button
                className="pd-ann-card__arrow pd-ann-card__arrow--prev"
                onClick={() => setAnnSlide(p => (p - 1 + announcements.length) % announcements.length)}
                aria-label="Previous"
              >‹</button>
              <button
                className="pd-ann-card__arrow pd-ann-card__arrow--next"
                onClick={() => setAnnSlide(p => (p + 1) % announcements.length)}
                aria-label="Next"
              >›</button>
            </>
          )}
        </div>

        {/* Dots */}
        {announcements.length > 1 && (
          <div className="pd-dots pd-dots--dark">
            {announcements.map((_, i) => (
              <button
                key={i}
                className={`pd-dot pd-dot--dark${annSlide === i ? ' pd-dot--active-dark' : ''}`}
                onClick={() => setAnnSlide(i)}
                aria-label={`Announcement ${i + 1}`}
              />
            ))}
          </div>
        )}
      </section>

      {/* ════════════════════════════════════════════════
          COLLECTION SCHEDULE
      ════════════════════════════════════════════════ */}
      <section id="pd-schedule" className="pd-section pd-schedule">
        {/* Next collection banner */}
        <div className="pd-next-card">
          <div className="pd-next-card__icon">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
              <path d="M9 16l2 2 4-4" />
            </svg>
          </div>
          <div className="pd-next-card__info">
            <span className="pd-next-card__label">Next Garbage Collection</span>
            <div className="pd-next-card__row" style={{ justifyContent: "space-between", display: "flex" }}>
              <span className="pd-next-card__day">{nextCollection?.day || 'Monday'}</span>
              <span className="pd-next-card__badge">{nextCollection?.time?.split('–')[0]?.trim() || '6:00 AM'}</span>
              <span className="pd-next-card__badge">{nextCollection?.zone || 'Brgy. Isabang'}</span>
              <span className="pd-next-card__badge" style={{ color: 'rgba(255, 255, 255, 1)' }} onClick={() => navigate('/schedule')}>{nextCollection ? 'View More' : ''}</span>
            </div>
          </div>
        </div>

        {/* Schedule list */}
        <div className="pd-schedule-card">
          <div className="pd-schedule-card__header">
            <span className="pd-schedule-card__title">Your Collection Schedule</span>
            {!isOnline && <span className="pd-cached-badge">CACHED</span>}
          </div>
          {schedule.length === 0 ? (
            <p className="pd-empty">No schedule available.</p>
          ) : (
            schedule.map((s, i) => (
              <div key={i} className={`pd-schedule-item${s.isNext ? ' pd-schedule-item--next' : ''}`}>
                <div className={`pd-schedule-item__icon ${s.status === 'upcoming' ? 'check' : 'cross'}`}>
                  {s.status === 'upcoming' ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  )}
                </div>
                <div className="pd-schedule-item__info">
                  <span className="pd-schedule-item__day">{s.day}</span>
                  <span className="pd-schedule-item__zone">{s.zone}</span>
                </div>
                <div className="pd-schedule-item__time">{s.time}</div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* ════════════════════════════════════════════════
          MID BANNER
      ════════════════════════════════════════════════ */}
      <div className="pd-mid-banner">
        <div className="pd-mid-banner__overlay" />
        <div className="pd-mid-banner__content">
          <blockquote className="pd-mid-banner__quote">
            "One App for Monitoring All Waste Management Related Stuff"
          </blockquote>
          <p className="pd-mid-banner__sub">Track &bull; Monitor &bull; Report</p>
        </div>
      </div>

      {/* ════════════════════════════════════════════════
          MY REPORTS / OFFLINE REPORTS
      ════════════════════════════════════════════════ */}
      <section className="pd-section pd-reports-wrap">
        {/* Header card (dark) */}
        <div className="pd-reports-header">
          <div className="pd-reports-header__icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
          </div>
          <div className="pd-reports-header__info">
            <h2 className="pd-reports-header__title">Your Garbage Reports</h2>
            <p className="pd-reports-header__sub">
              {lastSync ? `Last synced: ${lastSync.toLocaleTimeString()}` : 'Not yet synced this session'}
            </p>
          </div>
          <div className={`pd-status-pill${isOnline ? ' pd-status-pill--online' : ''}`}>
            <span className="pd-status-pill__dot" />
            {isOnline ? (isSyncing ? 'Syncing…' : 'Online') : 'Offline'}
          </div>
        </div>

        {/* Reports list */}
        <div className="pd-reports-list">
          <div className="pd-reports-list__header">
            <span className="pd-reports-list__title">My Reports</span>
            <button
              className="pd-link"
              onClick={() => navigate('/reports')}
            >
              View More &rsaquo;
            </button>
          </div>

          {reports.length === 0 ? (
            <div className="pd-empty">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" /></svg>
              <span>No reports yet. Submit your first report!</span>
            </div>
          ) : (
            reports.slice(0, 5).map((r, i) => (
              <div key={r.id || i} className="pd-report-item">
                <div className="pd-report-item__pin">📍</div>
                <div className="pd-report-item__details">
                  <div className="pd-report-item__top">
                    <span className="pd-report-item__type">{r.issueType || 'Overflow'}</span>
                    <span className={`pd-status-badge pd-status-badge--${(r.status || 'pending').toLowerCase()}`}>
                      {r.status || 'Pending'}
                    </span>
                  </div>
                  <span className="pd-report-item__address">{r.address || r.location || 'Location unavailable'}</span>
                </div>
                <div className="pd-report-item__meta">
                  <span className="pd-report-item__date">
                    {r.date ? new Date(r.date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) : '—'}
                  </span>
                  <span className={`pd-sync-badge${r.synced ? '' : ' pd-sync-badge--unsynced'}`}>
                    {r.synced ? 'Synced' : 'Unsynced'}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Report CTA (dark bottom) */}
        <div className="pd-report-cta">
          <div className="pd-report-cta__text">
            <h3>Report a Garbage Problem?</h3>
            <p>See uncollected waste or illegal dumping? Let us know.</p>
          </div>
          <button
            className="pd-btn pd-btn--light"
            onClick={() => navigate('/report/submit')}
          >
            Submit report
          </button>
        </div>
      </section>

      {/* ════════════════════════════════════════════════
          BOTTOM BANNER
      ════════════════════════════════════════════════ */}
      <div className="pd-bottom-banner">
        <div className="pd-bottom-banner__overlay" />
        <div className="pd-bottom-banner__content">
          <h2 className="pd-bottom-banner__title">Monitor and Report Waste Problems</h2>
          <p className="pd-bottom-banner__sub">
            Makita ang mga problema sa inyong lugar at i-report agad para sa mas malinis na Lucena City.
          </p>
          <button
            className="pd-btn pd-btn--outline-white"
            onClick={() => navigate('/report/submit')}
          >
            Make a report
          </button>
        </div>
      </div>

      {/* ════════════════════════════════════════════════
          FOOTER
      ════════════════════════════════════════════════ */}
      <footer className="pd-footer">
        <div className="pd-footer__brand">
          <span className="pd-footer__logo">🗑️</span>
          <span className="pd-footer__name">WasteWatch</span>
        </div>

        <div className="pd-footer__grid">
          <div className="pd-footer__col">
            <h4>How it Works</h4>
            <a href="#">About</a>
            <a href="#">FAQ</a>
            <a href="#">Guidelines</a>
            <a href="#">For Business</a>
          </div>
          <div className="pd-footer__col">
            <h4>Maps</h4>
            <a href="#" onClick={e => { e.preventDefault(); navigate('/map') }}>Hotspots</a>
            <a href="#">Truck Radar</a>
            <a href="#">Live</a>
            <a href="#">Statistics</a>
          </div>
          <div className="pd-footer__col">
            <h4>Contact</h4>
            <a href="tel:042-710-4311">(042) 710 4311</a>
            <a href="mailto:cenro@lucenacity.gov.ph">cenro@lucenacity.gov.ph</a>
            <a href="#">City Hall</a>
          </div>
        </div>

        <p className="pd-footer__copy">
          &copy; 2026 BS Information Technology — CSTC. For thesis purposes only. Lucena City.
        </p>
      </footer>

      <BottomNav />
    </div>
  )
}
