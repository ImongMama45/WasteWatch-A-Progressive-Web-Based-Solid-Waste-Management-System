import { useState, useEffect, useMemo } from "react";
import MiniMap from "../../components/MiniMap";
import api from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import OnlineUsersList from '../../components/OnlineUsersList';

// ─── Priority config ──────────────────────────────────────────────────────────

const PRIORITY = {
  critical: { label: "Critical", barColor: "#DC2626", bgColor: "rgba(220,38,38,0.1)", borderColor: "rgba(220,38,38,0.3)", textColor: "#DC2626" },
  high: { label: "High", barColor: "#D97706", bgColor: "rgba(217,119,6,0.1)", borderColor: "rgba(217,119,6,0.3)", textColor: "#D97706" },
  medium: { label: "Medium", barColor: "#16A34A", bgColor: "rgba(22,163,74,0.1)", borderColor: "rgba(22,163,74,0.3)", textColor: "#16A34A" },
};

const FEED_DOT = { danger: "#DC2626", warning: "#D97706", success: "#16A34A", info: "#2563EB" };

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
const IcoRefresh = p => <Ico {...p} d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />;
const IcoDownload = p => <Ico {...p} d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />;
const IcoPlus = p => <Ico {...p} d="M12 5v14M5 12h14" />;
const IcoCheck = p => <Ico {...p} d="M20 6L9 17l-5-5" />;
const IcoChevronUp = p => <Ico {...p} d="M18 15l-6-6-6 6" />;
const IcoChevronDown = p => <Ico {...p} d="M6 9l6 6 6-6" />;

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const map = {
    completed: { label: "COMPLETED", color: "#16A34A", bg: "rgba(22,163,74,0.1)", border: "rgba(22,163,74,0.3)" },
    "in-progress": { label: "IN PROGRESS", color: "#D97706", bg: "rgba(217,119,6,0.1)", border: "rgba(217,119,6,0.3)" },
    issue: { label: "ISSUE", color: "#DC2626", bg: "rgba(220,38,38,0.1)", border: "rgba(220,38,38,0.3)" },
    pending: { label: "PENDING", color: "#D97706", bg: "rgba(217,119,6,0.1)", border: "rgba(217,119,6,0.3)" },
    validated: { label: "VALIDATED", color: "#16A34A", bg: "rgba(22,163,74,0.1)", border: "rgba(22,163,74,0.3)" },
  };
  const s = map[status] || { label: status?.toUpperCase() || 'UNKNOWN', color: "#6B7280", bg: "#F3F4F6", border: "#E5E7EB" };
  return (
    <span style={{
      background: s.bg, border: `1px solid ${s.border}`, color: s.color,
      borderRadius: 4, padding: "2px 6px",
      fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", whiteSpace: "nowrap",
    }}>{s.label}</span>
  );
}

function SeverityDot({ severity }) {
  const colors = { high: "#DC2626", medium: "#D97706", low: "#16A34A" };
  return (
    <span style={{
      display: "inline-block", width: 8, height: 8, borderRadius: "50%",
      background: colors[severity] || "#9CA3AF",
      marginRight: 6, flexShrink: 0,
    }} />
  );
}

function PhaseIndicator({ phase, size = 8 }) {
  const map = {
    navigate_to_base: { color: '#3B82F6', pulse: true,  title: 'Navigating to base'  },
    confirm_start:    { color: '#22C55E', pulse: true,  title: 'Confirming start'     },
    checkin:          { color: '#22C55E', pulse: true,  title: 'Checking in'          },
    shiftroute:       { color: '#22C55E', pulse: false, title: 'On route'             },
    on_route:         { color: '#22C55E', pulse: false, title: 'On route'             },
    end_shift:        { color: '#EAB308', pulse: true,  title: 'Ending shift'         },
    completed:        { color: '#22C55E', pulse: false, title: 'Completed', check: true },
  }
  const cfg = map[phase] || { color: '#9CA3AF', pulse: false, title: 'Offline' }

  if (cfg.check) {
    return (
      <span title={cfg.title} style={{
        width: size + 4, height: size + 4, borderRadius: '50%',
        background: cfg.color, color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: size * 0.7, fontWeight: 700, flexShrink: 0,
      }}>✓</span>
    )
  }

  return (
    <span title={cfg.title} className={cfg.pulse ? 'pulse' : ''} style={{
      width: size, height: size, borderRadius: '50%',
      background: cfg.color, flexShrink: 0,
    }} />
  )
}

