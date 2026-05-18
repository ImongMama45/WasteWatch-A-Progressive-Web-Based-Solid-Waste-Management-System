/**
 * pages/dashboard/PublicDashboard.jsx
 * ------------------------------------
 * Light-mode redesign for normal Lucena City citizens.
 * All hooks, logic, and child-component imports are preserved exactly.
 * Only JSX structure and class-names have changed to match the new
 * Publicdashboardlanding.css light-mode stylesheet.
 */

import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'

import Navbar from '../../components/Navbar'
import BottomNav from '../../components/BottomNav'
import OfflineBanner from '../../components/OfflineBanner'
import CachedMapSnapshot from '../../components/CachedMapSnapshot'
import OfflineReportBuilder from '../../components/OfflineReportBuilder'
import OfflineReportQueue from '../../components/OfflineReportQueue'
import OfflineAnalyticsSnapshot from '../../components/OfflineAnalyticsSnapshot'
import OfflineEventCalendar from '../../components/OfflineEventCalendar'
import OfflineCommandCenter from '../../components/OfflineCommandCenter'
import OfflineBarangayProfile from '../../components/OfflineBarangayProfile'
import OfflineGamification from '../../components/OfflineGamification'
import OfflineGISLite from '../../components/OfflineGISLite'

import { useAuth } from '../../context/AuthContext'
import { useOnline } from '../../hooks/useOnline'
import { useOfflineReports } from '../../hooks/useOfflineReports'
import { useOfflineAnnouncements } from '../../hooks/useOfflineAnnouncements'
import { useOfflineSyncManager } from '../../hooks/useOfflineSyncManager'
import { useOfflineInsights } from '../../hooks/useOfflineInsights'

/* Light-mode landing stylesheet */
import '../../styles/pages/Publicdashboardlanding.css'
/* Child-component stylesheets (unchanged) */
import '../../styles/pages/OfflineModules.css'
import '../../styles/pages/OfflineModules2.css'

// ─── Constants ────────────────────────────────────────────────────────────────

const HERO_SLIDES = [
  {
    eyebrow: 'Lucena City · CENRO',
    title: (
      <>
        Cleaner Lucena,{' '}
        <em>One Report at a Time</em>
      </>
    ),
    sub: "I-report ang basura sa inyong barangay, alamin ang schedule ng kolektor, at makiisa sa mas malinis na Lucena City.",
  },
  {
    eyebrow: 'Citizen Portal',
    title: (
      <>
        Mag-report ng Problema. <em>Madali Lang.</em>
      </>
    ),
    sub: "I-capture ang inyong lokasyon kahit offline, mag-submit anumang oras — i-sync pagbalik ng signal.",
  },
  {
    eyebrow: 'Collection Schedules',
    title: (
      <>
        Alamin Kung Kailan <em>Darating ang Truck</em>
      </>
    ),
    sub: "Huwag palampasin ang koleksyon. Tingnan ang schedule ng inyong barangay anumang oras.",
  },
]

const FALLBACK_SCHEDULE = [
  { day: 'Lunes', zone: 'Barangay Isabang', time: '6:00 AM – 10:00 AM', isNext: true, status: 'upcoming' },
  { day: 'Miyerkules', zone: 'Barangay Gulang-Gulang', time: 'N/A', isNext: false, status: 'missed' },
  { day: 'Biyernes', zone: 'Barangay Isabang', time: '6:00 AM – 10:00 AM', isNext: false, status: 'upcoming' },
]

// ─── SVG Icons (inline, no external dep) ─────────────────────────────────────

const IconMap = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
    <path d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
)
const IconTruck = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
    <path d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1" />
  </svg>
)
const IconPhone = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
    <line x1="12" y1="18" x2="12.01" y2="18" />
  </svg>
)
const IconCalendar = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" /><path d="M9 16l2 2 4-4" />
  </svg>
)
const IconCheck = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
)
const IconX = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)
const IconFlag = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" y1="22" x2="4" y2="15" />
  </svg>
)

// ─── Component ────────────────────────────────────────────────────────────────

