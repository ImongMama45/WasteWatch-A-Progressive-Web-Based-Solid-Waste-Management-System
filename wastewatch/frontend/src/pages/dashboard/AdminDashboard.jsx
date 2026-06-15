import { useState, useEffect, useMemo } from "react";
import MiniMap from "../../components/MiniMap";
import api from "../../api/client";
import { useAuth } from "../../context/AuthContext";

// ─── Priority config ──────────────────────────────────────────────────────────

const PRIORITY = {
  critical: { label: "Critical", barColor: "var(--danger)", bgColor: "rgba(231,76,60,0.07)", borderColor: "rgba(231,76,60,0.28)", textColor: "var(--danger)" },
  high:     { label: "High",     barColor: "var(--warning)", bgColor: "rgba(243,156,18,0.07)", borderColor: "rgba(243,156,18,0.28)", textColor: "var(--warning)" },
  medium:   { label: "Medium",   barColor: "var(--accent)",  bgColor: "rgba(46,204,113,0.07)", borderColor: "rgba(46,204,113,0.28)", textColor: "var(--accent)" },
};

const FEED_DOT = { danger: "var(--danger)", warning: "var(--warning)", success: "var(--accent)", info: "#378ADD" };

const TRUCK_COLORS = [
  { color: '#2563EB', bg: '#EFF6FF' },
  { color: '#D97706', bg: '#FFFBEB' },
  { color: '#7C3AED', bg: '#F5F3FF' },
  { color: '#DC2626', bg: '#FEF2F2' },
  { color: '#0891B2', bg: '#ECFEFF' },
  { color: '#059669', bg: '#ECFDF5' },
];

const Ico = ({ d, size = 14, color = 'currentColor', sw = 1.75 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw}
    strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, display: 'block' }}>
    <path d={d} />
  </svg>
);
const IcoTruck = p => <Ico {...p} d="M1 3h15v13H1zM16 8h4l3 3v5h-7V8zM5.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM18.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z" />;
const IcoCal = p => <Ico {...p} d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />;
const IcoClock = p => <Ico {...p} d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2zM12 6v6l4 2" />;
const IcoPin = p => <Ico {...p} d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1 1 18 0zM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />;
const IcoX = p => <Ico {...p} d="M18 6L6 18M6 6l12 12" />;

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const map = {
    completed: { label: "COMPLETED", color: "var(--accent)", bg: "rgba(46,204,113,0.1)", border: "rgba(46,204,113,0.28)" },
    "in-progress": { label: "IN PROGRESS", color: "var(--warning)", bg: "rgba(243,156,18,0.1)", border: "rgba(243,156,18,0.28)" },
    issue: { label: "ISSUE", color: "var(--danger)", bg: "rgba(231,76,60,0.1)", border: "rgba(231,76,60,0.28)" },
    pending: { label: "PENDING", color: "var(--warning)", bg: "rgba(243,156,18,0.1)", border: "rgba(243,156,18,0.28)" },
    validated: { label: "VALIDATED", color: "var(--accent)", bg: "rgba(46,204,113,0.1)", border: "rgba(46,204,113,0.28)" },
  };
  const s = map[status] || { label: status?.toUpperCase() || 'UNKNOWN', color: "var(--text-muted)", bg: "var(--surface-2)", border: "var(--border)" };
  return (
    <span style={{
      background: s.bg, border: `1px solid ${s.border}`, color: s.color,
      borderRadius: 20, padding: "2px 9px",
      fontSize: 9, fontWeight: 800, letterSpacing: ".05em", whiteSpace: "nowrap",
    }}>{s.label}</span>
  );
}

function SeverityDot({ severity }) {
  const colors = { high: "var(--danger)", medium: "var(--warning)", low: "var(--accent)" };
  return (
    <span style={{
      display: "inline-block", width: 7, height: 7, borderRadius: "50%",
      background: colors[severity] || "var(--text-muted)",
      marginRight: 5, flexShrink: 0,
    }} />
  );
}