function BarChart({ data }) {
  if (!data.length) return <div className="empty-state"><IcoCheck size={24} color="#16A34A" /><div style={{ marginTop: 8 }}>No data available</div></div>
  const max = Math.max(...data.map(d => d.kg || 0), 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 280, padding: "16px 8px 0" }}>
      {data.map((d, i) => (
        <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 10, color: "#6B7280", fontWeight: 700 }}>{d.kg}</span>
          <div style={{
            width: "100%", height: Math.max(Math.round(((d.kg || 0) / max) * 200), 4),
            background: d.status === 'issue' ? "#DC2626" : "#16A34A", borderRadius: "4px 4px 0 0",
          }} />
          <span style={{ fontSize: 10, color: "#6B7280", textAlign: "center", lineHeight: 1.2, width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {d.name?.replace('Barangay ', '').split(" ")[0]}
          </span>
        </div>
      ))}
    </div>
  );
}

const FILL_LABELS = {
  nearly_empty: { label: 'Nearly Empty', color: '#16A34A', bg: 'rgba(22,163,74,0.1)' },
  quarter: { label: 'Quarter', color: '#16A34A', bg: 'rgba(22,163,74,0.1)' },
  half: { label: 'Half', color: '#D97706', bg: 'rgba(217,119,6,0.1)' },
  three_quarters: { label: 'Three Quarters', color: '#D97706', bg: 'rgba(217,119,6,0.1)' },
  full: { label: 'Full', color: '#B45309', bg: 'rgba(180,83,9,0.1)' },
  overflowing: { label: 'Overflowing', color: '#DC2626', bg: 'rgba(220,38,38,0.1)' },
};

function FillBadge({ level }) {
  const f = FILL_LABELS[level];
  if (!f) return <span style={{ color: '#9CA3AF', fontSize: 12 }}>—</span>;
  return (
    <span style={{
      background: f.bg, color: f.color, border: `1px solid ${f.color}44`,
      borderRadius: 4, padding: '2px 6px', fontSize: 10, fontWeight: 700,
    }}>{f.label}</span>
  );
}