export default function PublicDashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const isOnline = useOnline()

  // ── Data hooks ───────────────────────────────────────────────────────────────
  const { announcements, isStale, isRefreshing } = useOfflineAnnouncements()

  const {
    reports, addReport, retryReport,
    isSyncing: reportsSyncing, pendingCount, failedCount,
  } = useOfflineReports()

  const { syncNow, isSyncing, lastSyncAt, summary } = useOfflineSyncManager()

  const {
    insights, overallRiskLevel, wasteSpikeDays, riskBarangays,
  } = useOfflineInsights()

  // ── UI state ─────────────────────────────────────────────────────────────────
  const [schedule, setSchedule] = useState(FALLBACK_SCHEDULE)
  const [heroSlide, setHeroSlide] = useState(0)
  const [annSlide, setAnnSlide] = useState(0)
  const [showBuilder, setShowBuilder] = useState(false)

  // ── Auto-play ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setHeroSlide(p => (p + 1) % HERO_SLIDES.length), 4500)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (announcements.length <= 1) return
    const t = setInterval(() => setAnnSlide(p => (p + 1) % announcements.length), 5000)
    return () => clearInterval(t)
  }, [announcements.length])

  // ── Handlers ──────────────────────────────────────────────────────────────────
  const handleSyncNow = useCallback(() => syncNow(), [syncNow])
  const handleSubmitReport = useCallback(async (fields) => addReport(fields), [addReport])

  // ── Derived ───────────────────────────────────────────────────────────────────
  const nextCollection = schedule.find(s => s.isNext) || schedule[0]
  const currentAnn = announcements[annSlide] || announcements[0]
  const currentHero = HERO_SLIDES[heroSlide]

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="ld-root">
      <OfflineBanner />
      <Navbar />

      {/* ════════ HERO ════════ */}
      <section className="ld-hero">
        {/* decorative orbs — CSS handles them via ::before / ::after */}

        <div className="ld-hero__inner" key={heroSlide}>
          <div className="ld-eyebrow">
            <span className="ld-eyebrow__dot" />
            {currentHero.eyebrow}
          </div>

          <h1 className="ld-hero__heading">{currentHero.title}</h1>
          <p className="ld-hero__sub">{currentHero.sub}</p>

          <div className="ld-hero__actions">
            <button
              className="ld-btn ld-btn--primary"
              onClick={() => setShowBuilder(true)}
            >
              <IconFlag /> Mag-report Ngayon
            </button>
            <button
              className="ld-btn ld-btn--outline"
              onClick={() => document.getElementById('ld-schedule')?.scrollIntoView({ behavior: 'smooth' })}
            >
              <IconCalendar /> Tingnan ang Schedule
            </button>
          </div>

          {/* Hero slide dots */}
          <div className="ld-hero__dots">
            {HERO_SLIDES.map((_, i) => (
              <button
                key={i}
                className={`ld-hero__dot${heroSlide === i ? ' ld-hero__dot--active' : ''}`}
                onClick={() => setHeroSlide(i)}
                aria-label={`Slide ${i + 1}`}
              />
            ))}
          </div>
        </div>

        {/* Floating stat chips */}
        <div className="ld-hero__chips">
          <div className="ld-chip">
            <span className="ld-chip__dot ld-chip__dot--green" />
            <div>
              <div className="ld-chip__value">33</div>
              <div className="ld-chip__label">Barangays</div>
            </div>
          </div>
          <div className="ld-chip">
            <span className="ld-chip__dot ld-chip__dot--amber" />
            <div>
              <div className="ld-chip__value">{pendingCount || 0}</div>
              <div className="ld-chip__label">Mga Pending</div>
            </div>
          </div>
          <div className="ld-chip">
            <span className="ld-chip__dot ld-chip__dot--blue" />
            <div>
              <div className="ld-chip__value">PWA</div>
              <div className="ld-chip__label">Works Offline</div>
            </div>
          </div>
        </div>

        {/* Pending sync pill */}
        {pendingCount > 0 && (
          <div className="ld-hero__sync-pill">
            ⏳ {pendingCount} report{pendingCount > 1 ? 's' : ''} pending sync
          </div>
        )}
      </section>

      {/* ════════ STATS BAR ════════ */}
      <div className="ld-stats-wrap">
        <div className="ld-stats">
          <div className="ld-stat">
            <div className="ld-stat__value">33</div>
            <div className="ld-stat__label">Barangays Covered</div>
          </div>
          <div className="ld-stat">
            <div className="ld-stat__value">12</div>
            <div className="ld-stat__label">Collection Trucks</div>
          </div>
          <div className="ld-stat">
            <div className="ld-stat__value">GIS</div>
            <div className="ld-stat__label">Real-Time Mapping</div>
          </div>
          <div className="ld-stat">
            <div className="ld-stat__value">PWA</div>
            <div className="ld-stat__label">Works Offline</div>
          </div>
        </div>
      </div>

      {/* ════════ FEATURE CARDS ════════ */}
      <div className="ld-features-wrap">
        <div className="ld-features-inner">
          <h2 className="ld-section-title" style={{ marginBottom: 20 }}>
            Ano ang magagawa mo?
          </h2>
          <div className="ld-features">
            <button
              className="ld-feature"
              onClick={() => navigate('/map')}
            >
              <div className="ld-feature__icon ld-feature__icon--green">
                <IconMap />
              </div>
              <div className="ld-feature__title">GIS Waste Map</div>
              <p className="ld-feature__desc">
                Tingnan kung saan ang pinaka-maraming basura sa interactive na mapa ng Lucena City.
              </p>
              <span className="ld-feature__arrow">↗</span>
            </button>

            <button
              className="ld-feature"
              onClick={() => document.getElementById('ld-schedule')?.scrollIntoView({ behavior: 'smooth' })}
            >
              <div className="ld-feature__icon ld-feature__icon--amber">
                <IconTruck />
              </div>
              <div className="ld-feature__title">Collection Schedule</div>
              <p className="ld-feature__desc">
                Alamin kung kailan darating ang garbage truck sa inyong barangay.
              </p>
              <span className="ld-feature__arrow">↗</span>
            </button>

            <button
              className="ld-feature"
              onClick={() => setShowBuilder(true)}
            >
              <div className="ld-feature__icon ld-feature__icon--blue">
                <IconPhone />
              </div>
              <div className="ld-feature__title">Citizen Portal</div>
              <p className="ld-feature__desc">
                Mag-submit ng report kahit walang internet. I-sync pagbalik ng signal.
              </p>
              <span className="ld-feature__arrow">↗</span>
            </button>
          </div>
        </div>
      </div>

      {/* ════════ COLLECTION SCHEDULE ════════ */}
      <div id="ld-schedule" className="ld-schedule-wrap">
        <div className="ld-schedule-inner">
          <div className="ld-section-head">
            <div>
              <div className="ld-eyebrow">
                <span className="ld-eyebrow__dot" /> Inyong Zone
              </div>
              <h2 className="ld-section-title">Collection Schedule</h2>
            </div>
            <button
              className="ld-btn ld-btn--outline-green ld-btn--sm"
              onClick={() => navigate('/schedule')}
            >
              Full Schedule →
            </button>
          </div>

          {/* Next collection hero badge */}
          <div className="ld-next-badge">
            <div className="ld-next-badge__icon">
              <IconCalendar />
            </div>
            <div style={{ flex: 1 }}>
              <div className="ld-next-badge__label">Susunod na Koleksyon</div>
              <div className="ld-next-badge__row">
                <span className="ld-next-badge__day">{nextCollection?.day || 'Lunes'}</span>
                <span className="ld-next-badge__pill">
                  {nextCollection?.time?.split('–')[0]?.trim() || '6:00 AM'}
                </span>
                <span className="ld-next-badge__pill">{nextCollection?.zone || 'Brgy. Isabang'}</span>
                <span
                  className="ld-next-badge__pill ld-next-badge__pill--action"
                  onClick={() => navigate('/schedule')}
                >
                  View More →
                </span>
              </div>
            </div>
          </div>

          {/* Schedule list */}
          <div className="ld-schedule-list">
            <div className="ld-schedule-head">
              <span className="ld-schedule-head-title">Lingguhang Iskedyul</span>
              {!isOnline && <span className="ld-cached">CACHED</span>}
            </div>
            {schedule.map((s, i) => (
              <div
                key={i}
                className={`ld-schedule-item${s.isNext ? ' ld-schedule-item--next' : ''}`}
              >
                <div className={`ld-sched-icon ${s.status === 'upcoming' ? 'ld-sched-icon--check' : 'ld-sched-icon--cross'}`}>
                  {s.status === 'upcoming' ? <IconCheck /> : <IconX />}
                </div>
                <div>
                  <div className="ld-sched-day">{s.day}</div>
                  <div className="ld-sched-zone">{s.zone}</div>
                </div>
                <div className="ld-sched-time">{s.time}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ════════ LIVE MAP ════════ */}
      <div className="ld-map-wrap">
        <div className="ld-map-inner">
          <div className="ld-section-head">
            <div>
              <div className="ld-eyebrow">
                <span className="ld-eyebrow__dot" /> Live
              </div>
              <h2 className="ld-section-title">GIS Waste Map</h2>
            </div>
            <button
              className="ld-btn ld-btn--outline-green ld-btn--sm"
              onClick={() => navigate('/map')}
            >
              Open Full Map →
            </button>
          </div>
          <div className="ld-map-container">
            <CachedMapSnapshot />
          </div>
        </div>
      </div>

      {/* ════════ ANNOUNCEMENTS ════════ */}
      <div className="ld-ann-wrap">
        <div className="ld-ann-inner">
          <div className="ld-section-head">
            <div>
              <div className="ld-eyebrow">
                <span className="ld-eyebrow__dot" /> Balita
                {isStale && !isRefreshing && (
                  <span className="ld-eyebrow__tag ld-eyebrow__tag--amber">CACHED</span>
                )}
                {isRefreshing && (
                  <span className="ld-eyebrow__tag ld-eyebrow__tag--blue">Nag-a-update…</span>
                )}
              </div>
              <h2 className="ld-section-title">Mga Anunsyo</h2>
            </div>
            <button
              className="ld-btn ld-btn--outline-green ld-btn--sm"
              onClick={() => navigate('/announcements')}
            >
              Lahat ng Balita →
            </button>
          </div>

          <div className="ld-ann-card">
            {/* Left: image */}
            <div className="ld-ann-img-wrap">
              <img
                key={annSlide}
                src={currentAnn?.image}
                alt={currentAnn?.title}
                className="ld-ann-img"
              />
            </div>

            {/* Right: content */}
            <div className="ld-ann-content">
              <span className="ld-ann-category">📣 Anunsyo</span>
              <h3 className="ld-ann-title">{currentAnn?.title}</h3>
              <p className="ld-ann-body">{currentAnn?.body}</p>
              <button
                className="ld-btn ld-btn--primary ld-btn--sm"
                onClick={() => navigate(`/announcements/${currentAnn?.id}`)}
              >
                Basahin pa →
              </button>
            </div>

            {/* Carousel nav */}
            {announcements.length > 1 && (
              <>
                <button
                  className="ld-ann-nav ld-ann-nav--prev"
                  onClick={() => setAnnSlide(p => (p - 1 + announcements.length) % announcements.length)}
                  aria-label="Previous"
                >‹</button>
                <button
                  className="ld-ann-nav ld-ann-nav--next"
                  onClick={() => setAnnSlide(p => (p + 1) % announcements.length)}
                  aria-label="Next"
                >›</button>
              </>
            )}
          </div>

          {announcements.length > 1 && (
            <div className="ld-ann-dots">
              {announcements.map((_, i) => (
                <button
                  key={i}
                  className={`ld-ann-dot${annSlide === i ? ' ld-ann-dot--active' : ''}`}
                  onClick={() => setAnnSlide(i)}
                  aria-label={`Announcement ${i + 1}`}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ════════ MID CTA ════════ */}
      <div className="ld-cta ld-cta--mid">
        <div className="ld-cta__inner">
          <div className="ld-cta__track">
            <span>I-track</span> · <span>Subaybayan</span> · <span>Mag-report</span>
          </div>
          <p className="ld-cta__quote">"Isang App para sa Lahat ng Waste Management"</p>
          <p className="ld-cta__sub">
            Ang kumpletong platform ng solid waste management para sa mga mamamayan, field teams, at administrasyon ng Lucena City.
          </p>
          <button className="ld-btn ld-btn--primary" onClick={() => navigate('/about')}>
            Alamin Kung Paano Gumagana →
          </button>
        </div>
      </div>

      {/* ════════ OFFLINE REPORT QUEUE ════════ */}
      <div className="ld-reports-wrap">
        <div className="ld-reports-inner">
          <div className="ld-section-head">
            <div>
              <div className="ld-eyebrow">
                <span className="ld-eyebrow__dot" /> Inyong mga Report
              </div>
              <h2 className="ld-section-title">Mga Naipadala</h2>
            </div>
            <button
              className="ld-btn ld-btn--primary ld-btn--sm"
              onClick={() => setShowBuilder(true)}
            >
              + Bagong Report
            </button>
          </div>
          <OfflineReportQueue
            reports={reports}
            isSyncing={isSyncing || reportsSyncing}
            isOnline={isOnline}
            lastSync={lastSyncAt}
            pendingCount={pendingCount}
            failedCount={failedCount}
            onSyncNow={handleSyncNow}
            onRetry={retryReport}
            onNewReport={() => setShowBuilder(true)}
          />
        </div>
      </div>

      {/* ════════ BOTTOM CTA ════════ */}
      <div className="ld-cta ld-cta--bottom">
        <div className="ld-cta__inner">
          <div className="ld-eyebrow" style={{ justifyContent: 'center' }}>
            <span className="ld-eyebrow__dot" /> Tumulong sa Komunidad
          </div>
          <p className="ld-cta__quote">
            I-monitor at I-report ang mga Problema sa Basura
          </p>
          <p className="ld-cta__sub">
            Makita ang mga problema sa inyong lugar at i-report agad para sa mas malinis na Lucena City.
          </p>
          <button className="ld-btn ld-btn--primary" onClick={() => setShowBuilder(true)}>
            Mag-report Ngayon →
          </button>
        </div>
      </div>

      {/* ════════ FOOTER ════════ */}
      <footer className="ld-footer">
        <div className="ld-footer__inner">
          <div>
            <div className="ld-footer__brand">
              <span className="logo">
                <img src="../../../Logo.svg" alt="logo-svg" />
              </span>
            </div>
            <p className="ld-footer__tagline">
              Smart waste management para sa mas malinis na Lucena City — powered by GIS, ML & PWA.
            </p>
          </div>

          <div className="ld-footer__col">
            <h4 className="ld-footer__col-title">Platform</h4>
            <a href="#">About</a>
            <a href="#">FAQ</a>
            <a href="#">Guidelines</a>
            <a href="#">Para sa Negosyo</a>
          </div>

          <div className="ld-footer__col">
            <h4 className="ld-footer__col-title">Mapa</h4>
            <a href="#" onClick={e => { e.preventDefault(); navigate('/map') }}>Hotspots</a>
            <a href="#">Truck Radar</a>
            <a href="#">Live View</a>
            <a href="#">Statistics</a>
          </div>

          <div className="ld-footer__col">
            <h4 className="ld-footer__col-title">Makipag-ugnayan</h4>
            <a href="tel:042-710-4311">(042) 710 4311</a>
            <a href="mailto:cenro@lucenacity.gov.ph">cenro@lucenacity.gov.ph</a>
            <a href="#">City Hall, Lucena</a>
          </div>
        </div>

        <div className="ld-footer__bottom">
          <p className="ld-footer__copy">
            © 2026 BS Information Technology — CSTC · Para sa thesis lamang · Lucena City
          </p>
          <p className="ld-footer__contact">
            WasteWatch · Lucena City CENRO
          </p>
        </div>
      </footer>

      <BottomNav />

      {/* ════════ REPORT BUILDER SHEET ════════ */}
      <OfflineReportBuilder
        isOpen={showBuilder}
        onClose={() => setShowBuilder(false)}
        onSubmit={handleSubmitReport}
      />
    </div>
  )
}