function BarChart({ data }) {
  if (!data.length) return <div style={{ height: 110, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'var(--text-muted)' }}>No data available</div>
  const max = Math.max(...data.map(d => d.kg || 0), 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 110, padding: "0 4px" }}>
      {data.map((d, i) => (
        <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
          <span style={{ fontSize: 9, color: "var(--text-muted)", fontWeight: 600 }}>{d.kg}</span>
          <div style={{
            width: "100%", height: Math.round(((d.kg || 0) / max) * 82),
            background: d.status === 'issue' ? "var(--danger)" : "var(--accent)", borderRadius: "4px 4px 0 0",
            opacity: 0.85, transition: "height .4s",
          }} />
          <span style={{ fontSize: 9, color: "var(--text-muted)", textAlign: "center", lineHeight: 1.2 }}>
            {d.name?.split(" ")[0]}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const { user } = useAuth();

  const [mainTab, setMainTab] = useState("drivers");
  const [hotspotFilter, setHotspotFilter] = useState("all");
  const [expandedDriver, setExpandedDriver] = useState(null);
  const [expandedEsc, setExpandedEsc] = useState(null);
  
  const [stats, setStats] = useState({ total_waste: 0, waste_change: 0, active_trucks: 0, hotspots: 0, completed_routes: 0, total_routes: 0, pending_reports: 0, barangays_covered: 0 });
  const [escalations, setEscalations] = useState([]);
  const [hotspots, setHotspots] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [feed, setFeed] = useState([]);
  const [brgyWaste, setBrgyWaste] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [calendarEvents, setCalendarEvents] = useState([]);
  const [calDayModal, setCalDayModal] = useState(null);
  const [calMonth, setCalMonth] = useState(() => new Date().getMonth());
  const [calYear, setCalYear] = useState(() => new Date().getFullYear());
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    setLoading(true)
    Promise.all([
      api.get('/api/public/stats/').catch(() => ({ data: {} })),
      api.get('/api/watcher/escalations/').catch(() => ({ data: [] })),
      api.get('/api/watcher/hotspots/').catch(() => ({ data: [] })),
      api.get('/api/driver/trucks/').catch(() => ({ data: [] })),
      api.get('/api/analytics/activity-logs/').catch(() => ({ data: [] })),
      api.get('/api/analytics/barangay-performance/').catch(() => ({ data: [] })),
      api.get('/api/driver/collection-schedules/').catch(() => ({ data: [] })),
      api.get('/api/driver/calendar-events/').catch(() => ({ data: [] })),
    ]).then(([st, esc, hs, dr, fd, bw, sc, ce]) => {
      if (st.data) setStats(prev => ({ ...prev, ...st.data }))
      if (esc.data) setEscalations(esc.data)
      if (hs.data) setHotspots(hs.data)
      if (dr.data) setDrivers(dr.data)
      if (fd.data) setFeed(fd.data.slice(0, 8))
      if (bw.data) setBrgyWaste(bw.data.map(b => ({ name: b.barangay_name, kg: b.waste_collected_kg, status: b.resolved >= b.reports ? 'completed' : 'in-progress' })))
      if (sc.data) setSchedule(sc.data)
      if (ce.data) setCalendarEvents(ce.data)
    }).finally(() => setLoading(false))
  }, []);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 3200);
  }

  async function resolveEscalation(id) {
    try {
      await api.post(`/api/watcher/escalations/${id}/resolve/`)
      setEscalations(prev => prev.filter(e => e.id !== id));
      setExpandedEsc(null);
      showToast("Escalation resolved. Barangay has been notified.");
    } catch { showToast("Failed to resolve.") }
  }

  const filteredHotspots = hotspotFilter === "all" ? hotspots : hotspots.filter(h => h.status === hotspotFilter);
  const criticalCount = escalations.filter(e => e.priority === "critical").length;
  const pendingHots = hotspots.filter(h => h.status === "pending").length;

  const truckColorMap = useMemo(() => {
    const map = {};
    schedule.forEach(s => {
      const key = String(s.truck || s.truck_id || s.truck_plate || 'route');
      if (!(key in map)) map[key] = Object.keys(map).length % TRUCK_COLORS.length;
    });
    return map;
  }, [schedule]);

  function getTruckColorIdx(route) {
    const key = String(route.truck || route.truck_id || route.truck_plate || 'route');
    return truckColorMap[key] ?? 0;
  }

  function routeMatchesDay(route, dayName) {
    const days = Array.isArray(route.days) ? route.days.join(',') : route.days || route.day || route.collection_days || '';
    return String(days).toLowerCase().includes(dayName.toLowerCase());
  }

  function openCalDayModal(d, dateStr, cellDayName, routes, events) {
    setCalDayModal({
      dateStr,
      cellDayName,
      label: new Date(calYear, calMonth, d).toLocaleDateString('default', { month: 'long', day: 'numeric', year: 'numeric' }),
      routes,
      events,
    });
  }

  const calNavPrev = () => { if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1) } else { setCalMonth(m => m - 1) } };
  const calNavNext = () => { if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1) } else { setCalMonth(m => m + 1) } };

  function renderCalendar() {
    const today = new Date();
    const isCurrentMonth = today.getMonth() === calMonth && today.getFullYear() === calYear;
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const firstDay = new Date(calYear, calMonth, 1).getDay();
    const cells = [...Array(firstDay).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
    const dayFull = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayAbbr = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const monthLabel = new Date(calYear, calMonth, 1).toLocaleString('default', { month: 'long', year: 'numeric' });

    return (
      <div className="admin-cal">
        <div className="admin-cal-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button className="admin-cal-nav" onClick={calNavPrev}>‹</button>
            <button className="admin-cal-nav" onClick={calNavNext}>›</button>
            <span className="admin-cal-month">{monthLabel}</span>
          </div>
          {!isCurrentMonth && (
            <button className="admin-cal-today" onClick={() => { setCalMonth(today.getMonth()); setCalYear(today.getFullYear()) }}>Today</button>
          )}
        </div>
        <div className="admin-cal-dow">{dayAbbr.map(d => <div key={d}>{d}</div>)}</div>
        <div className="admin-cal-grid">
          {cells.map((d, i) => {
            if (!d) return <div key={i} className="admin-cal-cell empty" />;
            const cellDate = new Date(calYear, calMonth, d);
            const cellDayName = dayFull[cellDate.getDay()];
            const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const dayRoutes = schedule.filter(s => routeMatchesDay(s, cellDayName));
            const dayEvents = calendarEvents.filter(e => e.date === dateStr);
            const total = dayRoutes.length + dayEvents.length;
            const isToday = isCurrentMonth && d === today.getDate();

            return (
              <button key={i} className={`admin-cal-cell${isToday ? ' today' : ''}`} onClick={() => openCalDayModal(d, dateStr, cellDayName, dayRoutes, dayEvents)}>
                <div className="admin-cal-date-row">
                  <span className="admin-cal-date">{d}</span>
                  {total > 0 && <span className="admin-cal-count">{total}</span>}
                </div>
                {dayRoutes.slice(0, 2).map(s => {
                  const tc = TRUCK_COLORS[getTruckColorIdx(s)];
                  return (
                    <span key={`r-${s.id}`} className="admin-cal-chip" style={{ background: tc.bg, borderLeftColor: tc.color, color: tc.color }}>
                      <IcoTruck size={7} color={tc.color} /> {s.barangay_names || s.truck_plate || 'Route'}
                    </span>
                  );
                })}
                {dayEvents.slice(0, 1).map(ev => <span key={`e-${ev.id}`} className="admin-cal-chip event"><IcoCal size={7} color="#D97706" /> {ev.title}</span>)}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading dashboard data...</div>

  return (
    <>
      <style>{`
        @keyframes fadeSlideIn { from { opacity:0; transform:translateY(-8px); } to { opacity:1; transform:translateY(0); } }
        @keyframes slideDown { from { opacity:0; transform:translateY(-5px); } to { opacity:1; transform:translateY(0); } }
        .bcard { transition: box-shadow .18s, border-color .18s; }
        .bcard:hover { box-shadow: 0 4px 18px rgba(0,0,0,.08); }
        .abtn  { transition: opacity .15s, transform .1s; cursor:pointer; }
        .abtn:hover  { opacity:.86; }
        .abtn:active { transform:scale(.97); }
        .esc-row { transition: background .15s; cursor:pointer; }
        .esc-row:hover { background: var(--surface-2) !important; }
        .admin-cal { overflow:hidden; border:1px solid var(--border); border-radius:14px; background:var(--surface); }
        .admin-cal-head { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:12px; border-bottom:1px solid var(--border); flex-wrap:wrap; }
        .admin-cal-month { font-family:var(--font-head); font-size:15px; font-weight:800; color:var(--text); }
        .admin-cal-nav { width:28px; height:28px; border-radius:8px; border:1px solid var(--border); background:var(--surface-2); color:var(--text); cursor:pointer; display:inline-flex; align-items:center; justify-content:center; font-size:16px; line-height:1; }
        .admin-cal-today { border:1px solid rgba(22,163,74,.2); border-radius:20px; background:var(--accent-light); color:var(--accent-dim); font-size:10px; font-weight:800; padding:3px 9px; cursor:pointer; }
        .admin-cal-dow { display:grid; grid-template-columns:repeat(7,1fr); border-bottom:1px solid var(--border); }
        .admin-cal-dow div { text-align:center; padding:8px 2px; font-size:9px; font-weight:800; color:var(--text-muted); text-transform:uppercase; letter-spacing:.04em; }
        .admin-cal-grid { display:grid; grid-template-columns:repeat(7,1fr); }
        .admin-cal-cell { min-height:68px; padding:5px; border:0; border-right:1px solid var(--border); border-bottom:1px solid var(--border); background:var(--surface); text-align:left; cursor:pointer; overflow:hidden; }
        .admin-cal-cell:nth-child(7n) { border-right:none; }
        .admin-cal-cell.empty { background:var(--surface-2); cursor:default; }
        .admin-cal-cell:hover:not(.empty) { background:rgba(22,163,74,.03); }
        .admin-cal-cell.today { background:rgba(22,163,74,.04); }
        .admin-cal-date-row { display:flex; align-items:center; justify-content:space-between; margin-bottom:4px; }
        .admin-cal-date { width:20px; height:20px; display:inline-flex; align-items:center; justify-content:center; border-radius:50%; font-size:11px; font-weight:800; color:var(--text); }
        .admin-cal-cell.today .admin-cal-date { background:var(--accent); color:#fff; }
        .admin-cal-count { font-size:9px; font-weight:800; background:var(--accent); color:#fff; border-radius:20px; padding:1px 5px; }
        .admin-cal-chip { display:flex; align-items:center; gap:3px; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; border-left:2px solid; border-radius:3px; padding:2px 4px; font-size:8px; font-weight:800; margin-bottom:2px; }
        .admin-cal-chip.event { background:#FEF3C7; border-left-color:#D97706; color:#92400E; }
        .admin-modal-ov { position:fixed; inset:0; background:rgba(0,0,0,.35); z-index:9998; display:flex; align-items:center; justify-content:center; padding:16px; backdrop-filter:blur(3px); }
        .admin-modal { background:var(--surface); border:1px solid var(--border); border-radius:16px; padding:22px; width:100%; max-width:440px; max-height:85vh; overflow-y:auto; box-shadow:var(--shadow-lg); }
        @media (max-width:520px) { .admin-cal-cell { min-height:48px; padding:3px; } .admin-cal-chip { display:none; } .admin-cal-dow div { font-size:8px; } }
      `}</style>

      {toast && (
        <div style={{
          position: "fixed", top: 70, left: "50%", transform: "translateX(-50%)",
          background: "#0f172a", color: "#fff", padding: "10px 22px",
          borderRadius: 12, zIndex: 9999, fontSize: 13, fontWeight: 600,
          border: "1px solid rgba(20,184,166,0.3)",
          whiteSpace: "nowrap", animation: "fadeSlideIn .2s",
        }}>{toast}</div>
      )}

      <div className="page">
        <div style={{ marginBottom: 20, display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 3 }}>
              <h2 style={{ fontFamily: "var(--font-head)", fontSize: 22, fontWeight: 800, margin: 0 }}>Admin Dashboard</h2>
              <span style={{
                background: "rgba(231,76,60,0.1)", color: "var(--danger)",
                border: "1px solid rgba(231,76,60,0.28)",
                fontSize: 9, fontWeight: 800, padding: "3px 10px",
                borderRadius: 20, letterSpacing: ".08em",
              }}>CITY ADMIN</span>
            </div>
            <p className="text-muted text-sm">Lucena City · Citywide operations & monitoring</p>
          </div>
        </div>

        <div className="card" style={{ background: "var(--surface-3, #0f172a)", border: "1px solid rgba(255,255,255,0.06)", marginBottom: 20, padding: "20px 18px", position: "relative", overflow: "hidden" }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em", color: "rgba(255,255,255,0.45)", textTransform: "uppercase", marginBottom: 8 }}>Total Waste Collected Today</div>
          <div style={{ fontSize: 48, fontWeight: 800, lineHeight: 1, letterSpacing: -2, color: "#fff", marginBottom: 6 }}>
            {stats.total_waste || 0} <span style={{ fontSize: 26, fontWeight: 700 }}>KG</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {[
              { label: "BARANGAYS", value: stats.barangays_covered || 0, color: "#fff" },
              { label: "ESCALATIONS", value: escalations.length, color: "var(--danger)" },
              { label: "STATUS", value: "Operational", color: "var(--accent)" },
            ].map(s => (
              <div key={s.label} style={{ flex: 1, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "9px 12px" }}>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".08em", color: "rgba(255,255,255,0.4)", marginBottom: 4 }}>{s.label}</div>
                <div style={{ fontSize: typeof s.value === "string" ? 13 : 20, fontWeight: 800, color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="stat-grid" style={{ marginBottom: 20 }}>
          {[
            { label: "Open Reports", value: stats.pending_reports || 0, color: "var(--danger)" },
            { label: "Active Trucks", value: stats.active_trucks || 0, color: "var(--warning)" },
            { label: "Escalations", value: escalations.length, color: "var(--danger)" },
            { label: "Routes Done", value: stats.completed_routes || 0, color: "var(--accent)" },
          ].map(s => (
            <div key={s.label} className="stat-card">
              <div className="label">{s.label}</div>
              <div className="value" style={{ color: s.color, fontSize: 30 }}>{s.value}</div>
            </div>
          ))}
        </div>

        <div className="page-grid">
          <div>
            <div style={{ marginBottom: 24 }}>
              <h3 className="section-title">Live Map</h3>
              <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                <MiniMap />
              </div>
            </div>

            <div id="esc-panel" style={{ marginBottom: 24 }}>
              <h3 className="section-title">Escalation Queue</h3>
              {escalations.length === 0 ? (
                <div className="card" style={{ textAlign: "center", padding: 32 }}>No open escalations</div>
              ) : (
                escalations.slice(0, 5).map(e => (
                  <div key={e.id} className="bcard esc-row" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, marginBottom: 8, padding: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 3, height: 38, background: PRIORITY[e.priority]?.barColor || 'var(--accent)', borderRadius: 2 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>{e.title}</div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{e.type} · {e.report_count} reports · Brgy {e.barangay_name}</div>
                      </div>
                      <StatusBadge status={e.status} />
                    </div>
                  </div>
                ))
              )}
            </div>

            <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
              {["drivers", "hotspots", "chart"].map(t => (
                <button key={t} onClick={() => setMainTab(t)} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: mainTab === t ? "var(--surface-3)" : "var(--surface-2)", color: mainTab === t ? "#fff" : "var(--text-muted)", cursor: "pointer" }}>{t.toUpperCase()}</button>
              ))}
            </div>

            {mainTab === "drivers" && drivers.map(d => (
              <div key={d.id} className="bcard" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, marginBottom: 8, padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{d.plate_number}</div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{d.driver_name || 'No driver'} · {d.zone}</div>
                  </div>
                  <StatusBadge status={d.status} />
                </div>
              </div>
            ))}

            {mainTab === "hotspots" && hotspots.map(h => (
              <div key={h.id} className="bcard" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, marginBottom: 8, padding: 12 }}>
                <div style={{ fontWeight: 700 }}>{h.barangay_name}</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{h.type} · {h.count} reports</div>
              </div>
            ))}

            {mainTab === "chart" && <BarChart data={brgyWaste} />}

            <div style={{ marginTop: 24 }}>
              <h3 className="section-title">Activity Feed</h3>
              <div className="card">
                {feed.map((f, i) => (
                  <div key={i} style={{ padding: "10px 0", borderBottom: "1px solid var(--border)", display: "flex", gap: 10 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: FEED_DOT[f.action] || "#888", marginTop: 4 }} />
                    <div>
                      <div style={{ fontSize: 13 }}>{f.details}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{new Date(f.timestamp).toLocaleTimeString()} · {f.admin_name || 'System'}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="sidebar">
            <div className="card">
              <h3 className="section-title">Calendar</h3>
              {renderCalendar()}
            </div>
          </div>
        </div>
      </div>

      {calDayModal && (
        <div className="admin-modal-ov" onClick={e => { if (e.target === e.currentTarget) setCalDayModal(null) }}>
          <div className="admin-modal">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text-muted)', marginBottom: 3 }}>{calDayModal.cellDayName}</div>
                <h3 style={{ margin: 0, fontSize: 19, fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--font-head)' }}>{calDayModal.label}</h3>
              </div>
              <button onClick={() => setCalDayModal(null)} style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '5px 7px', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}><IcoX size={13} /></button>
            </div>

            {calDayModal.routes.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 9, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <IcoTruck size={11} color="var(--accent)" /> Route Schedules ({calDayModal.routes.length})
                </div>
                {calDayModal.routes.map(s => {
                  const tc = TRUCK_COLORS[getTruckColorIdx(s)];
                  return (
                    <div key={s.id} style={{ background: tc.bg, border: `1.5px solid ${tc.color}33`, borderRadius: 10, padding: '11px 13px', marginBottom: 7 }}>
                      <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--text)', marginBottom: 7 }}>{s.barangay_names || 'No barangays'}</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {s.truck_plate && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: tc.color, background: '#fff', borderRadius: 20, padding: '3px 9px', fontWeight: 700, border: `1px solid ${tc.color}30` }}><IcoTruck size={10} color={tc.color} />{s.truck_plate}</span>}
                        {s.driver_name && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-muted)', background: '#fff', borderRadius: 20, padding: '3px 9px', fontWeight: 700, border: '1px solid var(--border)' }}>{s.driver_name}</span>}
                        {s.start_time && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-muted)', background: '#fff', borderRadius: 20, padding: '3px 9px', fontWeight: 700, border: '1px solid var(--border)' }}><IcoClock size={10} color="var(--text-muted)" />{s.start_time.slice(0, 5)}-{s.end_time?.slice(0, 5)}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {calDayModal.events.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: '#D97706', marginBottom: 9, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <IcoCal size={11} color="#D97706" /> Events ({calDayModal.events.length})
                </div>
                {calDayModal.events.map(ev => (
                  <div key={ev.id} style={{ background: '#FFFBEB', border: '1.5px solid #FDE68A', borderRadius: 10, padding: '11px 13px', marginBottom: 7 }}>
                    <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--text)', marginBottom: 6 }}>{ev.title}</div>
                    {ev.location && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-muted)', background: '#fff', borderRadius: 20, padding: '3px 9px', fontWeight: 700, border: '1px solid var(--border)' }}><IcoPin size={10} color="var(--text-muted)" />{ev.location}</span>}
                  </div>
                ))}
              </div>
            )}

            {calDayModal.routes.length === 0 && calDayModal.events.length === 0 && (
              <div style={{ textAlign: 'center', padding: '24px 0' }}>
                <IcoCal size={34} color="var(--text-light)" />
                <div style={{ marginTop: 12, fontWeight: 800, fontSize: 14, color: 'var(--text-muted)' }}>Nothing scheduled</div>
                <div style={{ fontSize: 12, color: 'var(--text-light)', marginTop: 4 }}>No routes or events for this day.</div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
