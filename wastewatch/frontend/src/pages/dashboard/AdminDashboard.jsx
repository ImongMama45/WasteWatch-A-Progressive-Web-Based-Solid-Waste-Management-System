import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useHotspots } from "../../hooks/useHotspots";
import { useEscalations } from "../../hooks/useEscalations";
import { getTruckColor } from "../../utils/truckColors";
import { classifyShift } from "../../utils/shiftState";
import MiniMap from "../../components/MiniMap";
import api from "../../api/client";
import OnlineUsersList from '../../components/OnlineUsersList';
import {
  StatCardSkeleton,
  FeedCardSkeleton,
  ChartSkeleton,
  TableSkeleton,
  SidebarWidgetSkeleton,
  CalendarSkeleton,
} from '../../components/ui/Skeleton';

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
  stats: '/api/public/stats/',
  drivers: '/api/driver/trucks/?paginate=false',
  shifts: '/api/driver/shift/active_shifts/',
  feed: '/api/analytics/logs/?page_size=8',
  brgy: '/api/analytics/live/',
  schedule: '/api/driver/collection-schedules/?paginate=false',
  events: '/api/driver/calendar-events/',
  logs: '/api/dumpsite/waste-deliveries/?page_size=10',
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
const IcoChevronLeft = p => <Ico {...p} d="M15 18l-6-6 6-6" />;
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
const IcoUser = p => <Ico {...p} d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" />;
const IcoCamera = p => <Ico {...p} d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z M12 9a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" />;

// ─── Sub-components ───────────────────────────────────────────────────────────

const SkeletonRows = ({ n = 3 }) => (
  <div className="flat-card">
    <SidebarWidgetSkeleton rows={n} />
  </div>
);

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
        flexShrink: 0,
      }}>
        <IcoCheck size={Math.round(size * 0.75)} color="#fff" sw={3} />
      </span>
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

const PHASE_LABEL = {
  navigate_to_base: 'Navigating to Base',
  confirm_start: 'Starting Up',
  checkin: 'Checking In',
  shiftroute: 'On Route',
  on_route: 'On Route',
  end_shift: 'Ending Shift',
};

function getTruckLabel(t) {
  if (!t) return 'OFFLINE / NO SCHEDULE';
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

const phaseOf = t => t?.opState === 'done' ? 'completed' : t?.isOnShift ? t?.phase : undefined;

function StopStatusBadge({ status }) {
  const map = {
    POST_VERIFIED: { label: "Verified", color: "#16A34A", bg: "rgba(22, 163, 74, 0.1)", border: "rgba(22, 163, 74, 0.3)" },
    COLLECTION_REPORTED: { label: "Collected", color: "#2563EB", bg: "rgba(37, 99, 235, 0.1)", border: "rgba(37, 99, 235, 0.3)" },
    PRE_INSPECTED: { label: "Pre-Inspected", color: "#D97706", bg: "rgba(217, 119, 6, 0.1)", border: "rgba(217, 119, 6, 0.3)" },
    PENDING_COLLECTION: { label: "Pending", color: "#6B7280", bg: "rgba(107, 114, 128, 0.1)", border: "rgba(107, 114, 128, 0.2)" },
    DISPUTED: { label: "Disputed", color: "#DC2626", bg: "rgba(220, 38, 38, 0.1)", border: "rgba(220, 38, 38, 0.3)" },
  };
  const s = map[status] || { label: status || 'Pending', color: "#6B7280", bg: "rgba(107, 114, 128, 0.1)", border: "rgba(107, 114, 128, 0.2)" };
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
      color: s.color, background: s.bg, border: `1px solid ${s.border}`,
      textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap',
    }}>
      {s.label}
    </span>
  );
}

