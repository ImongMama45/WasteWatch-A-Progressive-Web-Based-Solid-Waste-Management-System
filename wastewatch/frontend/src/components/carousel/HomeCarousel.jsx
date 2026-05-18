/**
 * HomeCarousel.jsx — Mobile-only swipeable hero carousel
 * -------------------------------------------------------
 * Design: matches existing .card-dark (#1e2633) style.
 * Icons : Google Material Symbols Outlined (via .msi class).
 * No external dependencies — native pointer/touch + CSS transitions.
 *
 * Props:
 *   role           {string} — user role
 *   userBarangay   {string} — user's barangay name
 *   onReport       {fn}     — custom report handler (falls back to /report/submit)
 *   extraSecondCta {object} — { label, icon, onClick } for 2nd CTA on card 1
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import RankingModal from './RankingModal'

// ─── Announcement mock ────────────────────────────────────────────────────────
// REPLACE WITH: api.get('/api/announcements/latest/')
const ANNOUNCEMENT = {
  title: 'Collection Adjusted — Heavy Rain',
  body: 'Garbage collection in Isabang and Cotta is rescheduled to tomorrow 7AM due to heavy rainfall.',
  date: 'May 19, 2026',
  isNew: true,
}

// ─── Top 3 preview (rankings card) ───────────────────────────────────────────
const TOP3 = [
  { rank: 1, name: 'Gulang-Gulang',  score: 98 },
  { rank: 2, name: 'Ibabang Dupay',  score: 95 },
  { rank: 3, name: 'Mayao Crossing', score: 92 },
]

// ─── Styles ───────────────────────────────────────────────────────────────────
const CSS = `
/* Carousel root */
.hc-root {
  position: relative;
  border-radius: var(--radius, 12px);
  overflow: hidden;
  touch-action: pan-y;
  user-select: none;
  margin-bottom: 4px;
}

.hc-track {
  display: flex;
  transition: transform .36s cubic-bezier(.4,0,.2,1);
  will-change: transform;
}

