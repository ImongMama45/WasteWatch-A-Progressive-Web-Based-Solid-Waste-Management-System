/**
 * FeaturedNewsCarousel.jsx
 * -------------------------
 * Auto-playing horizontal swipeable carousel for featured news.
 * Native CSS transitions — no external carousel library.
 * Desktop: ChevronLeft/Right arrows. Mobile: swipe + dots.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { ChevronLeft, ChevronRight, AlertTriangle, Megaphone, Newspaper, Trophy } from 'lucide-react'

const TYPE_ICONS = {
  emergency:    { Icon: AlertTriangle, label: 'Emergency' },
  announcement: { Icon: Megaphone,    label: 'Announcement' },
  news:         { Icon: Newspaper,    label: 'News' },
  rankings:     { Icon: Trophy,       label: 'Rankings' },
}

const CSS = `
@keyframes fc-fade-in { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
.fc-root { position: relative; border-radius: var(--radius); overflow: hidden; user-select: none; touch-action: pan-y; }
.fc-track { display: flex; transition: transform .38s cubic-bezier(.4,0,.2,1); will-change: transform; }
.fc-slide {
  flex: 0 0 100%; width: 100%; min-height: 180px;
  padding: 22px 20px 20px;
  display: flex; flex-direction: column; justify-content: space-between;
  box-sizing: border-box; position: relative; overflow: hidden;
}
.fc-slide-bg {
  position: absolute; inset: 0;
  background: var(--surface-3, #1e2633);
}
.fc-slide-bg::after {
  content: '';
  position: absolute; inset: 0;
  background: linear-gradient(135deg, rgba(0,0,0,.3) 0%, rgba(0,0,0,0) 100%);
}
.fc-content { position: relative; z-index: 1; }
.fc-badge {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 9px; font-weight: 800; letter-spacing: .09em;
  text-transform: uppercase; padding: 3px 9px;
  border-radius: 20px; border: 1px solid rgba(255,255,255,.25);
  color: rgba(255,255,255,.85); background: rgba(255,255,255,.1);
  backdrop-filter: blur(4px); margin-bottom: 10px; width: fit-content;
}
.fc-title { font-size: 17px; font-weight: 700; color: #fff; line-height: 1.25; margin-bottom: 6px; }
.fc-desc  { font-size: 12px; color: rgba(255,255,255,.6); line-height: 1.5;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin-bottom: 14px; }
.fc-read-more {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 7px 14px; border-radius: 8px; border: none;
  background: rgba(255,255,255,.15); color: #fff;
  font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit;
  border: 1px solid rgba(255,255,255,.2);
  transition: background .15s; backdrop-filter: blur(4px);
}
.fc-read-more:hover { background: rgba(255,255,255,.25); }
/* Nav arrows (desktop) */
.fc-arrow {
  position: absolute; top: 50%; transform: translateY(-50%);
  z-index: 10; background: rgba(255,255,255,.15); border: 1px solid rgba(255,255,255,.2);
  color: #fff; border-radius: 8px; width: 34px; height: 34px;
  display: none; align-items: center; justify-content: center;
  cursor: pointer; backdrop-filter: blur(4px);
  transition: background .15s;
}
.fc-arrow:hover { background: rgba(255,255,255,.28); }
@media(min-width:640px) { .fc-arrow { display: flex; } }
.fc-arrow-l { left: 10px; }
.fc-arrow-r { right: 10px; }
/* Dots */
.fc-dots { display: flex; justify-content: center; gap: 6px; margin-top: 10px; }
.fc-dot { height: 6px; border-radius: 3px; border: none; padding: 0; cursor: pointer; transition: width .3s, background .3s; }
.fc-dot-on  { width: 22px; background: var(--accent, #2ecc71); }
.fc-dot-off { width: 6px;  background: rgba(0,0,0,.18); }
/* Date strip */
.fc-date { font-size: 10px; color: rgba(255,255,255,.45); font-weight: 500; margin-bottom: 8px; }
`

let _injected = false
function inject() {
  if (_injected) return; _injected = true
  const el = document.createElement('style'); el.textContent = CSS; document.head.appendChild(el)
}

export default function FeaturedNewsCarousel({ items = [], onReadMore }) {
  inject()
  const TOTAL = items.length
  const [active, setActive] = useState(0)
  const startX   = useRef(0)
  const dragging = useRef(false)
  const timer    = useRef(null)
  const pause    = useRef(null)

  // Start auto-play only if items exist
  const startAuto = useCallback(() => {
    if (TOTAL === 0) return
    clearInterval(timer.current)
    timer.current = setInterval(() => setActive(p => (p + 1) % TOTAL), 5500)
  }, [TOTAL])

  const pauseAuto = useCallback(() => {
    if (TOTAL === 0) return
    clearInterval(timer.current)
    clearTimeout(pause.current)
    pause.current = setTimeout(startAuto, 4000)
  }, [startAuto, TOTAL])

  useEffect(() => { 
    if (TOTAL > 0) startAuto()
    return () => { clearInterval(timer.current); clearTimeout(pause.current) } 
  }, [startAuto, TOTAL])

  if (TOTAL === 0) return null

  function prev() { setActive(p => (p - 1 + TOTAL) % TOTAL); pauseAuto() }
  function next() { setActive(p => (p + 1) % TOTAL); pauseAuto() }

  function onDown(e) { startX.current = (e.clientX ?? e.touches?.[0]?.clientX) || 0; dragging.current = true; pauseAuto() }
  function onUp(e) {
    if (!dragging.current) return; dragging.current = false
    const ex = (e.clientX ?? e.changedTouches?.[0]?.clientX) || startX.current
    const d  = startX.current - ex
    if (d > 40) next()
    else if (d < -40) prev()
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <div
        className="fc-root"
        onPointerDown={onDown} onPointerUp={onUp}
        onPointerLeave={e => { if (dragging.current) onUp(e) }}
        onTouchStart={onDown} onTouchEnd={onUp}
      >
        {/* Track */}
        <div className="fc-track" style={{ transform: `translateX(-${active * 100}%)` }}>
          {items.map(item => {
            const { Icon, label } = TYPE_ICONS[item.type] || TYPE_ICONS.news
            return (
              <div key={item.id} className="fc-slide">
                {/* Background overlay */}
                <div className="fc-slide-bg" style={{ background: item.bgColor ?? 'var(--surface-3)' }} />
                {/* Accent bar */}
                <div style={{
                  position: 'absolute', left: 0, top: 0, bottom: 0, width: 4,
                  background: item.accentColor ?? 'var(--accent)',
                }} />

                <div className="fc-content">
                  {/* Badge */}
                  <div className="fc-badge">
                    <Icon size={10} strokeWidth={2.5} />
                    {item.category}
                  </div>
                  {/* Date */}
                  <div className="fc-date">
                    {new Date(item.date).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })}
                    {item.barangay && ` · ${item.barangay}`}
                  </div>
                  {/* Title */}
                  <div className="fc-title">{item.title}</div>
                  {/* Desc */}
                  <div className="fc-desc">{item.description}</div>
                  {/* CTA */}
                  <button className="fc-read-more" onClick={() => onReadMore?.(item)}>
                    Read More
                    <ChevronRight size={13} strokeWidth={2.5} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {/* Arrows */}
        <button className="fc-arrow fc-arrow-l" onClick={prev} aria-label="Previous">
          <ChevronLeft size={18} strokeWidth={2} />
        </button>
        <button className="fc-arrow fc-arrow-r" onClick={next} aria-label="Next">
          <ChevronRight size={18} strokeWidth={2} />
        </button>
      </div>

      {/* Dots */}
      <div className="fc-dots">
        {Array.from({ length: TOTAL }).map((_, i) => (
          <button
            key={i}
            className={`fc-dot ${i === active ? 'fc-dot-on' : 'fc-dot-off'}`}
            onClick={() => { setActive(i); pauseAuto() }}
            aria-label={`Slide ${i + 1}`}
          />
        ))}
      </div>
    </div>
  )
}