function TruckActivityModal({ truck, onClose }) {
  const [loading, setLoading] = useState(true);
  const [validations, setValidations] = useState([]);
  const [selectedStopIdx, setSelectedStopIdx] = useState(0);
  const [activePhotoType, setActivePhotoType] = useState('auto'); // 'auto' | 'watcher' | 'driver'

  useEffect(() => {
    let mounted = true;
    const fetchValidations = async () => {
      setLoading(true);
      try {
        const params = {};
        if (truck.scheduleId) params.schedule_id = truck.scheduleId;
        const res = await api.get('/api/watcher/stop-validations/', { params });
        const data = Array.isArray(res.data) ? res.data : (res.data?.results || []);
        const matched = data.filter(v =>
          (truck.scheduleId && String(v.schedule_id) === String(truck.scheduleId)) ||
          (v.truck_plate && v.truck_plate.toLowerCase() === truck.plate?.toLowerCase())
        );
        if (mounted) {
          setValidations(matched.length > 0 ? matched : (truck.scheduleId ? data : []));
        }
      } catch (err) {
        console.error('Failed to load stop validations for truck:', err);
        if (mounted) setValidations([]);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    fetchValidations();
    return () => { mounted = false; };
  }, [truck]);

  const sortedStops = useMemo(() => {
    return [...validations].sort((a, b) => (a.stop_order ?? 0) - (b.stop_order ?? 0));
  }, [validations]);

  const watcherPhotoStops = useMemo(() =>
    sortedStops.filter(s => Boolean(s.post_validation_photo_url || s.pre_validation_photo_url)),
    [sortedStops]
  );
  const driverPhotoStops = useMemo(() =>
    sortedStops.filter(s => Boolean(s.collection_photo_url)),
    [sortedStops]
  );

  const currentStop = sortedStops[selectedStopIdx] || sortedStops[0] || null;

  // Stop photos for currently selected stop
  const currentWatcherPhoto = currentStop?.post_validation_photo_url || currentStop?.pre_validation_photo_url;
  const currentDriverPhoto = currentStop?.collection_photo_url;

  // Fallbacks across the route if current stop has no photos
  const activeWatcherStop = currentWatcherPhoto ? currentStop : watcherPhotoStops[0];
  const activeDriverStop = currentDriverPhoto ? currentStop : driverPhotoStops[0];

  const hasWatcherPhoto = Boolean(activeWatcherStop?.post_validation_photo_url || activeWatcherStop?.pre_validation_photo_url);
  const hasDriverPhoto = Boolean(activeDriverStop?.collection_photo_url);

  // Preference hierarchy:
  // 1. Picture of Watcher
  // 2. Picture of Driver for the stop
  // 3. Fallback message with Driver Overview
  const effectivePhotoType = activePhotoType === 'auto'
    ? (hasWatcherPhoto ? 'watcher' : (hasDriverPhoto ? 'driver' : 'none'))
    : activePhotoType;

  const displayedPhoto = effectivePhotoType === 'watcher'
    ? (activeWatcherStop?.post_validation_photo_url || activeWatcherStop?.pre_validation_photo_url)
    : effectivePhotoType === 'driver'
      ? activeDriverStop?.collection_photo_url
      : null;

  const photoStopContext = effectivePhotoType === 'watcher' ? activeWatcherStop : activeDriverStop;
  const truckColor = getTruckColor(truck.id).color || '#16A34A';

  return (
    <div className="admin-modal-ov" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="admin-modal" style={{ maxWidth: 620, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
        {/* MODAL HEADER */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 38, height: 38, borderRadius: 8, background: 'rgba(59, 130, 246, 0.1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2563EB', flexShrink: 0
            }}>
              <IcoTruck size={20} color="#2563EB" />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{truck.plate}</h3>
                {truck.model && (
                  <span style={{ fontSize: 11, color: 'var(--ui-text-muted)', fontWeight: 600 }}>
                    ({truck.model})
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, color: 'var(--ui-text-muted)', marginTop: 2 }}>
                {truck.barangayNames || truck.zone || 'Unassigned Zone'} · {truck.driverNames}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ui-text-muted)', padding: 4 }}
          >
            <IcoX size={18} />
          </button>
        </div>

        {/* DRIVER OVERVIEW CARD */}
        <div className="flat-card" style={{ padding: '14px 16px', marginBottom: 16, background: 'var(--ui-surface)' }}>
          <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--ui-text-muted)', marginBottom: 10 }}>
            Driver & Fleet Overview
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--ui-text-muted)' }}>Assigned Driver</div>
              <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                <IcoUser size={13} color="#2563EB" />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {truck.driverNames}
                </span>
              </div>
            </div>

            <div>
              <div style={{ fontSize: 11, color: 'var(--ui-text-muted)' }}>Shift Status</div>
              <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>
                <span style={{
                  display: 'inline-block',
                  fontSize: 11, fontWeight: 700,
                  color: (truck.isLateStart || truck.isGhostShift || truck.opState === 'abandoned') ? '#DC2626' : (truck.isOnShift ? '#16A34A' : '#6B7280'),
                  textTransform: 'uppercase'
                }}>
                  {getTruckLabel(truck)}
                </span>
              </div>
            </div>

            <div>
              <div style={{ fontSize: 11, color: 'var(--ui-text-muted)' }}>Shift Hours</div>
              <div style={{ fontSize: 12, fontWeight: 600, marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                <IcoClock size={12} color="var(--ui-text-muted)" />
                <span>
                  {truck.startTime ? `${truck.startTime} – ${truck.endTime?.slice(0, 5) || 'TBD'}` : 'No schedule today'}
                </span>
              </div>
            </div>

            <div>
              <div style={{ fontSize: 11, color: 'var(--ui-text-muted)' }}>Signal & Phase</div>
              <div style={{ fontSize: 12, fontWeight: 600, marginTop: 2, color: 'var(--ui-text-muted)' }}>
                {truck.lastSeen ? new Date(truck.lastSeen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : (truck.isOnShift ? 'Active Now' : 'Offline')}
              </div>
            </div>
          </div>
        </div>

        {/* ROUTE PROGRESS BAR */}
        <div className="flat-card" style={{ padding: '14px 16px', marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 800 }}>Route Progress</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: truckColor }}>
              {truck.completedStops} / {truck.totalStops} Stops ({truck.progressPct}%)
            </div>
          </div>
          <div className="progress-bar-container" style={{ height: 8, background: '#E5E7EB', borderRadius: 4 }}>
            <div
              className="progress-bar-fill"
              style={{ width: `${truck.progressPct}%`, background: truckColor, borderRadius: 4 }}
            />
          </div>
        </div>

        {/* ACTIVITY & PHOTOS SECTION */}
        <div className="flat-card" style={{ padding: '14px 16px', marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--ui-text-muted)' }}>
              Activity & Verification Photos
            </div>

            {hasWatcherPhoto && hasDriverPhoto && (
              <div style={{ display: 'flex', gap: 4, background: 'var(--ui-bg)', padding: 2, borderRadius: 6 }}>
                <button
                  type="button"
                  onClick={() => setActivePhotoType('watcher')}
                  style={{
                    padding: '3px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700, border: 'none', cursor: 'pointer',
                    background: effectivePhotoType === 'watcher' ? '#16A34A' : 'transparent',
                    color: effectivePhotoType === 'watcher' ? '#fff' : 'var(--ui-text-muted)'
                  }}
                >
                  Watcher Photo
                </button>
                <button
                  type="button"
                  onClick={() => setActivePhotoType('driver')}
                  style={{
                    padding: '3px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700, border: 'none', cursor: 'pointer',
                    background: effectivePhotoType === 'driver' ? '#2563EB' : 'transparent',
                    color: effectivePhotoType === 'driver' ? '#fff' : 'var(--ui-text-muted)'
                  }}
                >
                  Driver Photo
                </button>
              </div>
            )}
          </div>

          {loading ? (
            <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--ui-text-muted)', fontSize: 13 }}>
              Loading verification details...
            </div>
          ) : displayedPhoto ? (
            <div>
              <div style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', background: '#000', maxHeight: 280, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <img
                  src={displayedPhoto}
                  alt="Stop verification"
                  style={{ width: '100%', maxHeight: 280, objectFit: 'contain' }}
                  onError={e => { e.target.style.display = 'none'; }}
                />
                <div style={{
                  position: 'absolute', top: 10, left: 10,
                  background: effectivePhotoType === 'watcher' ? 'rgba(22, 163, 74, 0.9)' : 'rgba(37, 99, 235, 0.9)',
                  color: '#fff', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', padding: '3px 8px', borderRadius: 4, letterSpacing: '0.04em'
                }}>
                  {effectivePhotoType === 'watcher'
                    ? (photoStopContext?.post_validation_photo_url ? 'Watcher Post-Verification' : 'Watcher Pre-Inspection')
                    : 'Driver Collection Photo'}
                </div>
              </div>

              <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--ui-bg)', borderRadius: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <div style={{ fontWeight: 800, fontSize: 13 }}>
                    {photoStopContext?.label || `Stop #${photoStopContext?.stop_order ?? '1'}`}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--ui-text-muted)' }}>
                    {photoStopContext && (
                      effectivePhotoType === 'watcher'
                        ? (photoStopContext.post_validation_timestamp || photoStopContext.pre_validation_timestamp ? new Date(photoStopContext.post_validation_timestamp || photoStopContext.pre_validation_timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Today')
                        : (photoStopContext.collection_timestamp ? new Date(photoStopContext.collection_timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Today')
                    )}
                  </div>
                </div>

                <div style={{ fontSize: 12, color: 'var(--ui-text-muted)', marginTop: 4 }}>
                  {effectivePhotoType === 'watcher' ? (
                    <>
                      <span>Inspected by: </span>
                      <strong style={{ color: 'var(--ui-text)' }}>
                        {photoStopContext?.post_validation_watcher_name || photoStopContext?.pre_validation_watcher_name || 'Ground Watcher'}
                      </strong>
                      {(photoStopContext?.post_validation_remarks || photoStopContext?.pre_validation_remarks || photoStopContext?.dispute_reason) && (
                        <div style={{ marginTop: 4, fontStyle: 'italic' }}>
                          "{photoStopContext.post_validation_remarks || photoStopContext.pre_validation_remarks || photoStopContext.dispute_reason}"
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <span>Captured by: </span>
                      <strong style={{ color: 'var(--ui-text)' }}>
                        {photoStopContext?.driver_name || truck.driverNames}
                      </strong>
                      {photoStopContext?.collection_notes && (
                        <div style={{ marginTop: 4, fontStyle: 'italic' }}>
                          "{photoStopContext.collection_notes}"
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div style={{ padding: '24px 16px', textAlign: 'center', background: 'var(--ui-bg)', borderRadius: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8, color: '#9CA3AF' }}>
                <IcoCamera size={32} color="#9CA3AF" />
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ui-text)' }}>
                No verification photo uploaded for today yet
              </div>
              <div style={{ fontSize: 11, color: 'var(--ui-text-muted)', marginTop: 4, maxWidth: 360, margin: '4px auto 0' }}>
                Ground watcher inspection photos or driver stop collection photos will be displayed here as stops are recorded during the shift.
              </div>
            </div>
          )}
        </div>

        {/* STOP CHECKPOINTS LIST */}
        <div className="flat-card" style={{ padding: '14px 16px' }}>
          <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--ui-text-muted)', marginBottom: 10 }}>
            Route Checkpoints ({sortedStops.length})
          </div>

          {sortedStops.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--ui-text-muted)', textAlign: 'center', padding: '16px 0' }}>
              No stop checkpoints recorded for this route today.
            </div>
          ) : (
            <div style={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {sortedStops.map((s, idx) => {
                const isSelected = selectedStopIdx === idx;
                const hasW = Boolean(s.post_validation_photo_url || s.pre_validation_photo_url);
                const hasD = Boolean(s.collection_photo_url);

                return (
                  <div
                    key={s.id || idx}
                    onClick={() => {
                      setSelectedStopIdx(idx);
                      if (hasW) setActivePhotoType('watcher');
                      else if (hasD) setActivePhotoType('driver');
                    }}
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
                      border: isSelected ? '1px solid #3B82F6' : '1px solid var(--ui-border)',
                      background: isSelected ? 'rgba(59, 130, 246, 0.05)' : 'var(--ui-surface)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
                      <span style={{
                        width: 20, height: 20, borderRadius: '50%',
                        background: '#E5E7EB', color: '#374151',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 700, flexShrink: 0
                      }}>
                        {s.stop_order ?? idx + 1}
                      </span>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <div style={{ fontSize: 12, fontWeight: 700 }}>
                          {s.label || `Stop #${s.stop_order ?? idx + 1}`}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--ui-text-muted)' }}>
                          {s.barangay_name || truck.barangayNames || 'Assigned Zone'}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      {(hasW || hasD) && (
                        <span title={hasW ? 'Watcher photo available' : 'Driver photo available'} style={{ display: 'flex', alignItems: 'center' }}>
                          <IcoCamera size={14} color={hasW ? '#16A34A' : '#2563EB'} />
                        </span>
                      )}
                      <StopStatusBadge status={s.current_status} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  const [mainTab, setMainTab] = useState("drivers");
  const kpiScrollRef = useRef(null);
  const scrollKpis = (direction) => {
    if (!kpiScrollRef.current) return;
    const cardWidth = kpiScrollRef.current.firstElementChild?.offsetWidth || 180;
    const scrollAmount = (cardWidth + 12) * 2;
    kpiScrollRef.current.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth'
    });
  };

  const [stats, setStats] = useState({ total_waste: 0, active_trucks: 0, completed_routes: 0, total_routes: 0, pending_reports: 0 });
  const [drivers, setDrivers] = useState([]);
  const [logs, setLogs] = useState([]);
  const [feed, setFeed] = useState([]);
  const [brgyWaste, setBrgyWaste] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [calendarEvents, setCalendarEvents] = useState([]);
  const [activeShifts, setActiveShifts] = useState([]);

  const [calDayModal, setCalDayModal] = useState(null);
  const [selectedTruckActivity, setSelectedTruckActivity] = useState(null);
  const [calMonth, setCalMonth] = useState(() => new Date().getMonth());
  const [isRouteProgressExpanded, setIsRouteProgressExpanded] = useState(true);
  const [truckFilter, setTruckFilter] = useState('');
  const [calYear, setCalYear] = useState(() => new Date().getFullYear());

  const [loading, setLoading] = useState(true);
  const [initialLoading, setInitialLoading] = useState(true);
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
      if (ok.drivers) setDrivers(Array.isArray(ok.drivers) ? ok.drivers : (ok.drivers?.results || []));
      if (ok.shifts) setActiveShifts(Array.isArray(ok.shifts) ? ok.shifts : (ok.shifts?.results || []));
      if (ok.feed) setFeed((Array.isArray(ok.feed) ? ok.feed : (ok.feed?.results || [])).slice(0, 8));
      if (ok.brgy && ok.brgy.barangay_breakdown) {
        setBrgyWaste(ok.brgy.barangay_breakdown.map(b => ({
          name: b.name,
          kg: b.weight_kg,
          status: b.reports_resolved >= b.reports_total ? 'completed' : 'in-progress'
        })));
      }
      if (ok.schedule) setSchedule(Array.isArray(ok.schedule) ? ok.schedule : (ok.schedule?.results || []));
      if (ok.events) setCalendarEvents(Array.isArray(ok.events) ? ok.events : (ok.events?.results || []));
      if (ok.logs) setLogs(Array.isArray(ok.logs) ? ok.logs : (ok.logs?.results || []));
      setStale(prev => { const n = { ...prev }; keys.forEach(k => { n[k] = !!failed[k]; }); return n; });
      setLastRefreshed(new Date());
    } finally {
      inflightRef.current = false;
      if (!isSilent) setLoading(false);
      setInitialLoading(false);
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
            const dayRoutes = (Array.isArray(schedule) ? schedule : (schedule?.results || [])).filter(s => s && s.status !== 'CANCELLED' && (s.date ? s.date === dateStr : routeMatchesDay(s, cellDayName)));
            const dayEvents = (Array.isArray(calendarEvents) ? calendarEvents : (calendarEvents?.results || [])).filter(e => e && e.date === dateStr);
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

  const scheduleList = useMemo(() => (Array.isArray(schedule) ? schedule : (schedule?.results || [])), [schedule]);
  const eventList = useMemo(() => (Array.isArray(calendarEvents) ? calendarEvents : (calendarEvents?.results || [])), [calendarEvents]);
  const safeEscItems = useMemo(() => (Array.isArray(escItems) ? escItems : []), [escItems]);
  const safeHotspots = useMemo(() => (Array.isArray(hotspots) ? hotspots : []), [hotspots]);

  const todaysRoutes = useMemo(() => scheduleList.filter(s =>
    s && s.status !== 'CANCELLED' &&
    (s.date ? s.date === todayStr : routeMatchesDay(s, todayName))
  ), [scheduleList, todayName, todayStr]);

  const openEsc = useMemo(() => safeEscItems
    .filter(e => !['resolved', 'rejected'].includes(e.status))
    .sort((a, b) => (PRI_RANK[a.priority] ?? 3) - (PRI_RANK[b.priority] ?? 3)), [escItems]);
  const highEsc = openEsc.filter(e => e.priority === 'high');
  const overdueEsc = openEsc.filter(e => e.deadline && e.deadline < todayStr);
  const unassignedEsc = openEsc.filter(e => e.status === 'pending' && !e.assignee && e.priority !== 'high');
  const highUnassigned = highEsc.filter(e => e.status === 'pending' && !e.assignee);
  const highOverdue = highEsc.filter(e => e.deadline && e.deadline < todayStr);
  const needsTruck = h => ['critical', 'high'].includes(h.status) && !h.assigned_truck_id;
  const undispatched = safeHotspots.filter(needsTruck);
  const topHotspots = useMemo(() => [...safeHotspots]
    .sort((a, b) => (SEV_RANK[a.status] ?? 4) - (SEV_RANK[b.status] ?? 4) || b.count - a.count).slice(0, 4), [safeHotspots]);

  const locate = h => {
    setMapFocus({ lat: Number(h.latitude), lng: Number(h.longitude), zoom: 17 });
    document.getElementById('dash-map')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const safeDrivers = useMemo(() => (Array.isArray(drivers) ? drivers : (drivers?.results || [])), [drivers]);

  const fleet = useMemo(() => {
    const truckIds = new Set(safeDrivers.map(t => String(t.id)));
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

    const trucks = safeDrivers.map(truck => {
      const picked = (byTruck[String(truck.id)] || [])
        .sort((a, b) => RANK[a.lifecycle] - RANK[b.lifecycle] || (b.lastSeen || 0) - (a.lastSeen || 0))[0];
      const shift = picked?.sh;
      const lc = picked?.lifecycle;

      const cands = todaysRoutes.filter(s => String(s.truck) === String(truck.id));
      let route;
      if (shift?.schedule_id) route = scheduleList.find(s => s && s.id === shift.schedule_id) || cands[0];
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
        scheduleId: route?.id,
        route,
        shift,
        model: truck.model,
      };
    });
    return { trucks, orphans };
  }, [safeDrivers, activeShifts, schedule, todaysRoutes]);
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
        .dashboard-container, .admin-modal-ov { --ui-border: #e4e6eb; --ui-surface: #ffffff; --ui-bg: #f0f2f5; --ui-text: #1c1e21; --ui-text-muted: #65676b; }
        .dashboard-container { padding: 20px 24px; max-width: 1440px; margin: 0 auto; color: #1c1e21; background: #f0f2f5; min-height: 100vh; }
        .dashboard-container * { scrollbar-width: thin; scrollbar-color: #ced0d4 transparent; }
        
        .flat-card {
          background: #ffffff;
          border: 1px solid #e4e6eb;
          border-radius: 8px;
          padding: 14px 16px;
          box-shadow: 0 1px 2px rgba(0,0,0,0.04);
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }
        .flat-card.hoverable:hover {
          border-color: #16a34a;
          box-shadow: 0 2px 8px rgba(0,0,0,0.06);
        }

        .header-row { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
        .quick-actions { display: flex; gap: 8px; }
        .action-btn {
          display: inline-flex; align-items: center; justify-content: center; gap: 6px;
          background: #ffffff; border: 1px solid #ced0d4;
          padding: 0 12px; height: 36px; border-radius: 6px; font-size: 13px; font-weight: 600;
          color: #1c1e21; cursor: pointer; transition: background 0.14s, border-color 0.14s;
        }
        .action-btn:hover { background: #f0f2f5; border-color: #8a8d91; }

        .kpi-scroll-container {
          margin-bottom: 16px;
          position: relative;
        }
        .kpi-scroll-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
        }
        .kpi-scroll-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 26px;
          height: 26px;
          border-radius: 6px;
          border: 1px solid #ced0d4;
          background: #ffffff;
          color: #1c1e21;
          cursor: pointer;
          transition: background 0.15s, border-color 0.15s;
        }
        .kpi-scroll-btn:hover {
          background: #f0f2f5;
          border-color: #8a8d91;
        }
        .kpi-ribbon {
          display: flex;
          overflow-x: auto;
          overflow-y: hidden;
          gap: 12px;
          padding-bottom: 6px;
          margin-bottom: 0;
          scroll-snap-type: x mandatory;
          scroll-behavior: smooth;
          -webkit-overflow-scrolling: touch;
          scrollbar-width: thin;
          scrollbar-color: rgba(0, 0, 0, 0.2) transparent;
        }
        .kpi-ribbon::-webkit-scrollbar {
          height: 5px;
        }
        .kpi-ribbon::-webkit-scrollbar-track {
          background: transparent;
        }
        .kpi-ribbon::-webkit-scrollbar-thumb {
          background: rgba(0, 0, 0, 0.2);
          border-radius: 4px;
        }
        .kpi-card {
          flex: 0 0 calc((100% - 36px) / 4);
          min-width: calc((100% - 36px) / 4);
          max-width: calc((100% - 36px) / 4);
          scroll-snap-align: start;
          display: flex;
          flex-direction: column;
          position: relative;
          overflow: hidden;
          background: #ffffff;
          border: 1px solid #e4e6eb;
          border-radius: 8px;
          padding: 12px 14px;
          box-sizing: border-box;
        }
        .kpi-card-left-border { display: none; }
        .kpi-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #65676b; font-weight: 700; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .kpi-val { font-size: 22px; font-weight: 800; color: #1c1e21; line-height: 1.1; white-space: nowrap; }
        .kpi-trend { font-size: 11px; font-weight: 600; margin-top: 4px; color: #65676b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

        .map-section {
          width: 100%; height: auto; position: relative; border-radius: 8px; overflow: hidden;
          border: 1px solid #e4e6eb; margin-bottom: 20px; box-shadow: 0 1px 2px rgba(0,0,0,0.04);
        }

        .route-progress-panel { margin-bottom: 20px; }
        .progress-row {
          display: flex; align-items: center; justify-content: space-between; gap: 16px;
          padding: 10px 14px; background: #ffffff; border: 1px solid #e4e6eb;
          border-radius: 6px; margin-bottom: 8px;
        }
        .progress-bar-container { flex: 1; height: 6px; background: #e4e6eb; border-radius: 3px; overflow: hidden; }
        .progress-bar-fill { height: 100%; border-radius: 3px; }

        .main-grid { display: grid; grid-template-columns: minmax(0,1fr) 380px; align-items: start; gap: 16px; }

        .tab-nav {
          display: flex; background: #e4e6eb; padding: 3px; border-radius: 8px; gap: 2px; margin-bottom: 16px; width: fit-content;
        }
        .tab-pill {
          padding: 6px 14px; border-radius: 6px; font-size: 12px; font-weight: 600;
          cursor: pointer; transition: all 0.14s; border: none; background: transparent; color: #65676b;
        }
        .tab-pill.active {
          background: #ffffff; color: #1c1e21; font-weight: 700; box-shadow: 0 1px 2px rgba(0,0,0,0.08);
        }
        .tab-panel {
          max-height: 360px; overflow-y: auto; padding-right: 4px;
          animation: fadeTab 150ms ease-in-out;
        }
        @keyframes fadeTab { from { opacity: 0; } to { opacity: 1; } }

        .sidebar-section { margin-bottom: 20px; }
        .sidebar-title { font-size: 13px; font-weight: 700; color: #1c1e21; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.05em; }

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

        .cal-container { border: 1px solid #e4e6eb; border-radius: 8px; background: #ffffff; overflow: hidden; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
        .cal-head { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid #e4e6eb; }
        .cal-nav { background: none; border: none; font-size: 16px; cursor: pointer; color: #65676b; }
        .cal-month { font-size: 14px; font-weight: 700; color: #1c1e21; }
        .cal-dow { display: grid; grid-template-columns: repeat(7, 1fr); text-align: center; font-size: 10px; font-weight: 700; color: #65676b; padding: 8px 0; border-bottom: 1px solid #e4e6eb; text-transform: uppercase; background: #f8fafc; }
        .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); }
        .cal-cell { padding: 8px 4px; min-height: 54px; display: flex; flex-direction: column; align-items: center; border: none; border-right: 1px solid #e4e6eb; border-bottom: 1px solid #e4e6eb; background: #ffffff; cursor: pointer; }
        .cal-cell:nth-child(7n) { border-right: none; }
        .cal-cell.empty { background: #f8fafc; cursor: default; }
        .cal-cell:hover:not(.empty) { background: #f0fdf4; }
        .cal-date { font-size: 12px; font-weight: 600; color: #1c1e21; margin-bottom: 4px; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; border-radius: 50%; }
        .cal-cell.today .cal-date { background: #16a34a; color: white; }
        .cal-dots { display: flex; gap: 3px; justify-content: center; flex-wrap: wrap; }
        .cal-dot { width: 6px; height: 6px; border-radius: 50%; }

        .status-footer { display: flex; align-items: center; gap: 8px; font-size: 11px; color: #65676b; margin-top: 20px; padding-top: 14px; border-top: 1px solid #e4e6eb; }
        
        .empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 32px 16px; text-align: center; color: #65676b; font-size: 13px; font-weight: 500; }

        .admin-modal-ov { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 9998; display: flex; align-items: center; justify-content: center; padding: 16px; }
        .admin-modal { background: #ffffff; border-radius: 8px; border: 1px solid #e4e6eb; padding: 24px; width: 100%; max-width: 440px; max-height: 85vh; overflow-y: auto; box-shadow: 0 4px 24px rgba(0,0,0,0.15); }

        .rail { position: static; max-height: none; overflow: visible; padding-right: 4px; }
        .kpi-link, .row-btn { text-align: left; font: inherit; color: inherit; cursor: pointer; width: 100%; }
        .kpi-link { width: auto; }
        .link-btn { background: none; border: none; font: inherit; font-size: 11px; font-weight: 700; color: #16a34a; cursor: pointer; padding: 2px 4px; display: inline-flex; align-items: center; }
        .glass { background: rgba(255,255,255,0.95); backdrop-filter: blur(8px); border: 1px solid #e4e6eb; border-radius: 6px; }
        .map-layers { position: absolute; top: 10px; left: 10px; z-index: 5; display: flex; gap: 4px; padding: 4px; }
        .layer-chip { border: none; background: transparent; color: #65676b; font-size: 11px; font-weight: 700; text-transform: capitalize; padding: 4px 8px; border-radius: 4px; cursor: pointer; }
        .layer-chip.on { background: #16a34a; color: #fff; }
        .alert-banner { display: flex; align-items: center; gap: 12px; padding: 10px 14px; margin-bottom: 16px; border-radius: 6px; background: #fef2f2; border: 1px solid #fecaca; }
        .skeleton { height: 56px; border-radius: 6px; margin-bottom: 8px; background: linear-gradient(90deg, #f0f2f5, #ffffff, #f0f2f5); background-size: 200% 100%; animation: sk 1.2s infinite; }
        @keyframes sk { to { background-position: -200% 0; } }
        .stale-pill { font-size: 10px; font-weight: 700; color: #b45309; border: 1px solid #fde68a; background: #fffbeb; border-radius: 4px; padding: 1px 6px; margin-left: 8px; }

        @media (max-width: 1199px) { .main-grid { grid-template-columns: 1fr; } .rail { position: static; max-height: none; overflow: visible; } }
        @media (max-width: 991px) {
          .kpi-card {
            flex: 0 0 calc((100% - 12px) / 2);
            min-width: calc((100% - 12px) / 2);
            max-width: calc((100% - 12px) / 2);
          }
        }
        @media (max-width: 768px) {
          .cal-dot { width: 4px; height: 4px; }
          .cal-cell { min-height: 44px; }
        }
        @media (max-width: 540px) {
          .kpi-card {
            flex: 0 0 160px;
            min-width: 160px;
            max-width: 160px;
          }
        }
      `}</style>

      {toast && (
        <div style={{
          position: "fixed", top: 24, left: "50%", transform: "translateX(-50%)",
          background: "#ffffff", color: "#1c1e21", padding: "10px 18px",
          borderRadius: 6, zIndex: 9999, fontSize: 13, fontWeight: 600,
          border: "1px solid #e4e6eb", borderLeft: "4px solid #16a34a",
          boxShadow: "0 4px 16px rgba(0,0,0,0.1)"
        }}>{toast}</div>
      )}

      <div className="dashboard-container">

        {/* HEADER */}
        <div className="header-row">
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 4px 0", display: "flex", alignItems: "center", gap: 10, color: "#1c1e21", letterSpacing: "-0.02em" }}>
              Admin Command Center
              <span style={{ fontSize: 10, background: "#e7f5eb", color: "#15803d", padding: "2px 7px", borderRadius: 4, border: "1px solid #bbf7d0", fontWeight: 700, letterSpacing: ".05em" }}>CITY ADMIN</span>
              {!apiHealth && (
                <span title={degradedReason} style={{ cursor: "help", display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, background: "#fffbeb", color: "#b45309", padding: "2px 7px", borderRadius: 4, border: "1px solid #fde68a", fontWeight: 700 }}>
                  DEGRADED
                  <IcoInfo size={12} />
                </span>
              )}
            </h1>
            <p style={{ fontSize: 13, color: "#65676b", margin: 0 }}>
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

        <div className="main-grid">
          <div>
            {/* KPI RIBBON (Scrollable, maximum 4 visible cards) */}
            {initialLoading ? (
              <div className="kpi-scroll-container">
                <div className="kpi-ribbon">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="kpi-card" style={{ height: 86 }}>
                      <StatCardSkeleton count={1} />
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="kpi-scroll-container">
                <div className="kpi-scroll-header">
                  <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: '#65676b' }}>
                    Key Performance Metrics ({kpis.length})
                  </span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => scrollKpis('left')}
                      className="kpi-scroll-btn"
                      aria-label="Previous metrics"
                      title="Previous metrics"
                    >
                      <IcoChevronLeft size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => scrollKpis('right')}
                      className="kpi-scroll-btn"
                      aria-label="Next metrics"
                      title="Next metrics"
                    >
                      <IcoChevronRight size={13} />
                    </button>
                  </div>
                </div>

                <div ref={kpiScrollRef} className="kpi-ribbon ww-stagger">
                  {kpis.map((k, i) => {
                    const Tag = k.to ? 'button' : 'div';
                    return (
                      <Tag
                        key={i}
                        className={`flat-card kpi-card${k.to ? ' kpi-link hoverable' : ''}`}
                        style={k.hint ? { cursor: 'help' } : undefined}
                        onClick={k.to ? () => navigate(k.to) : undefined}
                        title={k.hint}
                      >
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
              </div>
            )}

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
                initialLoading ? (
                  <FeedCardSkeleton count={3} compact />
                ) : (
                  <div>
                    {filteredTrucks.length === 0
                      ? <div className="empty-state ww-fade-in">
                        <IcoCheck size={24} color="#16A34A" />
                        <div style={{ marginTop: 8 }}>No trucks match filter</div>
                      </div>
                      : <div className="ww-stagger">
                        {filteredTrucks.map(t => {
                          const statusText = getTruckLabel(t);
                          const isUrgent = t.isLateStart || t.isGhostShift || t.opState === 'abandoned' || t.isPastEndTime;

                          return (
                            <div key={t.id}
                              className="flat-card hoverable"
                              onClick={() => setSelectedTruckActivity(t)}
                              style={{
                                marginBottom: 8,
                                display: 'flex', justifyContent: 'space-between',
                                alignItems: 'center',
                                cursor: 'pointer',
                                opacity: t.opState === 'offline' ? 0.6 : 1,
                                borderColor: isUrgent ? 'rgba(220, 38, 38, 0.3)' : 'var(--ui-border)',
                              }}
                              title="Click to view driver and watcher activity"
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                                <PhaseIndicator phase={phaseOf(t)} size={12} />
                                <div>
                                  <div style={{ fontWeight: 800, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <span>{t.plate}</span>
                                    <span style={{
                                      fontSize: 10, fontWeight: 700, color: '#2563EB', background: 'rgba(37, 99, 235, 0.08)',
                                      padding: '2px 6px', borderRadius: 4, letterSpacing: '0.04em', textTransform: 'uppercase'
                                    }}>
                                      View Activity
                                    </span>
                                  </div>
                                  <div style={{ fontSize: 12, color: 'var(--ui-text-muted)', marginTop: 2 }}>
                                    {t.driverNames} · {t.barangayNames?.split(',')[0] || t.zone || 'Unassigned'}
                                  </div>
                                </div>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <div style={{
                                  fontSize: 11, fontWeight: 700,
                                  color: isUrgent ? '#DC2626' : 'var(--ui-text-muted)',
                                  textTransform: 'uppercase', letterSpacing: '0.05em',
                                }}>
                                  {statusText}
                                </div>
                                <IcoChevronRight size={14} color="var(--ui-text-muted)" />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    }
                  </div>
                )
              )}

              {mainTab === "feed" && (
                initialLoading ? (
                  <FeedCardSkeleton count={3} compact />
                ) : feed.length === 0 ? (
                  <div className="empty-state ww-fade-in"><IcoCheck size={24} color="#16A34A" /><div style={{ marginTop: 8 }}>All clear — no recent activity</div></div>
                ) : (
                  <div className="ww-stagger">
                    {feed.map((f, i) => (
                      <div key={i} className="flat-card" style={{ marginBottom: 8, display: "flex", gap: 12, padding: "12px 16px" }}>
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: FEED_DOT[f.action] || "#9CA3AF", marginTop: 5, flexShrink: 0 }} />
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 500 }}>{f.details}</div>
                          <div style={{ fontSize: 11, color: "var(--ui-text-muted)", marginTop: 4 }}>
                            {new Date(f.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {f.admin_name || 'System'}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              )}

              {mainTab === "chart" && (
                initialLoading ? (
                  <ChartSkeleton height={220} variant="bar" />
                ) : (
                  <div className="flat-card ww-fade-in"><BarChart data={brgyWaste} /></div>
                )
              )}

              {mainTab === "logs" && (
                initialLoading ? (
                  <TableSkeleton rows={4} cols={3} showToolbar={false} />
                ) : logs.length === 0 ? (
                  <div className="empty-state ww-fade-in"><IcoCheck size={24} color="#16A34A" /><div style={{ marginTop: 8 }}>No delivery logs available</div></div>
                ) : (
                  <div className="ww-stagger">
                    {logs.map(l => (
                      <div key={l.id} className="flat-card hoverable" style={{ marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                          <div style={{ fontWeight: 800, fontSize: 14 }}>{l.truck_plate} — {l.dumpsite_name}</div>
                          <div style={{ fontSize: 12, color: "var(--ui-text-muted)", marginTop: 2 }}>
                            {l.driver_name} · <span style={{ fontWeight: 700, color: "var(--ui-text)" }}>{l.estimated_kg} kg</span> · {new Date(l.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                        <FillBadge level={l.fill_level} />
                      </div>
                    ))}
                  </div>
                )
              )}
            </div>
          </div>

          {/* RIGHT COLUMN */}
          <div className="rail">
            {/* TODAY'S ROUTE PROGRESS */}
            <div className="sidebar-section">
              <div
                className="sidebar-title"
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', margin: '0 0 10px' }}
                onClick={() => setIsRouteProgressExpanded(!isRouteProgressExpanded)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>Today's Route Progress</span>
                  <span style={{ fontSize: 11, background: '#E0E7FF', color: '#3730A3', padding: '1px 7px', borderRadius: 10, fontWeight: 700 }}>
                    {todaysRoutes.length}
                  </span>
                </div>
                <div style={{ color: 'var(--ui-text-muted)', display: 'flex', alignItems: 'center' }}>
                  {isRouteProgressExpanded ? <IcoChevronUp size={16} /> : <IcoChevronDown size={16} />}
                </div>
              </div>

              {initialLoading ? (
                <div className="flat-card">
                  <SidebarWidgetSkeleton rows={3} />
                </div>
              ) : isRouteProgressExpanded && (
                <div className="flat-card" style={{ padding: '12px', marginBottom: 20 }}>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                    <input
                      type="text"
                      placeholder="Filter truck, driver..."
                      value={truckFilter}
                      onChange={e => setTruckFilter(e.target.value)}
                      style={{
                        flex: 1, padding: '7px 10px', borderRadius: '6px',
                        border: '1px solid var(--ui-border)',
                        background: 'var(--ui-surface)',
                        color: 'var(--ui-text)', fontSize: 12,
                      }}
                    />
                    <select
                      value={routeDisplayMode}
                      onChange={e => setRouteDisplayMode(e.target.value)}
                      style={{
                        padding: '7px 8px', borderRadius: '6px',
                        border: '1px solid var(--ui-border)',
                        fontSize: 12, cursor: 'pointer',
                        background: 'var(--ui-surface)', color: 'var(--ui-text)'
                      }}
                    >
                      <option value="today">Today</option>
                      <option value="all">All</option>
                    </select>
                  </div>

                  <div className="ww-stagger" style={{ maxHeight: 240, overflowY: 'auto', paddingRight: 2 }}>
                    {(routeDisplayMode === 'today'
                      ? filteredTrucks.filter(t => t.hasRouteToday)
                      : filteredTrucks
                    ).map(t => (
                      <div
                        key={t.id}
                        className="progress-row hoverable"
                        onClick={() => setSelectedTruckActivity(t)}
                        style={{
                          cursor: 'pointer',
                          padding: '8px 10px',
                          marginBottom: 6,
                          opacity: t.opState === 'offline' ? 0.6 : 1,
                        }}
                        title="Click to view driver and watcher activity"
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 90, flex: 1, overflow: 'hidden' }}>
                          <PhaseIndicator phase={phaseOf(t)} size={8} />
                          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <div style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.2 }}>{t.plate}</div>
                            <div style={{ fontSize: 10, color: 'var(--ui-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {t.barangayNames?.split(',')[0] || 'Unassigned'}
                            </div>
                          </div>
                        </div>

                        {t.isOnShift ? (
                          <div style={{ width: 64, margin: '0 8px' }}>
                            <div className="progress-bar-container" style={{ height: 5 }}>
                              <div className="progress-bar-fill" style={{ width: `${t.progressPct}%`, background: getTruckColor(t.id).color }} />
                            </div>
                          </div>
                        ) : null}

                        <div style={{
                          fontSize: 11, fontWeight: 600, flexShrink: 0, textAlign: 'right', whiteSpace: 'nowrap',
                          color: (t.stopsMissed || t.opState === 'abandoned') ? '#D97706' : 'var(--ui-text-muted)',
                        }}>
                          {t.isOnShift ? `${t.completedStops}/${t.totalStops}` : getTruckLabel(t)}
                        </div>
                      </div>
                    ))}

                    {(routeDisplayMode === 'today'
                      ? filteredTrucks.filter(t => t.hasRouteToday)
                      : filteredTrucks
                    ).length === 0 && (
                        <div style={{ padding: '12px 0', fontSize: 12, color: 'var(--ui-text-muted)', textAlign: 'center' }}>
                          No routes match "{truckFilter}"
                        </div>
                      )}
                  </div>
                </div>
              )}
            </div>

            <OnlineUsersList />

            {/* ESCALATIONS */}
            <div className="sidebar-section">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
                <div className="sidebar-title" style={{ margin: 0 }}>Escalation Queue</div>
                <button className="link-btn" onClick={() => navigate('/admin/escalations')}>View all</button>
              </div>
              {escLoading && !openEsc.length ? <SkeletonRows n={3} /> : openEsc.length === 0 ? (
                <div className="empty-state flat-card ww-fade-in">
                  <IcoCheck size={24} color="#16A34A" />
                  <div style={{ marginTop: 8 }}>All clear — no open escalations</div>
                </div>
              ) : (
                <div className="ww-stagger">
                  {openEsc.slice(0, 4).map(e => (
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
                  ))}
                </div>
              )}
            </div>

            {/* HOTSPOTS */}
            <div className="sidebar-section">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
                <div className="sidebar-title" style={{ margin: 0 }}>Hotspot Alerts</div>
                <button className="link-btn" onClick={() => navigate('/admin/hotspots')}>View all</button>
              </div>
              {hsLoading && !topHotspots.length ? <SkeletonRows n={3} /> : topHotspots.length === 0 ? (
                <div className="empty-state flat-card ww-fade-in">
                  <IcoCheck size={24} color="#16A34A" />
                  <div style={{ marginTop: 8 }}>All clear — no hotspots</div>
                </div>
              ) : (
                <div className="ww-stagger">
                  {topHotspots.map(h => (
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
                  ))}
                </div>
              )}
            </div>

            {/* ONLINE USERS */}


            {/* CALENDAR */}
            <div className="sidebar-section">
              <div className="sidebar-title">Schedule</div>
              {initialLoading ? <CalendarSkeleton /> : <div className="ww-fade-in">{renderCalendar()}</div>}
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

      {selectedTruckActivity && (
        <TruckActivityModal
          truck={selectedTruckActivity}
          onClose={() => setSelectedTruckActivity(null)}
        />
      )}

      {assignTarget && <QuickAssign hotspot={assignTarget} onClose={() => setAssignTarget(null)} onDone={success => { setAssignTarget(null); if (success) { refreshHotspots(); showToast("Truck dispatched."); } }} />}
    </>
  );
}
