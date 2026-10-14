import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useHotspots } from "../../hooks/useHotspots";
import { useEscalations } from "../../hooks/useEscalations";
import { getTruckColor } from "../../utils/truckColors";
import { classifyShift } from "../../utils/shiftState";
import MiniMap from "../../components/MiniMap";
import api from "../../api/client";
import OnlineUsersList from '../../components/OnlineUsersList';

// ─── Priority config ──────────────────────────────────────────────────────────

const PRIORITY = {
  high: { label: "High", color: "#DC2626" },
  medium: { label: "Medium", color: "#D97706" },
  low: { label: "Low", color: "#16A34A" },
};
const SEV_RANK = { critical: 0, high: 1, medium: 2, low: 3 };
const PRI_RANK = { high: 0, medium: 1, low: 2 };
const TONE = { neutral: "var(--border)", ok: "#16A34A", warn: "#D97706", danger: "#DC2626" };
const brgy = n => (/^barangay/i.test(n || '') ? n : `Brgy ${n}`);

const ENDPOINTS = {
  stats: '/api/public/stats/', drivers: '/api/driver/trucks/', shifts: '/api/driver/shift/active_shifts/',
  feed: '/api/analytics/logs/', brgy: '/api/analytics/live/',
  schedule: '/api/driver/collection-schedules/', events: '/api/driver/calendar-events/',
  logs: '/api/dumpsite/waste-deliveries/',
};
const FAST_KEYS = ['stats', 'drivers', 'shifts'];

const FEED_DOT = { danger: "#DC2626", warning: "#D97706", success: "#16A34A", info: "#2563EB" };

const Ico = ({ d, size = 14, color = 'currentColor', sw = 1.75 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw}
    strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, display: 'block' }}>
    <path d={d} />
  </svg>
);
const IcoRoute = p => <Ico {...p} d="M3 17l4-8 4 4 4-6 4 4" />;
const IcoAlert = p => <Ico {...p} d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01" />;
const IcoChevronRight = p => <Ico {...p} d="M9 6l6 6-6 6" />;
const IcoTruck = p => <Ico {...p} d="M1 3h15v13H1zM16 8h4l3 3v5h-7V8zM5.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM18.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z" />;
const IcoCal = p => <Ico {...p} d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />;
const IcoClock = p => <Ico {...p} d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2zM12 6v6l4 2" />;
const IcoPin = p => <Ico {...p} d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1 1 18 0zM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />;
const IcoX = p => <Ico {...p} d="M18 6L6 18M6 6l12 12" />;
const IcoRefresh = p => <Ico {...p} d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />;
const IcoCheck = p => <Ico {...p} d="M20 6L9 17l-5-5" />;
const IcoChevronUp = p => <Ico {...p} d="M18 15l-6-6-6 6" />;
const IcoInfo = p => <Ico {...p} d="M12 2a10 10 0 1 0 0 20 10 10 0 1 0 0-20zM12 16v-4M12 8h.01" />;
const IcoChevronDown = p => <Ico {...p} d="M6 9l6 6 6-6" />;

// ─── Sub-components ───────────────────────────────────────────────────────────

const SkeletonRows = ({ n = 3 }) => Array.from({ length: n }, (_, i) => <div key={i} className="skeleton" />);