/* Each slide shares the .card-dark surface (#1e2633) */
.hc-slide {
  flex: 0 0 100%;
  width: 100%;
  background: var(--surface-3, #1e2633);
  padding: 22px 20px 20px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-height: 180px;
}

/* Top label row inside a slide */
.hc-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .10em;
  text-transform: uppercase;
  color: var(--accent, #2ecc71);
  display: flex;
  align-items: center;
  gap: 6px;
}

.hc-label .msi { font-size: 16px; }

/* Heading */
.hc-title {
  font-size: 17px;
  font-weight: 700;
  color: #fff;
  line-height: 1.25;
  margin: 2px 0 4px;
}

/* Body text */
.hc-body {
  font-size: 12px;
  color: rgba(255,255,255,.58);
  line-height: 1.55;
}

/* Accent line below label */
.hc-accent-bar {
  width: 28px;
  height: 2px;
  background: var(--accent, #2ecc71);
  border-radius: 2px;
  margin-bottom: 2px;
}

/* Announcement badge */
.hc-new-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  background: rgba(46,204,113,.12);
  border: 1px solid rgba(46,204,113,.35);
  color: var(--accent, #2ecc71);
  font-size: 8px;
  font-weight: 800;
  letter-spacing: .09em;
  padding: 2px 7px;
  border-radius: 20px;
}

/* CTA button row */
.hc-btns {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

/* Buttons inherit .btn but override colours for dark card */
.hc-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 9px 16px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  border: none;
  font-family: var(--font-body, sans-serif);
  letter-spacing: .02em;
  transition: opacity .15s, transform .1s;
  white-space: nowrap;
}
.hc-btn:active { transform: scale(.96); }
.hc-btn:hover  { opacity: .86; }
.hc-btn .msi  { font-size: 16px; }

.hc-btn--primary {
  background: #fff;
  color: var(--surface-3, #1e2633);
}

.hc-btn--ghost {
  background: rgba(255,255,255,.1);
  border: 1px solid rgba(255,255,255,.2) !important;
  color: rgba(255,255,255,.85);
}

.hc-btn--accent {
  background: var(--accent, #2ecc71);
  color: #0d1117;
}

/* Mini ranking rows */
.hc-rank-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid rgba(255,255,255,.07);
}
.hc-rank-row:last-child { border-bottom: none; }

/* Pagination dots */
.hc-dots {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
}
.hc-dot {
  height: 6px;
  border-radius: 3px;
  border: none;
  padding: 0;
  cursor: pointer;
  transition: width .3s ease, background .3s;
}
.hc-dot-active  { width: 20px; background: var(--accent, #2ecc71); }
.hc-dot-inactive{ width: 6px;  background: rgba(0,0,0,.2); }
`

let _injected = false
function injectStyles() {
  if (_injected) return
  _injected = true
  const el = document.createElement('style')
  el.textContent = CSS
  document.head.appendChild(el)
}

// ─── Slide 1 — Report ─────────────────────────────────────────────────────────
function ReportSlide({ role, onReport, extraSecondCta }) {
  const title =
    role === 'barangay_official' ? 'Report or Validate' : 'Report a Garbage Issue'
  const sub =
    role === 'barangay_official'
      ? 'Submit a report or validate community reports in your area.'
      : 'See uncollected waste or illegal dumping? Let your barangay know.'

  return (
    <div className="hc-slide">
      <div>
        <div className="hc-label">
          <span className="msi">delete</span>
          Waste Reporting
        </div>
        <div className="hc-accent-bar" />
        <div className="hc-title">{title}</div>
        <div className="hc-body">{sub}</div>
      </div>
      <div className="hc-btns">
        <button
          className="hc-btn hc-btn--primary"
          onClick={onReport}
          style={{ flex: extraSecondCta ? '2 1 0' : '1' }}
        >
          <span className="msi">photo_camera</span>
          Submit Report
        </button>
        {extraSecondCta && (
          <button
            className="hc-btn hc-btn--ghost"
            onClick={extraSecondCta.onClick}
            style={{ flex: '1 1 0' }}
          >
            <span className="msi">{extraSecondCta.icon || 'task_alt'}</span>
            {extraSecondCta.label}
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Slide 2 — Announcement ───────────────────────────────────────────────────
function AnnouncementSlide({ announcement }) {
  const navigate = useNavigate()
  return (
    <div className="hc-slide">
      <div>
        <div className="hc-label">
          <span className="msi">campaign</span>
          LGU Announcement
          {announcement?.isNew && (
            <span className="hc-new-badge">NEW</span>
          )}
        </div>
        <div className="hc-accent-bar" />
        <div className="hc-title">{announcement?.title || 'No announcements'}</div>
        <div className="hc-body" style={{
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>
          {announcement?.body}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,.35)', fontWeight: 500 }}>
          {announcement?.date}
        </span>
        <button
          className="hc-btn hc-btn--ghost"
          style={{ padding: '7px 13px' }}
          onClick={() => navigate('/announcements')}
        >
          Read More
          <span className="msi">arrow_forward</span>
        </button>
      </div>
    </div>
  )
}

// ─── Slide 3 — Rankings ───────────────────────────────────────────────────────
function RankingsSlide({ onViewRankings }) {
  const MEDALS = ['looks_one', 'looks_two', 'looks_3']
  return (
    <div className="hc-slide">
      <div>
        <div className="hc-label">
          <span className="msi">emoji_events</span>
          Cleanliness Rankings
        </div>
        <div className="hc-accent-bar" />
        <div className="hc-title">Top 10 Cleanest Barangays</div>
        <div style={{ marginTop: 8 }}>
          {TOP3.map((b, i) => (
            <div key={b.rank} className="hc-rank-row">
              <span
                className="msi"
                style={{
                  fontSize: 18,
                  color: ['#f59e0b', '#94a3b8', '#b45309'][i],
                  flexShrink: 0,
                }}
              >
                {MEDALS[i]}
              </span>
              <span style={{ flex: 1, fontSize: 12, color: 'rgba(255,255,255,.8)', fontWeight: 600 }}>
                {b.name}
              </span>
              <span style={{
                fontSize: 12, fontWeight: 700,
                color: 'var(--accent)',
              }}>
                {b.score}%
              </span>
            </div>
          ))}
        </div>
      </div>
      <button
        className="hc-btn hc-btn--accent"
        style={{ alignSelf: 'flex-start' }}
        onClick={onViewRankings}
      >
        <span className="msi">leaderboard</span>
        View Full Rankings
      </button>
    </div>
  )
}

// ─── Pagination ────────────────────────────────────────────────────────────────
function Dots({ count, active, onDotClick }) {
  return (
    <div className="hc-dots">
      {Array.from({ length: count }).map((_, i) => (
        <button
          key={i}
          className={`hc-dot ${i === active ? 'hc-dot-active' : 'hc-dot-inactive'}`}
          onClick={() => onDotClick(i)}
          aria-label={`Slide ${i + 1}`}
        />
      ))}
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function HomeCarousel({ role = 'citizen', userBarangay = '', onReport, extraSecondCta }) {
  const navigate = useNavigate()
  const TOTAL = 3
  const [active, setActive]           = useState(0)
  const [rankOpen, setRankOpen]       = useState(false)
  const startX   = useRef(0)
  const dragging = useRef(false)
  const autoTimer = useRef(null)
  const pauseTimer = useRef(null)

  injectStyles()

  const startAuto = useCallback(() => {
    clearInterval(autoTimer.current)
    autoTimer.current = setInterval(() => setActive(p => (p + 1) % TOTAL), 6000)
  }, [])

  const pauseAuto = useCallback(() => {
    clearInterval(autoTimer.current)
    clearTimeout(pauseTimer.current)
    pauseTimer.current = setTimeout(startAuto, 3000)
  }, [startAuto])

  useEffect(() => { startAuto(); return () => { clearInterval(autoTimer.current); clearTimeout(pauseTimer.current) } }, [startAuto])

  function onDown(e) { startX.current = e.clientX ?? e.touches?.[0]?.clientX ?? 0; dragging.current = true; pauseAuto() }
  function onUp(e) {
    if (!dragging.current) return; dragging.current = false
    const endX = e.clientX ?? e.changedTouches?.[0]?.clientX ?? startX.current
    const d = startX.current - endX
    if (Math.abs(d) > 40) setActive(p => d > 0 ? Math.min(p + 1, TOTAL - 1) : Math.max(p - 1, 0))
  }

  return (
    <>
      <div>
        <div
          className="hc-root"
          onPointerDown={onDown} onPointerUp={onUp}
          onPointerLeave={e => { if (dragging.current) onUp(e) }}
          onTouchStart={onDown} onTouchEnd={onUp}
        >
          <div className="hc-track" style={{ transform: `translateX(-${active * 100}%)` }}>
            <ReportSlide role={role} onReport={onReport ?? (() => navigate('/report/submit'))} extraSecondCta={extraSecondCta} />
            <AnnouncementSlide announcement={ANNOUNCEMENT} />
            <RankingsSlide onViewRankings={() => { pauseAuto(); setRankOpen(true) }} />
          </div>
        </div>
        <Dots count={TOTAL} active={active} onDotClick={i => { setActive(i); pauseAuto() }} />
      </div>

      <RankingModal open={rankOpen} onClose={() => setRankOpen(false)} userBarangay={userBarangay} />
    </>
  )
}