export default function AdminDashboard() {
  const { user } = useAuth();

  const [mainTab, setMainTab] = useState("drivers");
  const [expandedDriver, setExpandedDriver] = useState(null);
  const [expandedEsc, setExpandedEsc] = useState(null);

  const [stats, setStats] = useState({ total_waste: 0, active_trucks: 0, completed_routes: 0, total_routes: 0, pending_reports: 0 });
  const [escalations, setEscalations] = useState([]);
  const [hotspots, setHotspots] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [logs, setLogs] = useState([]);
  const [feed, setFeed] = useState([]);
  const [brgyWaste, setBrgyWaste] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [calendarEvents, setCalendarEvents] = useState([]);
  const [activeShifts, setActiveShifts] = useState([]);

  const [calDayModal, setCalDayModal] = useState(null);
  const [calMonth, setCalMonth] = useState(() => new Date().getMonth());
  const [isRouteProgressExpanded, setIsRouteProgressExpanded] = useState(true);
  const [truckFilter, setTruckFilter] = useState('');
  const [calYear, setCalYear] = useState(() => new Date().getFullYear());

  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [apiHealth, setApiHealth] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const [routeDisplayMode, setRouteDisplayMode] = useState('all');
  const [mapFocus, setMapFocus] = useState(null);

  const fetchData = async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    let health = true;
    try {
      const [st, esc, hs, dr, fd, bw, sc, ce, wd, ash] = await Promise.all([
        api.get('/api/public/stats/').catch(() => { health = false; return { data: {} }; }),
        api.get('/api/watcher/escalations/').catch(() => { health = false; return { data: [] }; }),
        api.get('/api/watcher/hotspots/').catch(() => { health = false; return { data: [] }; }),
        api.get('/api/driver/trucks/').catch(() => { health = false; return { data: [] }; }),
        api.get('/api/analytics/activity-logs/').catch(() => { health = false; return { data: [] }; }),
        api.get('/api/analytics/barangay-performance/').catch(() => { health = false; return { data: [] }; }),
        api.get('/api/driver/collection-schedules/').catch(() => { health = false; return { data: [] }; }),
        api.get('/api/driver/calendar-events/').catch(() => { health = false; return { data: [] }; }),
        api.get('/api/dumpsite/waste-deliveries/').catch(() => { health = false; return { data: [] }; }),
        api.get('/api/driver/shift/active_shifts/').catch(() => { health = false; return { data: [] }; }),
      ]);
      if (st.data) setStats(prev => ({ ...prev, ...st.data }));
      if (esc.data) setEscalations(esc.data);
      if (hs.data) setHotspots(hs.data.sort((a, b) => (b.report_count || 0) - (a.report_count || 0)));
      if (dr.data) setDrivers(dr.data);
      if (fd.data) setFeed(fd.data.slice(0, 8));
      if (bw.data) setBrgyWaste(bw.data.map(b => ({ name: b.barangay_name, kg: b.waste_collected_kg, status: b.resolved >= b.reports ? 'completed' : 'in-progress' })));
      if (sc.data) setSchedule(sc.data);
      if (ce.data) setCalendarEvents(ce.data);
      if (wd.data) setLogs(wd.data.results || wd.data || []);
      if (ash.data) setActiveShifts(ash.data);
      setApiHealth(health);
      setLastRefreshed(new Date());
    } finally {
      if (!isSilent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const intv = setInterval(() => {
      fetchData(true);
    }, 15000); // Poll every 15 seconds for real-time tracking
    return () => clearInterval(intv);
  }, []);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 3200);
  }

  async function resolveEscalation(id) {
    try {
      await api.post(`/api/watcher/escalations/${id}/resolve/`)
      setEscalations(prev => prev.filter(e => e.id !== id));
      showToast("Escalation resolved.");
    } catch { showToast("Failed to resolve.") }
  }

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
      dateStr, cellDayName,
      label: new Date(calYear, calMonth, d).toLocaleDateString('default', { month: 'long', day: 'numeric', year: 'numeric' }),
      routes, events,
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
      <div className="cal-container">
        <div className="cal-head">
          <button className="cal-nav" onClick={calNavPrev}>‹</button>
          <span className="cal-month">{monthLabel}</span>
          <button className="cal-nav" onClick={calNavNext}>›</button>
        </div>
        <div className="cal-dow">{dayAbbr.map(d => <div key={d}>{d}</div>)}</div>
        <div className="cal-grid">
          {cells.map((d, i) => {
            if (!d) return <div key={i} className="cal-cell empty" />;
            const cellDate = new Date(calYear, calMonth, d);
            const cellDayName = dayFull[cellDate.getDay()];
            const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const dayRoutes = schedule.filter(s => routeMatchesDay(s, cellDayName));
            const dayEvents = calendarEvents.filter(e => e.date === dateStr);
            const isToday = isCurrentMonth && d === today.getDate();

            return (
              <button key={i} className={`cal-cell ${isToday ? 'today' : ''}`} onClick={() => openCalDayModal(d, dateStr, cellDayName, dayRoutes, dayEvents)}>
                <span className="cal-date">{d}</span>
                <div className="cal-dots">
                  {dayRoutes.slice(0, 3).map(s => {
                    const tc = TRUCK_COLORS[getTruckColorIdx(s)];
                    return <span key={`r-${s.id}`} className="cal-dot" style={{ background: tc.color }} />
                  })}
                  {dayEvents.slice(0, 1).map(ev => <span key={`e-${ev.id}`} className="cal-dot" style={{ background: '#D97706' }} />)}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  const criticalCount = escalations.filter(e => e.priority === "critical").length;

  const todayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date().getDay()];
  const todaysRoutes = schedule.filter(s => routeMatchesDay(s, todayName));

  const mergedTrucks = useMemo(() => {
    return drivers.map(truck => {
      const route = todaysRoutes.find(
        s => String(s.truck) === String(truck.id)
      )
      const activeShift = activeShifts.find(
        sh => String(sh.truck) === String(truck.id)
      )
      const phase = activeShift?.phase_status
        || route?.truck_status
        || 'offline'

      const totalStops = route?.total_stops || 0
      const completedStops = route?.completed_stops || 0
      const progressPct = totalStops === 0
        ? 0
        : Math.round((completedStops / totalStops) * 100)

      return {
        // truck fields
        id: truck.id,
        plate: truck.plate_number,
        zone: truck.zone,
        driverNames: truck.driver_details?.length ? truck.driver_details.map(x => x.full_name).join(', ') : 'No driver',
        // route fields
        hasRouteToday: !!route,
        barangayNames: route?.barangay_names || '',
        startTime: route?.start_time,
        endTime: route?.end_time,
        totalStops,
        completedStops,
        progressPct,
        // shift fields
        hasActiveShift: !!activeShift,
        phase,
      }
    })
  }, [drivers, todaysRoutes, activeShifts])

  const filteredTrucks = useMemo(() => {
    let result = mergedTrucks
    if (truckFilter) {
      const q = truckFilter.toLowerCase()
      result = result.filter(t =>
        t.plate?.toLowerCase().includes(q) ||
        t.barangayNames?.toLowerCase().includes(q) ||
        t.driverNames?.toLowerCase().includes(q)
      )
    }
    return [...result].sort((a, b) => {
      if (a.hasActiveShift !== b.hasActiveShift) return a.hasActiveShift ? -1 : 1
      if (a.hasRouteToday !== b.hasRouteToday) return a.hasRouteToday ? -1 : 1
      return (a.plate || '').localeCompare(b.plate || '')
    })
  }, [mergedTrucks, truckFilter])

  return (
    <>
      <style>{`
        :root {
          --ui-border: #E2E8F0;
          --ui-surface: #ffffff;
          --ui-bg: #F8FAFC;
          --ui-text: #111827;
          --ui-text-muted: #6B7280;
        }
        body { background: var(--ui-bg); margin: 0; padding: 0; font-family: system-ui, -apple-system, sans-serif; }
        .dashboard-container { padding: 24px; max-width: 1440px; margin: 0 auto; color: var(--ui-text); }
        
        .flat-card {
          background: var(--ui-surface);
          border: 0.5px solid var(--ui-border);
          border-radius: 12px;
          padding: 14px 16px;
          transition: transform 0.15s ease, box-shadow 0.15s ease;
        }
        .flat-card.hoverable:hover {
          transform: scale(1.015);
          box-shadow: 0 4px 16px rgba(0,0,0,0.07);
        }

        .header-row { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
        .quick-actions { display: flex; gap: 8px; }
        .action-btn {
          display: inline-flex; align-items: center; gap: 6px;
          background: var(--ui-surface); border: 0.5px solid var(--ui-border);
          padding: 8px 12px; border-radius: 8px; font-size: 13px; font-weight: 500;
          color: var(--ui-text); cursor: pointer; transition: background 0.1s;
        }
        .action-btn:hover { background: #F1F5F9; }

        .kpi-ribbon {
          display: grid; grid-template-columns: repeat(6, 1fr); gap: 16px; margin-bottom: 24px;
        }
        .kpi-card { display: flex; flex-direction: column; position: relative; overflow: hidden; }
        .kpi-card-left-border {
          position: absolute; left: 0; top: 0; bottom: 0; width: 4px;
        }
        .kpi-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--ui-text-muted); margin-bottom: 4px; }
        .kpi-val { font-size: 28px; font-weight: 800; color: var(--ui-text); line-height: 1.1; }
        .kpi-trend { font-size: 12px; font-weight: 500; margin-top: 4px; color: var(--ui-text-muted); }

        .map-section {
          width: 100%; height: 420px; border-radius: 12px; overflow: hidden;
          border: 0.5px solid var(--ui-border); margin-bottom: 24px;
        }

        .route-progress-panel { margin-bottom: 24px; }
        .progress-row {
          display: flex; align-items: center; justify-content: space-between; gap: 16px;
          padding: 12px 16px; background: var(--ui-surface); border: 0.5px solid var(--ui-border);
          border-radius: 8px; margin-bottom: 8px;
        }
        .progress-bar-container { flex: 1; height: 8px; background: #E2E8F0; border-radius: 4px; overflow: hidden; }
        .progress-bar-fill { height: 100%; border-radius: 4px; }

        .main-grid { display: grid; grid-template-columns: 65% 1fr; gap: 24px; }

        .tab-nav {
          display: flex; gap: 8px; margin-bottom: 16px; overflow-x: auto; padding-bottom: 4px;
        }
        .tab-pill {
          padding: 8px 16px; border-radius: 20px; font-size: 13px; font-weight: 600;
          cursor: pointer; transition: background 0.15s, color 0.15s; border: none;
        }
        .tab-panel {
          max-height: 360px; overflow-y: auto; padding-right: 4px;
          animation: fadeTab 150ms ease-in-out;
        }
        @keyframes fadeTab { from { opacity: 0; } to { opacity: 1; } }

        .sidebar-section { margin-bottom: 24px; }
        .sidebar-title { font-size: 14px; font-weight: 800; color: var(--ui-text); margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.05em; }

        .esc-row { display: flex; flex-direction: column; gap: 8px; position: relative; padding-left: 20px; }
        .esc-dot {
          position: absolute; left: 16px; top: 16px; width: 6px; height: 6px; border-radius: 50%;
        }
        @keyframes pulseAlert {
          0% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.3; transform: scale(1.5); }
          100% { opacity: 1; transform: scale(1); }
        }
        .pulse { animation: pulseAlert 2s infinite; }

        .cal-container { border: 0.5px solid var(--ui-border); border-radius: 12px; background: var(--ui-surface); overflow: hidden; }
        .cal-head { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 0.5px solid var(--ui-border); }
        .cal-nav { background: none; border: none; font-size: 16px; cursor: pointer; color: var(--ui-text-muted); }
        .cal-month { font-size: 14px; font-weight: 800; }
        .cal-dow { display: grid; grid-template-columns: repeat(7, 1fr); text-align: center; font-size: 10px; font-weight: 700; color: var(--ui-text-muted); padding: 8px 0; border-bottom: 0.5px solid var(--ui-border); text-transform: uppercase; }
        .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); }
        .cal-cell { padding: 8px 4px; min-height: 54px; display: flex; flex-direction: column; align-items: center; border: none; border-right: 0.5px solid var(--ui-border); border-bottom: 0.5px solid var(--ui-border); background: var(--ui-surface); cursor: pointer; }
        .cal-cell:nth-child(7n) { border-right: none; }
        .cal-cell.empty { background: #F8FAFC; cursor: default; }
        .cal-cell:hover:not(.empty) { background: #F1F5F9; }
        .cal-date { font-size: 12px; font-weight: 600; color: var(--ui-text); margin-bottom: 4px; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; border-radius: 50%; }
        .cal-cell.today .cal-date { background: #16A34A; color: white; }
        .cal-dots { display: flex; gap: 3px; justify-content: center; flex-wrap: wrap; }
        .cal-dot { width: 6px; height: 6px; border-radius: 50%; }

        .status-footer { display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--ui-text-muted); margin-top: 24px; padding-top: 16px; border-top: 0.5px solid var(--ui-border); }
        
        .empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 32px 16px; text-align: center; color: var(--ui-text-muted); font-size: 13px; font-weight: 500; }

        .admin-modal-ov { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 9998; display: flex; align-items: center; justify-content: center; padding: 16px; }
        .admin-modal { background: var(--ui-surface); border-radius: 12px; padding: 24px; width: 100%; max-width: 440px; max-height: 85vh; overflow-y: auto; }

        @media (max-width: 768px) {
          .kpi-ribbon { grid-template-columns: 1fr 1fr; }
          .map-section { height: 260px; }
          .main-grid { grid-template-columns: 1fr; }
          .cal-dot { width: 4px; height: 4px; }
          .cal-cell { min-height: 44px; }
        }
      `}</style>

      {toast && (
        <div style={{
          position: "fixed", top: 24, left: "50%", transform: "translateX(-50%)",
          background: "#111827", color: "#fff", padding: "12px 24px",
          borderRadius: 8, zIndex: 9999, fontSize: 13, fontWeight: 600,
        }}>{toast}</div>
      )}

      <div className="dashboard-container">

        {/* HEADER */}
        <div className="header-row">
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, margin: "0 0 4px 0", display: "flex", alignItems: "center", gap: 12 }}>
              Admin Dashboard
              <span style={{ fontSize: 10, background: "#FEF2F2", color: "#DC2626", padding: "2px 8px", borderRadius: 4, border: "0.5px solid #FCA5A5" }}>CITY ADMIN</span>
            </h1>
            <p style={{ fontSize: 13, color: "var(--ui-text-muted)", margin: 0 }}>Lucena City · Live Operations Monitor</p>
          </div>
          <div className="quick-actions">
            <button className="action-btn" onClick={() => fetchData(false)}><IcoRefresh size={14} /> Refresh</button>
            <button className="action-btn" onClick={() => showToast("Export coming soon")}><IcoDownload size={14} /> Export</button>
            <button className="action-btn" onClick={() => showToast("Add Event coming soon")}><IcoPlus size={14} /> Add Event</button>
          </div>
        </div>

        {/* KPI RIBBON */}
        <div className="kpi-ribbon">
          <div className="flat-card kpi-card">
            <div className="kpi-card-left-border" style={{ background: "#16A34A" }} />
            <div className="kpi-label">Total Waste Today</div>
            <div className="kpi-val" style={{ fontSize: 32 }}>{stats.total_waste || 0} <span style={{ fontSize: 16 }}>KG</span></div>
            <div className="kpi-trend">↑ Tracking normal</div>
          </div>
          <div className="flat-card kpi-card">
            <div className="kpi-card-left-border" style={{ background: "#2563EB" }} />
            <div className="kpi-label">Online Trucks</div>
            <div className="kpi-val">{stats.online_trucks || 0} <span style={{ fontSize: 14, color: "#6B7280" }}>/{stats.total_trucks || 0}</span></div>
            <div className="kpi-trend">Fleet deployment active</div>
          </div>
          <div className="flat-card kpi-card">
            <div className="kpi-card-left-border" style={{ background: "#8B5CF6" }} />
            <div className="kpi-label">Online Watchers</div>
            <div className="kpi-val">{stats.active_watchers || 0} <span style={{ fontSize: 14, color: "#6B7280" }}>/{stats.total_watchers || 0}</span></div>
            <div className="kpi-trend">Ground monitoring</div>
          </div>
          <div className="flat-card kpi-card">
            <div className="kpi-card-left-border" style={{ background: "#14B8A6" }} />
            <div className="kpi-label">Online Officials</div>
            <div className="kpi-val">{stats.active_officials || 0} <span style={{ fontSize: 14, color: "#6B7280" }}>/{stats.total_officials || 0}</span></div>
            <div className="kpi-trend">Local leadership</div>
          </div>
          <div className="flat-card kpi-card">
            <div className="kpi-card-left-border" style={{ background: criticalCount > 0 ? "#DC2626" : "#E2E8F0" }} />
            <div className="kpi-label">Critical Escalations</div>
            <div className="kpi-val" style={{ color: criticalCount > 0 ? "#DC2626" : "var(--ui-text)" }}>{criticalCount}</div>
            <div className="kpi-trend" style={{ color: criticalCount > 0 ? "#DC2626" : "var(--ui-text-muted)" }}>{criticalCount > 0 ? "Requires immediate action" : "All clear"}</div>
          </div>
          <div className="flat-card kpi-card">
            <div className="kpi-card-left-border" style={{ background: "#D97706" }} />
            <div className="kpi-label">Routes Done Today</div>
            <div className="kpi-val">{stats.completed_routes || 0} <span style={{ fontSize: 14, color: "#6B7280" }}>/ {todaysRoutes.length || stats.total_routes || 0}</span></div>
            <div className="kpi-trend">Shift progress</div>
          </div>
        </div>

        {/* DOMINANT MAP */}
        <div className="map-section">
          <MiniMap focusCoordinate={mapFocus} />
        </div>

        {/* BELOW MAP: 65 / 35 GRID */}
        <div className="main-grid">

          {/* LEFT COLUMN */}
          <div>
            {/* ROUTE PROGRESS PANEL */}
            {todaysRoutes.length > 0 && (
              <div className="route-progress-panel">
                <div
                  className="sidebar-title"
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                  onClick={() => setIsRouteProgressExpanded(!isRouteProgressExpanded)}
                >
                  <div>Today's Route Progress ({todaysRoutes.length})</div>
                  <div style={{ color: 'var(--ui-text-muted)', display: 'flex', alignItems: 'center' }}>
                    {isRouteProgressExpanded ? <IcoChevronUp size={16} /> : <IcoChevronDown size={16} />}
                  </div>
                </div>

                {isRouteProgressExpanded && (
                  <>
                    {/* Single shared filter — lives here, controls both panels */}
                    <div style={{ display: 'flex', gap: 8, marginBottom: 12, marginTop: 12 }}>
                      <input
                        type="text"
                        placeholder="Filter by truck, barangay, or driver..."
                        value={truckFilter}
                        onChange={e => setTruckFilter(e.target.value)}
                        style={{
                          flex: 1, padding: '8px 12px', borderRadius: '6px',
                          border: '1px solid var(--ui-border)',
                          background: 'var(--ui-surface)',
                          color: 'var(--ui-text)', fontSize: 13,
                        }}
                      />
                      <select
                        value={routeDisplayMode}
                        onChange={e => setRouteDisplayMode(e.target.value)}
                        style={{
                          padding: '8px 12px', borderRadius: '6px',
                          border: '1px solid var(--ui-border)',
                          fontSize: 13, cursor: 'pointer',
                          background: 'var(--ui-surface)', color: 'var(--ui-text)'
                        }}
                      >
                        <option value="all">All Trucks</option>
                        <option value="today">Today's Routes Only</option>
                      </select>
                    </div>

                    <div style={{ maxHeight: 200, overflowY: 'auto', paddingRight: 4 }}>
                      {(routeDisplayMode === 'today'
                        ? filteredTrucks.filter(t => t.hasRouteToday)
                        : filteredTrucks
                      ).map(t => (
                        <div key={t.id} className="progress-row"
                          style={{ opacity: !t.hasActiveShift && !t.hasRouteToday ? 0.5 : 1 }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: 220 }}>
                            <PhaseIndicator phase={t.phase} size={8} />
                            <span style={{
                              fontSize: 13, fontWeight: 700,
                              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            }}>
                              {t.plate} · {t.barangayNames?.split(',')[0] || 'Unassigned'}
                            </span>
                          </div>
                          <div className="progress-bar-container">
                            <div className="progress-bar-fill" style={{
                              width: `${t.progressPct}%`,
                              background: t.hasRouteToday
                                ? TRUCK_COLORS[
                                    mergedTrucks.findIndex(m => m.id === t.id) % TRUCK_COLORS.length
                                  ].color
                                : '#9CA3AF',
                            }} />
                          </div>
                          <div style={{
                            fontSize: 12, fontWeight: 600, color: '#6B7280',
                            width: 130, textAlign: 'right', whiteSpace: 'nowrap',
                          }}>
                            {t.hasRouteToday
                              ? `${t.completedStops} / ${t.totalStops} — ${t.progressPct}%`
                              : 'Off duty'
                            }
                          </div>
                        </div>
                      ))}

                      {filteredTrucks.length === 0 && (
                        <div style={{ padding: '12px 0', fontSize: 13,
                          color: 'var(--ui-text-muted)', textAlign: 'center' }}>
                          No trucks match "{truckFilter}"
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* OPERATIONAL TABS */}
            <div className="tab-nav">
              {["drivers", "feed", "chart", "logs"].map(t => {
                const labels = { drivers: "Fleet Status", feed: "Activity Feed", chart: "Barangay Chart", logs: "Dumpsite Logs" };
                const active = mainTab === t;
                return (
                  <button key={t} className="tab-pill" onClick={() => setMainTab(t)} style={{
                    background: active ? "#16A34A" : "transparent",
                    color: active ? "#fff" : "#6B7280",
                  }}>
                    {labels[t]}
                  </button>
                );
              })}
            </div>

            <div className="tab-panel">
              {mainTab === "drivers" && (
                // No filter input here — it's shared above in Route Progress
                // truckFilter is already applied via filteredTrucks
                <div>
                  {filteredTrucks.length === 0
                    ? <div className="empty-state">
                        <IcoCheck size={24} color="#16A34A" />
                        <div style={{ marginTop: 8 }}>No trucks match filter</div>
                      </div>
                    : filteredTrucks.map(t => {
                        let statusText = 'Offline / No schedule'
                        if (t.hasActiveShift) {
                          const labels = {
                            navigate_to_base: 'Navigating to base',
                            confirm_start:    'At base — confirming',
                            checkin:          'Checking in',
                            shiftroute:       'On route',
                            on_route:         'On route',
                            end_shift:        'Ending shift',
                            completed:        'Completed',
                          }
                          statusText = labels[t.phase] || 'Active shift'
                        } else if (t.hasRouteToday) {
                          statusText = 'Scheduled today — offline'
                        }

                        return (
                          <div key={t.id}
                            className="flat-card hoverable"
                            style={{
                              marginBottom: 8,
                              display: 'flex', justifyContent: 'space-between',
                              alignItems: 'center',
                              opacity: !t.hasActiveShift && !t.hasRouteToday ? 0.5 : 1,
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                              <PhaseIndicator phase={t.phase} size={12} />
                              <div>
                                <div style={{ fontWeight: 800, fontSize: 14 }}>{t.plate}</div>
                                <div style={{ fontSize: 12, color: 'var(--ui-text-muted)', marginTop: 2 }}>
                                  {t.driverNames} · {t.barangayNames?.split(',')[0] || t.zone || 'Unassigned'}
                                </div>
                              </div>
                            </div>
                            <div style={{
                              fontSize: 11, fontWeight: 700,
                              color: 'var(--ui-text-muted)',
                              textTransform: 'uppercase', letterSpacing: '0.05em',
                            }}>
                              {statusText}
                            </div>
                          </div>
                        )
                      })
                  }
                </div>
              )}

              {mainTab === "feed" && (feed.length === 0 ? <div className="empty-state"><IcoCheck size={24} color="#16A34A" /><div style={{ marginTop: 8 }}>All clear — no recent activity</div></div> : feed.map((f, i) => (
                <div key={i} className="flat-card" style={{ marginBottom: 8, display: "flex", gap: 12, padding: "12px 16px" }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: FEED_DOT[f.action] || "#9CA3AF", marginTop: 5, flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{f.details}</div>
                    <div style={{ fontSize: 11, color: "var(--ui-text-muted)", marginTop: 4 }}>
                      {new Date(f.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {f.admin_name || 'System'}
                    </div>
                  </div>
                </div>
              )))}

              {mainTab === "chart" && (
                <div className="flat-card"><BarChart data={brgyWaste} /></div>
              )}

              {mainTab === "logs" && (logs.length === 0 ? <div className="empty-state"><IcoCheck size={24} color="#16A34A" /><div style={{ marginTop: 8 }}>No delivery logs available</div></div> : logs.map(l => (
                <div key={l.id} className="flat-card hoverable" style={{ marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 14 }}>{l.truck_plate} — {l.dumpsite_name}</div>
                    <div style={{ fontSize: 12, color: "var(--ui-text-muted)", marginTop: 2 }}>
                      {l.driver_name} · <span style={{ fontWeight: 700, color: "var(--ui-text)" }}>{l.estimated_kg} kg</span> · {new Date(l.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                  <FillBadge level={l.fill_level} />
                </div>
              )))}
            </div>
          </div>

          {/* RIGHT COLUMN */}
          <div>
            {/* ESCALATIONS */}
            <div className="sidebar-section">
              <div className="sidebar-title">Escalation Queue</div>
              {escalations.length === 0 ? (
                <div className="empty-state flat-card">
                  <IcoCheck size={24} color="#16A34A" />
                  <div style={{ marginTop: 8 }}>All clear — no open escalations</div>
                </div>
              ) : (
                escalations.slice(0, 4).map(e => (
                  <div key={e.id} className="flat-card hoverable esc-row" style={{ marginBottom: 8, padding: "14px 16px 14px 28px" }}>
                    <div className={`esc-dot ${e.priority === 'critical' ? 'pulse' : ''}`} style={{ background: PRIORITY[e.priority]?.barColor || '#9CA3AF' }} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ paddingRight: 8 }}>
                        <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 4 }}>{e.title}</div>
                        <div style={{ fontSize: 11, color: "var(--ui-text-muted)", marginBottom: 8 }}>
                          Brgy {e.barangay_name} · {e.report_count} reports
                        </div>
                        <StatusBadge status={e.status} />
                      </div>
                      <button onClick={() => resolveEscalation(e.id)} style={{
                        background: "transparent", border: "0.5px solid var(--ui-border)", borderRadius: 6,
                        padding: "4px 8px", fontSize: 11, fontWeight: 600, cursor: "pointer", color: "var(--ui-text)"
                      }}>Resolve</button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* ONLINE USERS */}
            <OnlineUsersList />

            {/* CALENDAR */}
            <div className="sidebar-section">
              <div className="sidebar-title">Schedule</div>
              {renderCalendar()}
            </div>

            {/* HOTSPOTS */}
            <div className="sidebar-section">
              <div className="sidebar-title">Hotspot Alerts</div>
              {hotspots.length === 0 ? (
                <div className="empty-state flat-card">
                  <IcoCheck size={24} color="#16A34A" />
                  <div style={{ marginTop: 8 }}>All clear — no hotspots</div>
                </div>
              ) : (
                hotspots.slice(0, 3).map(h => (
                  <div key={h.id} className="flat-card hoverable" style={{ marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", marginTop: 4 }}>
                      <div style={{ marginTop: 6 }}><SeverityDot severity={h.severity?.toLowerCase()} /></div>
                      <div>
                        <div style={{ fontWeight: 800, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                          Brgy {h.barangay_name}
                          <span style={{ fontSize: 9, background: '#FEF2F2', color: '#DC2626', padding: '2px 4px', borderRadius: 4, border: '0.5px solid #FCA5A5', fontWeight: 700 }}>UNRESOLVED</span>
                        </div>
                        <div style={{ fontSize: 11, color: "var(--ui-text-muted)", marginTop: 2 }}>
                          {h.report_count} reports · System Generated
                        </div>
                        <div style={{ fontSize: 10, color: "var(--ui-text-muted)", marginTop: 2 }}>
                          {new Date(h.created_at).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    </div>
                    <button style={{
                      background: "#F1F5F9", border: "none", borderRadius: 6,
                      padding: "4px 8px", fontSize: 11, fontWeight: 600, cursor: "pointer", color: "#2563EB"
                    }} onClick={() => {
                      setMapFocus({ lat: h.latitude || h.lat, lng: h.longitude || h.lng, zoom: 16 });
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}>Map</button>
                  </div>
                ))
              )}
            </div>

            {/* SYSTEM STATUS FOOTER */}
            <div className="status-footer">
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: apiHealth ? "#16A34A" : "#DC2626" }} />
              <span>{apiHealth ? "Systems Operational" : "API degraded"}</span>
              <span style={{ marginLeft: "auto" }}>
                Updated {lastRefreshed ? lastRefreshed.toLocaleTimeString() : '...'}
              </span>
            </div>

          </div>
        </div>
      </div>

      {calDayModal && (
        <div className="admin-modal-ov" onClick={e => { if (e.target === e.currentTarget) setCalDayModal(null) }}>
          <div className="admin-modal">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--ui-text-muted)', marginBottom: 4 }}>{calDayModal.cellDayName}</div>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{calDayModal.label}</h3>
              </div>
              <button onClick={() => setCalDayModal(null)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ui-text-muted)' }}><IcoX size={16} /></button>
            </div>

            {calDayModal.routes.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: '#16A34A', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <IcoTruck size={12} color="#16A34A" /> Route Schedules ({calDayModal.routes.length})
                </div>
                {calDayModal.routes.map(s => {
                  const tc = TRUCK_COLORS[getTruckColorIdx(s)];
                  return (
                    <div key={s.id} className="flat-card" style={{ marginBottom: 8, borderLeft: `4px solid ${tc.color}` }}>
                      <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 8 }}>{s.barangay_names || 'No barangays'}</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {s.truck_plate && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: tc.color, background: tc.bg, borderRadius: 4, padding: '2px 6px', fontWeight: 700 }}><IcoTruck size={10} color={tc.color} />{s.truck_plate}</span>}
                        {s.driver_name && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--ui-text-muted)', background: '#F1F5F9', borderRadius: 4, padding: '2px 6px', fontWeight: 600 }}>{s.driver_name}</span>}
                        {s.start_time && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--ui-text-muted)', background: '#F1F5F9', borderRadius: 4, padding: '2px 6px', fontWeight: 600 }}><IcoClock size={10} color="var(--ui-text-muted)" />{s.start_time.slice(0, 5)}-{s.end_time?.slice(0, 5)}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {calDayModal.events.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: '#D97706', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <IcoCal size={12} color="#D97706" /> Events ({calDayModal.events.length})
                </div>
                {calDayModal.events.map(ev => (
                  <div key={ev.id} className="flat-card" style={{ marginBottom: 8, borderLeft: '4px solid #D97706' }}>
                    <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 6 }}>{ev.title}</div>
                    {ev.location && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--ui-text-muted)', background: '#F1F5F9', borderRadius: 4, padding: '2px 6px', fontWeight: 600 }}><IcoPin size={10} color="var(--ui-text-muted)" />{ev.location}</span>}
                  </div>
                ))}
              </div>
            )}

            {calDayModal.routes.length === 0 && calDayModal.events.length === 0 && (
              <div className="empty-state">
                <IcoCal size={34} color="#9CA3AF" />
                <div style={{ marginTop: 12, fontWeight: 800, fontSize: 14 }}>Nothing scheduled</div>
                <div style={{ fontSize: 12, marginTop: 4 }}>No routes or events for this day.</div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