function QuickAssign({ hotspot, onClose, onDone }) {
  const [trucks, setTrucks] = useState(null);
  const [sel, setSel] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.get(`/api/watcher/hotspots/${hotspot.id}/recommend-trucks/`)
      .then(r => setTrucks(r.data || [])).catch(() => setTrucks([]));
  }, [hotspot.id]);
  async function submit() {
    setBusy(true);
    try { await api.post(`/api/watcher/hotspots/${hotspot.id}/assign-truck/`, { truck_id: Number(sel) }); onDone(true); }
    catch { onDone(false); }
    finally { setBusy(false); }
  }
  return (
    <div className="admin-modal-ov" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="admin-modal">
        <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 800 }}>Assign truck</h3>
        <p style={{ margin: '0 0 14px', fontSize: 12, color: 'var(--ui-text-muted)' }}>
          Brgy {hotspot.barangay_name} · {hotspot.count} reports
        </p>
        {trucks === null ? <SkeletonRows n={2} /> : trucks.length === 0
          ? <p style={{ fontSize: 12, color: 'var(--ui-text-muted)' }}>No active trucks found.</p>
          : <select value={sel} onChange={e => setSel(e.target.value)} className="form-input" style={{ width: '100%', marginBottom: 16 }}>
            <option value="">Choose a truck</option>
            {trucks.map(t => <option key={t.id} value={t.id}>{t.plate_number} · {t.model}{t.zone ? ` · ${t.zone}` : ''}</option>)}
          </select>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="action-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="action-btn" onClick={submit} disabled={!sel || busy}>{busy ? 'Assigning...' : 'Confirm'}</button>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    completed: { label: "COMPLETED", color: "#16A34A", bg: "rgba(22,163,74,0.1)", border: "rgba(22,163,74,0.3)" },
    "in-progress": { label: "IN PROGRESS", color: "#D97706", bg: "rgba(217,119,6,0.1)", border: "rgba(217,119,6,0.3)" },
    approved: { label: "IN PROGRESS", color: "#D97706", bg: "rgba(217,119,6,0.1)", border: "rgba(217,119,6,0.3)" },
    issue: { label: "ISSUE", color: "#DC2626", bg: "rgba(220,38,38,0.1)", border: "rgba(220,38,38,0.3)" },
    pending: { label: "PENDING", color: "#DC2626", bg: "rgba(220,38,38,0.1)", border: "rgba(220,38,38,0.3)" },
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
  const colors = { critical: "#DC2626", high: "#D97706", medium: "#CA8A04", low: "#16A34A" };
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
    navigate_to_base: { color: '#3B82F6', pulse: true, title: 'Navigating to base' },
    confirm_start: { color: '#22C55E', pulse: true, title: 'Confirming start' },
    checkin: { color: '#22C55E', pulse: true, title: 'Checking in' },
    shiftroute: { color: '#22C55E', pulse: false, title: 'On route' },
    on_route: { color: '#22C55E', pulse: false, title: 'On route' },
    end_shift: { color: '#EAB308', pulse: true, title: 'Ending shift' },
    completed: { color: '#22C55E', pulse: false, title: 'Completed', check: true },
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
  const [mainTab, setMainTab] = useState("drivers");

  const [stats, setStats] = useState({ total_waste: 0, active_trucks: 0, completed_routes: 0, total_routes: 0, pending_reports: 0 });
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
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const [routeDisplayMode, setRouteDisplayMode] = useState('today');
  const [mapFocus, setMapFocus] = useState(null);

  const navigate = useNavigate();
  const { items: escItems, loading: escLoading, error: escError, refresh: refreshEsc } = useEscalations();
  const { items: hotspots, loading: hsLoading, error: hsError, refresh: refreshHotspots } = useHotspots();
  const [stale, setStale] = useState({});
  const [layers, setLayers] = useState({ trucks: true, stops: true, reports: true, hotspots: true });
  const [assignTarget, setAssignTarget] = useState(null);
  const inflightRef = useRef(false);
  const tickRef = useRef(0);
  const apiHealth = !Object.values(stale).some(Boolean) && !escError && !hsError;
  const degradedReason = useMemo(() => {
    if (apiHealth) return "";
    const failed = Object.keys(stale).filter(k => stale[k]);
    const reasons = [];
    if (failed.length > 0) reasons.push(`Failed to load endpoints: ${failed.join(', ')}`);
    if (escError) reasons.push("Failed to load escalations");
    if (hsError) reasons.push("Failed to load hotspots");
    return reasons.join(" • ");
  }, [apiHealth, stale, escError, hsError]);

  const fetchData = async (isSilent = false, full = true) => {
    if (inflightRef.current) return;
    inflightRef.current = true;
    if (!isSilent) setLoading(true);
    try {
      const keys = Object.keys(ENDPOINTS).filter(k => full || FAST_KEYS.includes(k));
      const results = await Promise.allSettled(keys.map(k => api.get(ENDPOINTS[k])));
      const ok = {}, failed = {};
      results.forEach((r, i) => { if (r.status === 'fulfilled') ok[keys[i]] = r.value.data; else failed[keys[i]] = true; });
      if (ok.stats) setStats(p => ({ ...p, ...ok.stats }));
      if (ok.drivers) setDrivers(ok.drivers);
      if (ok.shifts) setActiveShifts(ok.shifts);
      if (ok.feed) setFeed((Array.isArray(ok.feed) ? ok.feed : ok.feed.results || []).slice(0, 8));
      if (ok.brgy && ok.brgy.barangay_breakdown) {
        setBrgyWaste(ok.brgy.barangay_breakdown.map(b => ({
          name: b.name,
          kg: b.weight_kg,
          status: b.reports_resolved >= b.reports_total ? 'completed' : 'in-progress'
        })));
      }
      if (ok.schedule) setSchedule(ok.schedule);
      if (ok.events) setCalendarEvents(ok.events);
      if (ok.logs) setLogs(ok.logs.results || ok.logs || []);
      setStale(prev => { const n = { ...prev }; keys.forEach(k => { n[k] = !!failed[k]; }); return n; });
      setLastRefreshed(new Date());
    } finally {
      inflightRef.current = false;
      if (!isSilent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchData(false, true);
    const fast = setInterval(() => {
      if (document.hidden) return;
      tickRef.current += 1;
      fetchData(true, tickRef.current % 4 === 0);   // fast keys 15s, everything 60s
    }, 15000);
    const slow = setInterval(() => { if (!document.hidden) { refreshEsc(true); refreshHotspots(true); } }, 30000);
    return () => { clearInterval(fast); clearInterval(slow); };
  }, []);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 3200);
  }



  function routeMatchesDay(route, dayName) {
    const abbr = dayName.slice(0, 3).toLowerCase();
    const raw = route.days || route.day || route.collection_days || '';
    if (!raw) return false;
    if (String(raw).toLowerCase().includes('daily')) return true;
    const list = Array.isArray(raw) ? raw : String(raw).split(',');
    return list.some(d => String(d).trim().slice(0, 3).toLowerCase() === abbr);
  }

  const PHASE_LABEL = {
    navigate_to_base: 'Navigating to Base',
    confirm_start: 'Starting Up',
    checkin: 'Checking In',
    shiftroute: 'On Route',
    on_route: 'On Route',
    end_shift: 'Ending Shift',
  };

  function getTruckLabel(t) {
    if (t.opState === 'active' || t.opState === 'extended') {
      if (t.isGhostShift) return `NO SIGNAL · ${PHASE_LABEL[t.phase] || t.phase || '—'}`;
      if (t.opState === 'extended') return 'EXTENDED ROUTE';
      if (t.opStatus === 'heading_to_dumpsite') return 'TO DUMPSITE';
      if (t.opStatus === 'at_dumpsite') return 'AT DUMPSITE';
      if (t.opStatus === 'returning_to_base' || t.endShiftPhase === 'returning') return 'RETURNING TO BASE';
      return 'ON ROUTE';
    }
    if (t.opState === 'abandoned') return `SHIFT NOT CLOSED · last seen ${t.lastSeen ? new Date(t.lastSeen).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) : '—'}`;
    if (t.opState === 'done') return t.stopsMissed ? `SHIFT COMPLETE · ${t.completedStops}/${t.totalStops} stops` : 'SHIFT COMPLETE';
    if (t.opState === 'maintenance') return 'MAINTENANCE';
    if (t.isPastEndTime) return 'NO SHOW';
    if (t.isLateStart) return `LATE START · ${t.startTime}`;
    if (t.opState === 'scheduled') return `Starts ${t.startTime}`;
    return 'OFFLINE / NO SCHEDULE';
  }

  const phaseOf = t => t.opState === 'done' ? 'completed' : t.isOnShift ? t.phase : undefined;

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
            const dayRoutes = schedule.filter(s => s.status !== 'CANCELLED' && (s.date ? s.date === dateStr : routeMatchesDay(s, cellDayName)));
            const dayEvents = calendarEvents.filter(e => e.date === dateStr);
            const isToday = isCurrentMonth && d === today.getDate();

            return (
              <button key={i} className={`cal-cell ${isToday ? 'today' : ''}`} onClick={() => openCalDayModal(d, dateStr, cellDayName, dayRoutes, dayEvents)}>
                <span className="cal-date">{d}</span>
                <div className="cal-dots">
                  {dayRoutes.slice(0, 3).map(s => {
                    const tc = getTruckColor(s.truck);
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

  const todayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date().getDay()];
  const todayStr = new Date().toLocaleDateString('en-CA');

  const todaysRoutes = useMemo(() => schedule.filter(s =>
    s.status !== 'CANCELLED' &&
    (s.date ? s.date === todayStr : routeMatchesDay(s, todayName))
  ), [schedule, todayName, todayStr]);

  const openEsc = useMemo(() => escItems
    .filter(e => !['resolved', 'rejected'].includes(e.status))
    .sort((a, b) => (PRI_RANK[a.priority] ?? 3) - (PRI_RANK[b.priority] ?? 3)), [escItems]);
  const highEsc = openEsc.filter(e => e.priority === 'high');
  const overdueEsc = openEsc.filter(e => e.deadline && e.deadline < todayStr);
  const unassignedEsc = openEsc.filter(e => e.status === 'pending' && !e.assignee && e.priority !== 'high');
  const highUnassigned = highEsc.filter(e => e.status === 'pending' && !e.assignee);
  const highOverdue = highEsc.filter(e => e.deadline && e.deadline < todayStr);
  const needsTruck = h => ['critical', 'high'].includes(h.status) && !h.assigned_truck_id;
  const undispatched = hotspots.filter(needsTruck);
  const topHotspots = useMemo(() => [...hotspots]
    .sort((a, b) => (SEV_RANK[a.status] ?? 4) - (SEV_RANK[b.status] ?? 4) || b.count - a.count).slice(0, 4), [hotspots]);

  const locate = h => {
    setMapFocus({ lat: Number(h.latitude), lng: Number(h.longitude), zoom: 17 });
    document.getElementById('dash-map')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const fleet = useMemo(() => {
    const truckIds = new Set(drivers.map(t => String(t.id)));
    const byTruck = {};
    const orphans = [];
    activeShifts.forEach(sh => {
      const c = { sh, ...classifyShift(sh) };
      const k = String(sh.truck ?? '');
      if (!truckIds.has(k)) {
        if (['active', 'extended', 'abandoned'].includes(c.lifecycle) && !sh.end_reason) orphans.push(sh);
        return;
      }
      if (c.lifecycle === 'past') return;
      (byTruck[k] ||= []).push(c);
    });

    const RANK = { active: 0, extended: 0, done: 1, abandoned: 2 };
    const nowM = new Date().getHours() * 60 + new Date().getMinutes();
    const mins = t => { const [h, m] = (t || '0:0').split(':'); return Number(h) * 60 + Number(m); };

    const trucks = drivers.map(truck => {
      const picked = (byTruck[String(truck.id)] || [])
        .sort((a, b) => RANK[a.lifecycle] - RANK[b.lifecycle] || (b.lastSeen || 0) - (a.lastSeen || 0))[0];
      const shift = picked?.sh;
      const lc = picked?.lifecycle;

      const cands = todaysRoutes.filter(s => String(s.truck) === String(truck.id));
      let route;
      if (shift?.schedule_id) route = schedule.find(s => s.id === shift.schedule_id) || cands[0];
      else if (cands.length > 1) route = cands.find(r => nowM >= mins(r.start_time) && nowM <= mins(r.end_time))
        || cands.find(r => mins(r.start_time) > nowM) || cands[cands.length - 1];
      else route = cands[0];

      const opState = lc === 'done' ? 'done'
        : lc === 'abandoned' ? 'abandoned'
          : lc === 'extended' ? 'extended'
            : lc === 'active' ? 'active'
              : truck.status === 'maintenance' ? 'maintenance'
                : route ? 'scheduled' : 'offline';
      const isOnShift = opState === 'active' || opState === 'extended';
      const isPastEndTime = opState === 'scheduled' && !!route?.end_time && mins(route.end_time) < nowM;
      const isLateStart = opState === 'scheduled' && !isPastEndTime && !!route?.start_time && nowM - mins(route.start_time) > 15;
      const total = route?.total_stops || 0, done = route?.completed_stops || 0;

      return {
        id: truck.id, plate: truck.plate_number, zone: truck.zone, status: truck.status,
        driverNames: truck.driver_details?.map(x => x.full_name).join(', ') || 'No driver',
        hasRouteToday: !!route, barangayNames: route?.barangay_names || '',
        startTime: route?.start_time?.slice(0, 5), endTime: route?.end_time,
        totalStops: total, completedStops: done,
        progressPct: total ? Math.round((done / total) * 100) : 0,
        opState, isOnShift, isLateStart, isPastEndTime,
        isGhostShift: isOnShift && picked.signal === 'lost',
        stopsMissed: opState === 'done' && done < total,
        lastSeen: picked?.lastSeen,
        phase: shift?.phase_status, opStatus: shift?.op_status, endShiftPhase: shift?.end_shift_phase,
      };
    });
    return { trucks, orphans };
  }, [drivers, activeShifts, schedule, todaysRoutes]);
  const mergedTrucks = fleet.trucks;
  const orphanShifts = fleet.orphans;

  const onShiftCnt = mergedTrucks.filter(t => t.isOnShift).length;
  const noSignalCnt = mergedTrucks.filter(t => t.isGhostShift).length;
  const abandonedCnt = mergedTrucks.filter(t => t.opState === 'abandoned').length;

  const kpis = [
    { label: 'Waste Today', value: stats.total_waste || 0, unit: 'KG', sub: 'Collected today' },
    {
      label: 'On Shift', value: onShiftCnt, of: mergedTrucks.length,
      tone: (abandonedCnt || orphanShifts.length) ? 'warn' : undefined,
      hint: orphanShifts.map(s => `shift #${s.id} · truck ${s.truck ?? 'null'}`).join('\n') || undefined,
      sub: [noSignalCnt && `${noSignalCnt} no signal`, abandonedCnt && `${abandonedCnt} not closed`,
      orphanShifts.length && `${orphanShifts.length} unmatched`].filter(Boolean).join(' · ') || 'Fleet'
    },
    { label: 'Routes Done', value: stats.completed_routes || 0, of: todaysRoutes.length || stats.total_routes || 0, sub: 'Today' },
    { label: 'Online Watchers', value: stats.active_watchers || 0, of: stats.total_watchers || 0, sub: 'Ground monitoring' },
    { label: 'Online Officials', value: stats.active_officials || 0, of: stats.total_officials || 0, sub: 'Brgy Official' },
    {
      label: 'High Escalations', value: highEsc.length, tone: highEsc.length ? 'danger' : 'ok', to: '/admin/escalations',
      sub: highEsc.length ? `${highUnassigned.length} unassigned · ${highOverdue.length} overdue` : 'All clear'
    },
    {
      label: 'Undispatched', value: undispatched.length, tone: undispatched.length ? 'danger' : 'ok', to: '/admin/hotspots',
      sub: undispatched.length ? 'Critical/High, no truck' : 'All dispatched'
    },
    { label: 'Pending Reports', value: stats.pending_reports || 0, tone: stats.pending_reports ? 'warn' : 'ok', to: '/admin/reports', sub: 'Awaiting validation' },
  ];

  const filteredTrucks = useMemo(() => {
    let result = mergedTrucks;
    if (truckFilter) {
      const q = truckFilter.toLowerCase();
      result = result.filter(t =>
        t.plate?.toLowerCase().includes(q) ||
        t.barangayNames?.toLowerCase().includes(q) ||
        t.driverNames?.toLowerCase().includes(q)
      );
    }
    const SORT_RANK = { active: 0, extended: 1, abandoned: 2, done: 3, maintenance: 4, scheduled: 5, offline: 6 };
    return [...result].sort((a, b) => {
      const ra = a.isLateStart ? 2 : (SORT_RANK[a.opState] ?? 7);
      const rb = b.isLateStart ? 2 : (SORT_RANK[b.opState] ?? 7);
      return ra - rb || (a.plate || '').localeCompare(b.plate || '');
    });
  }, [mergedTrucks, truckFilter]);

  return (
    <>
      <style>{`
        .dashboard-container, .admin-modal-ov { --ui-border: var(--border); --ui-surface: var(--surface); --ui-bg: var(--bg); --ui-text: var(--text); --ui-text-muted: var(--text-muted); }
        .dashboard-container { padding: 24px; max-width: 1760px; margin: 0 auto; color: var(--ui-text); }
        .dashboard-container * { scrollbar-width: thin; scrollbar-color: var(--border-2) transparent; }
        
        .flat-card {
          background: var(--ui-surface);
          border: 0.5px solid var(--ui-border);
          border-radius: 12px;
          padding: 14px 16px;
          transition: transform 0.15s ease, box-shadow 0.15s ease;
        }
        .flat-card.hoverable:hover {
          transform: none; border-color: var(--border-2);
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
        .action-btn:hover { background: var(--surface-2); }

        .kpi-ribbon {
          display: grid; grid-template-columns: repeat(8, minmax(0,1fr)); gap: 12px; margin-bottom: 24px;
        }
        .kpi-card { display: flex; flex-direction: column; position: relative; overflow: hidden; }
        .kpi-card-left-border {
          position: absolute; left: 0; top: 0; bottom: 0; width: 4px;
        }
        .kpi-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--ui-text-muted); margin-bottom: 4px; }
        .kpi-val { font-size: 28px; font-weight: 800; color: var(--ui-text); line-height: 1.1; }
        .kpi-trend { font-size: 12px; font-weight: 500; margin-top: 4px; color: var(--ui-text-muted); }

        .map-section {
          width: 100%; height: auto; position: relative; border-radius: 12px; overflow: hidden;
          border: 0.5px solid var(--ui-border); margin-bottom: 24px;
        }

        .route-progress-panel { margin-bottom: 24px; }
        .progress-row {
          display: flex; align-items: center; justify-content: space-between; gap: 16px;
          padding: 12px 16px; background: var(--ui-surface); border: 0.5px solid var(--ui-border);
          border-radius: 8px; margin-bottom: 8px;
        }
        .progress-bar-container { flex: 1; height: 8px; background: var(--border); border-radius: 4px; overflow: hidden; }
        .progress-bar-fill { height: 100%; border-radius: 4px; }

        .main-grid { display: grid; grid-template-columns: minmax(0,1fr) 400px; align-items: start; gap: 24px; }

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
        .cal-cell.empty { background: var(--surface-2); cursor: default; }
        .cal-cell:hover:not(.empty) { background: var(--surface-2); }
        .cal-date { font-size: 12px; font-weight: 600; color: var(--ui-text); margin-bottom: 4px; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; border-radius: 50%; }
        .cal-cell.today .cal-date { background: #16A34A; color: white; }
        .cal-dots { display: flex; gap: 3px; justify-content: center; flex-wrap: wrap; }
        .cal-dot { width: 6px; height: 6px; border-radius: 50%; }

        .status-footer { display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--ui-text-muted); margin-top: 24px; padding-top: 16px; border-top: 0.5px solid var(--ui-border); }
        
        .empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 32px 16px; text-align: center; color: var(--ui-text-muted); font-size: 13px; font-weight: 500; }

        .admin-modal-ov { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 9998; display: flex; align-items: center; justify-content: center; padding: 16px; }
        .admin-modal { background: var(--ui-surface); border-radius: 12px; padding: 24px; width: 100%; max-width: 440px; max-height: 85vh; overflow-y: auto; }

        .rail { position: static; max-height: none; overflow: visible; padding-right: 4px; }
        .kpi-link, .row-btn { text-align: left; font: inherit; color: inherit; cursor: pointer; width: 100%; }
        .kpi-link { width: auto; }
        .link-btn { background: none; border: none; font: inherit; font-size: 11px; font-weight: 700; color: var(--accent); cursor: pointer; padding: 2px 4px; display: inline-flex; align-items: center; }
        .flat-card:focus-visible, .action-btn:focus-visible, .link-btn:focus-visible, .layer-chip:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
        .glass { background: color-mix(in srgb, var(--surface) 72%, transparent); backdrop-filter: blur(10px); border: 1px solid var(--border); border-radius: 10px; }
        .map-layers { position: absolute; top: 10px; left: 10px; z-index: 5; display: flex; gap: 4px; padding: 4px; }
        .layer-chip { border: none; background: transparent; color: var(--text-muted); font-size: 11px; font-weight: 700; text-transform: capitalize; padding: 5px 10px; border-radius: 7px; cursor: pointer; }
        .layer-chip.on { background: var(--accent); color: #fff; }
        .alert-banner { display: flex; align-items: center; gap: 12px; padding: 10px 14px; margin-bottom: 16px; border-radius: 12px; background: rgba(220,38,38,0.08); border: 1px solid rgba(220,38,38,0.3); }
        .skeleton { height: 56px; border-radius: 12px; margin-bottom: 8px; background: linear-gradient(90deg, var(--surface-2), var(--surface), var(--surface-2)); background-size: 200% 100%; animation: sk 1.2s infinite; }
        @keyframes sk { to { background-position: -200% 0; } }
        .stale-pill { font-size: 9px; font-weight: 800; color: #D97706; border: 1px solid rgba(217,119,6,.3); background: rgba(217,119,6,.1); border-radius: 4px; padding: 1px 6px; margin-left: 8px; }

        @media (max-width: 1399px) { .kpi-ribbon { grid-template-columns: repeat(4, minmax(0,1fr)); } }
        @media (max-width: 1199px) { .main-grid { grid-template-columns: 1fr; } .rail { position: static; max-height: none; overflow: visible; } }
        @media (max-width: 768px) {
          .kpi-ribbon { grid-template-columns: 1fr 1fr; }
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
              Admin Command Center
              <span style={{ fontSize: 10, background: "rgba(220,38,38,0.1)", color: "#DC2626", padding: "2px 8px", borderRadius: 4, border: "0.5px solid rgba(220,38,38,0.3)" }}>CITY ADMIN</span>
              {!apiHealth && (
                <span title={degradedReason} style={{ cursor: "help", display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, background: "rgba(217,119,6,0.1)", color: "#D97706", padding: "2px 8px", borderRadius: 4, border: "0.5px solid rgba(217,119,6,0.3)" }}>
                  DEGRADED
                  <IcoInfo size={12} />
                </span>
              )}
            </h1>
            <p style={{ fontSize: 13, color: "var(--ui-text-muted)", margin: 0 }}>
              Lucena City · Live Operations Monitor
              {lastRefreshed && ` · Last sync: ${lastRefreshed.toLocaleTimeString()}`}
            </p>
          </div>
          <div className="quick-actions">
            <button className="action-btn" onClick={() => { fetchData(false, true); refreshEsc(); refreshHotspots(); }} disabled={loading}>
              <IcoRefresh size={14} /> {loading ? 'Syncing...' : 'Force Sync'}
            </button>
          </div>
        </div>

        {/* ALERTS */}
        {(highEsc.length > 0 || unassignedEsc.length > 0 || undispatched.length > 0) && (
          <div className="alert-banner" role="alert">
            <IcoAlert size={18} color="#DC2626" />
            <div style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>
              {[
                highEsc.length && `${highEsc.length} high-priority escalation${highEsc.length > 1 ? 's' : ''}`,
                unassignedEsc.length && `${unassignedEsc.length} unassigned escalation${unassignedEsc.length > 1 ? 's' : ''}`,
                undispatched.length && `${undispatched.length} hotspot${undispatched.length > 1 ? 's' : ''} without a truck`,
              ].filter(Boolean).join(' · ')}
            </div>
            <button className="action-btn" onClick={() => navigate(highEsc.length || unassignedEsc.length ? '/admin/escalations' : '/admin/hotspots')}>Review</button>
          </div>
        )}

        {/* KPI RIBBON */}
        <div className="kpi-ribbon">
          {kpis.map((k, i) => {
            const Tag = k.to ? 'button' : 'div';
            return (
              <Tag key={i} className={`flat-card kpi-card${k.to ? ' kpi-link hoverable' : ''}`} style={k.hint ? { cursor: 'help' } : undefined} onClick={k.to ? () => navigate(k.to) : undefined} title={k.hint}>
                <div className="kpi-card-left-border" style={{ background: TONE[k.tone] || TONE.neutral }} />
                <div className="kpi-label">{k.label}</div>
                <div className="kpi-val" style={{ color: TONE[k.tone] || 'inherit' }}>
                  {k.value}
                  {k.of !== undefined && <span style={{ fontSize: 14, color: "var(--text-muted)", marginLeft: 4 }}>/{k.of}</span>}
                  {k.unit && <span style={{ fontSize: 16, marginLeft: 4 }}>{k.unit}</span>}
                </div>
                <div className="kpi-trend" style={{ color: k.tone === 'danger' ? TONE.danger : 'var(--text-muted)' }}>{k.sub}</div>
              </Tag>
            );
          })}
        </div>

        <div className="main-grid">
          <div>
            <div className="map-section" id="dash-map">
              <div className="map-layers glass">
                {Object.keys(layers).map(k => (
                  <button key={k} className={`layer-chip ${layers[k] ? 'on' : 'off'}`} onClick={() => setLayers(p => ({ ...p, [k]: !p[k] }))}>
                    {k}
                  </button>
                ))}
              </div>
              <MiniMap
                height={window.innerWidth < 768 ? 300 : 520}
                focusCoordinate={mapFocus}
                layers={layers}
                hotspots={hotspots}
                onHotspotClick={h => navigate(`/admin/hotspots?focus=${h.id}`)}
              />
            </div>
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
                          style={{ opacity: t.opState === 'offline' ? 0.5 : 1 }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: 220 }}>
                            <PhaseIndicator phase={phaseOf(t)} size={8} />
                            <span style={{
                              fontSize: 13, fontWeight: 700,
                              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            }}>
                              {t.plate} · {t.barangayNames?.split(',')[0] || 'Unassigned'}
                            </span>
                          </div>
                          {t.isOnShift ? (
                            <div className="progress-bar-container">
                              <div className="progress-bar-fill" style={{ width: `${t.progressPct}%`, background: getTruckColor(t.id).color }} />
                            </div>
                          ) : <div style={{ flex: 1 }} />}
                          <div style={{
                            fontSize: 12, fontWeight: 600, minWidth: 130, flexShrink: 0, textAlign: 'right', whiteSpace: 'nowrap',
                            color: (t.stopsMissed || t.opState === 'abandoned') ? '#D97706' : '#6B7280',
                          }}>
                            {t.isOnShift ? `${t.completedStops} / ${t.totalStops} — ${t.progressPct}%` : getTruckLabel(t)}
                          </div>
                        </div>
                      ))}

                      {filteredTrucks.length === 0 && (
                        <div style={{
                          padding: '12px 0', fontSize: 13,
                          color: 'var(--ui-text-muted)', textAlign: 'center'
                        }}>
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
                      const statusText = getTruckLabel(t);
                      const isUrgent = t.isLateStart || t.isGhostShift || t.opState === 'abandoned' || t.isPastEndTime;

                      return (
                        <div key={t.id}
                          className="flat-card hoverable"
                          style={{
                            marginBottom: 8,
                            display: 'flex', justifyContent: 'space-between',
                            alignItems: 'center',
                            opacity: t.opState === 'offline' ? 0.5 : 1,
                            borderColor: isUrgent ? 'rgba(220, 38, 38, 0.3)' : 'var(--ui-border)',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                            <PhaseIndicator phase={phaseOf(t)} size={12} />
                            <div>
                              <div style={{ fontWeight: 800, fontSize: 14 }}>{t.plate}</div>
                              <div style={{ fontSize: 12, color: 'var(--ui-text-muted)', marginTop: 2 }}>
                                {t.driverNames} · {t.barangayNames?.split(',')[0] || t.zone || 'Unassigned'}
                              </div>
                            </div>
                          </div>
                          <div style={{
                            fontSize: 11, fontWeight: 700,
                            color: isUrgent ? '#DC2626' : 'var(--ui-text-muted)',
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
          <div className="rail">
            {/* QUICK ACTIONS ROW */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
              <button className="flat-card row-btn hoverable" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, borderLeft: '4px solid #3B82F6' }} onClick={() => navigate('/admin/routes')}>
                <IcoRoute size={16} color="#3B82F6" />
                <div style={{ fontWeight: 800, fontSize: 13, flex: 1 }}>Route Builder</div>
                <IcoChevronRight size={14} color="var(--text-muted)" />
              </button>
            </div>

            {/* ESCALATIONS */}
            <div className="sidebar-section">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
                <div className="sidebar-title" style={{ margin: 0 }}>Escalation Queue</div>
                <button className="link-btn" onClick={() => navigate('/admin/escalations')}>View all</button>
              </div>
              {escLoading && !openEsc.length ? <SkeletonRows n={3} /> : openEsc.length === 0 ? (
                <div className="empty-state flat-card">
                  <IcoCheck size={24} color="#16A34A" />
                  <div style={{ marginTop: 8 }}>All clear — no open escalations</div>
                </div>
              ) : (
                openEsc.slice(0, 4).map(e => (
                  <div key={e.id} className="flat-card hoverable esc-row" style={{ marginBottom: 8, padding: "14px 16px 14px 28px" }}>
                    <div className={`esc-dot ${e.priority === 'high' ? 'pulse' : ''}`} style={{ background: PRIORITY[e.priority]?.color || '#9CA3AF' }} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ paddingRight: 8 }}>
                        <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 4 }}>{e.title}</div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>
                          {brgy(e.barangay_name)} · {e.reports_count ?? e.report_count ?? 1} report(s)
                        </div>
                        <StatusBadge status={e.status} />
                        {e.status === 'pending' && !e.assignee && (
                          <div style={{ marginTop: 6, fontSize: 10, color: '#DC2626', fontWeight: 700 }}>NEEDS ASSIGNMENT</div>
                        )}
                      </div>
                      <button onClick={() => navigate(`/admin/escalations?focus=${e.id}`)} style={{
                        background: "transparent", border: "0.5px solid var(--border)", borderRadius: 6,
                        padding: "4px 8px", fontSize: 11, fontWeight: 600, cursor: "pointer", color: "var(--text)"
                      }}>Review</button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* HOTSPOTS */}
            <div className="sidebar-section">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
                <div className="sidebar-title" style={{ margin: 0 }}>Hotspot Alerts</div>
                <button className="link-btn" onClick={() => navigate('/admin/hotspots')}>View all</button>
              </div>
              {hsLoading && !topHotspots.length ? <SkeletonRows n={3} /> : topHotspots.length === 0 ? (
                <div className="empty-state flat-card">
                  <IcoCheck size={24} color="#16A34A" />
                  <div style={{ marginTop: 8 }}>All clear — no hotspots</div>
                </div>
              ) : (
                topHotspots.map(h => (
                  <div key={h.id} className="flat-card hoverable" style={{ marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", marginTop: 4 }}>
                      <div style={{ marginTop: 6 }}><SeverityDot severity={h.status?.toLowerCase()} /></div>
                      <div>
                        <div style={{ fontWeight: 800, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                          {brgy(h.barangay_name)}
                          {!h.assigned_truck_id && <span style={{ fontSize: 9, background: 'rgba(220,38,38,0.1)', color: '#DC2626', padding: '2px 4px', borderRadius: 4, border: '0.5px solid rgba(220,38,38,0.3)', fontWeight: 700 }}>UNASSIGNED</span>}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                          {h.count} reports · {h.assigned_truck_id ? 'Dispatched' : 'System Generated'}
                        </div>
                        <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
                          {new Date(h.created_at || h.last_detected).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <button style={{
                        background: "var(--surface-2)", border: "none", borderRadius: 6,
                        padding: "4px 8px", fontSize: 11, fontWeight: 600, cursor: "pointer", color: "var(--text)"
                      }} onClick={() => locate(h)}>Map</button>
                      <button className="link-btn" title="Open in Hotspot Detection" onClick={() => navigate(`/admin/hotspots?focus=${h.id}`)}><IcoChevronRight size={16} /></button>
                      {needsTruck(h) && (
                        <button style={{
                          background: "#DC2626", border: "none", borderRadius: 6,
                          padding: "4px 8px", fontSize: 11, fontWeight: 700, cursor: "pointer", color: "#fff"
                        }} onClick={() => setAssignTarget(h)}>Dispatch</button>
                      )}
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
                  const tc = getTruckColor(s.truck);
                  return (
                    <div key={s.id} className="flat-card" style={{ marginBottom: 8, borderLeft: `4px solid ${tc.color}` }}>
                      <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 8 }}>{s.barangay_names || 'No barangays'}</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {s.truck_plate && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: tc.color, background: `${tc.color}1F`, borderRadius: 4, padding: '2px 6px', fontWeight: 700 }}><IcoTruck size={10} color={tc.color} />{s.truck_plate}</span>}
                        {s.driver_name && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--ui-text-muted)', background: 'var(--surface-2)', borderRadius: 4, padding: '2px 6px', fontWeight: 600 }}>{s.driver_name}</span>}
                        {s.start_time && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--ui-text-muted)', background: 'var(--surface-2)', borderRadius: 4, padding: '2px 6px', fontWeight: 600 }}><IcoClock size={10} color="var(--ui-text-muted)" />{s.start_time.slice(0, 5)}-{s.end_time?.slice(0, 5)}</span>}
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
                    {ev.location && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--ui-text-muted)', background: 'var(--surface-2)', borderRadius: 4, padding: '2px 6px', fontWeight: 600 }}><IcoPin size={10} color="var(--ui-text-muted)" />{ev.location}</span>}
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

      {assignTarget && <QuickAssign hotspot={assignTarget} onClose={() => setAssignTarget(null)} onDone={success => { setAssignTarget(null); if (success) { refreshHotspots(); showToast("Truck dispatched."); } }} />}
    </>
  );
}
