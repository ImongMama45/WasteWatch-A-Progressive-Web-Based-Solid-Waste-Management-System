/**
 * AdminDashboard.jsx
 * ------------------
 * WasteWatch — City Admin Dashboard
 * Revised from design spec:
 *   - KPI cards (reports, trucks, escalations, waste)
 *   - MiniMap as centerpiece with truck/hotspot legend
 *   - Escalation panel with priority levels (Critical / High / Medium)
 *   - Activity feed (system log) — 2-column on desktop
 *   - Driver Activity, Hotspot Reports, Schedule, Collection Chart tabs
 *   - Same design language as BrgyDashboard.jsx
 *     (CSS variables, .card, .stat-grid, .bcard, .abtn, .fpill, etc.)
 *
 * Place at:  src/pages/admin/AdminDashboard.jsx
 * Route:     /admin/dashboard  (PrivateRoute + role="admin")
 */

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import MiniMap from "../../components/MiniMap";
import api from "../../api/client";

// ─── Mock Data ────────────────────────────────────────────────────────────────

const MOCK_STATS = {
  totalWasteKg: 2450,
  wasteChange: 12,
  activeTrucks: 7,
  delayedTrucks: 2,
  hotspots: 15,
  completedRoutes: 3,
  totalRoutes: 10,
  pendingReports: 24,
  barangaysCovered: 12,
};

const MOCK_ESCALATIONS = [
  { id: "E001", priority: "critical", location: "Near Market, Cotta", type: "Bin overflow", reports: 8, ago: "14m ago", brgy: "Cotta" },
  { id: "E002", priority: "critical", location: "Riverside, Kanlurang", type: "Illegal dump", reports: 6, ago: "31m ago", brgy: "Kanlurang" },
  { id: "E003", priority: "critical", location: "Zone 5 — Purok 7", type: "Missed pickup", reports: 4, ago: "1h ago", brgy: "Gulang-Gulang" },
  { id: "E004", priority: "high", location: "Gulang-Gulang Crossing", type: "Road blockage", reports: 3, ago: "1.5h ago", brgy: "Gulang-Gulang" },
  { id: "E005", priority: "high", location: "Isabang Market St", type: "Overflow", reports: 5, ago: "2h ago", brgy: "Isabang" },
];

const MOCK_DRIVERS = [
  { id: 1, name: "Juan Dela Cruz", route: "Zone 3 — 5th Ave", status: "completed", time: "10:30 AM", km: "0.3 km", truck: "T-01", capacity: 85 },
  { id: 2, name: "Pedro Santos", route: "Zone 1 — Main St", status: "in-progress", time: "10:45 AM", km: "0.5 km", truck: "T-02", capacity: 60 },
  { id: 3, name: "Maria Reyes", route: "Zone 3 — Rizal Ave", status: "issue", time: "11:00 AM", km: "0.2 km", truck: "T-03", capacity: 40 },
  { id: 4, name: "Jose Bautista", route: "Zone 4 — Quezon Blvd", status: "completed", time: "09:50 AM", km: "0.7 km", truck: "T-04", capacity: 92 },
  { id: 5, name: "Ana Mendoza", route: "Zone 5 — Purok 7", status: "in-progress", time: "11:10 AM", km: "0.4 km", truck: "T-05", capacity: 55 },
  { id: 6, name: "Carlo Ramos", route: "Zone 6 — National Rd", status: "completed", time: "09:30 AM", km: "0.6 km", truck: "T-06", capacity: 78 },
  { id: 7, name: "Liza Torres", route: "Zone 7 — Barangay Rd", status: "in-progress", time: "11:20 AM", km: "0.3 km", truck: "T-07", capacity: 30 },
];

const MOCK_HOTSPOTS = [
  { id: 1, location: "Purok 3, Barangay Isabang", type: "Illegal Dumping", severity: "high", reports: 5, date: "Today, 8:12 AM", status: "pending" },
  { id: 2, location: "Near Market, Cotta", type: "Overflow", severity: "high", reports: 8, date: "Today, 9:04 AM", status: "pending" },
  { id: 3, location: "Riverside, Kanlurang", type: "Missed Pickup", severity: "medium", reports: 4, date: "Today, 9:31 AM", status: "pending" },
  { id: 4, location: "Gulang-Gulang Crossing", type: "Illegal Dumping", severity: "high", reports: 7, date: "Today, 7:45 AM", status: "pending" },
  { id: 5, location: "Zone 5 — Purok 7", type: "Missed Pickup", severity: "medium", reports: 3, date: "Today, 10:02 AM", status: "validated" },
  { id: 6, location: "Isabang Market St", type: "Overflow", severity: "medium", reports: 5, date: "Yesterday", status: "validated" },
];

const MOCK_SCHEDULE = [
  { day: "Monday", barangays: ["Isabang", "Cotta", "Ibabang Dupay"], time: "6:00 AM" },
  { day: "Tuesday", barangays: ["Kanlurang Cotta", "Gulang-Gulang"], time: "6:00 AM" },
  { day: "Wednesday", barangays: ["Mayao Crossing", "Barangay 1"], time: "7:00 AM" },
  { day: "Thursday", barangays: ["Isabang", "Cotta"], time: "6:00 AM" },
  { day: "Friday", barangays: ["All Barangays — Market Day"], time: "5:30 AM" },
];

const MOCK_FEED = [
  { type: "danger", msg: "Truck T-02 reported delay — Zone 1, Main St", time: "10:41 AM" },
  { type: "success", msg: "Route completed — Zone 6, T-06 (Carlo Ramos)", time: "10:38 AM" },
  { type: "warning", msg: "Barangay Cotta escalated overflow report to admin", time: "10:29 AM" },
  { type: "info", msg: "Report R-044 validated by Brgy Isabang official", time: "10:22 AM" },
  { type: "danger", msg: "Hotspot H2 flagged critical — 8 community reports", time: "10:15 AM" },
  { type: "success", msg: "Dispatch order sent to T-05 for Zone 5 hotspot", time: "10:08 AM" },
  { type: "info", msg: "Weekly collection summary auto-generated", time: "9:50 AM" },
  { type: "warning", msg: "T-07 capacity at 30% — low fill rate alert", time: "9:44 AM" },
];

const MOCK_BARANGAY_WASTE = [
  { name: "Isabang", kg: 520, status: "completed" },
  { name: "Kanlurang Cotta", kg: 310, status: "in-progress" },
  { name: "Cotta", kg: 470, status: "completed" },
  { name: "Ibabang Dupay", kg: 380, status: "completed" },
  { name: "Gulang-Gulang", kg: 290, status: "issue" },
  { name: "Mayao Crossing", kg: 480, status: "completed" },
];


// ─── Priority config ──────────────────────────────────────────────────────────

const PRIORITY = {
  critical: {
    label: "Critical",
    barColor: "var(--danger)",
    bgColor: "rgba(231,76,60,0.07)",
    borderColor: "rgba(231,76,60,0.28)",
    textColor: "var(--danger)",
  },
  high: {
    label: "High",
    barColor: "var(--warning)",
    bgColor: "rgba(243,156,18,0.07)",
    borderColor: "rgba(243,156,18,0.28)",
    textColor: "var(--warning)",
  },
  medium: {
    label: "Medium",
    barColor: "var(--accent)",
    bgColor: "rgba(46,204,113,0.07)",
    borderColor: "rgba(46,204,113,0.28)",
    textColor: "var(--accent)",
  },
};

const FEED_DOT = {
  danger: "var(--danger)",
  warning: "var(--warning)",
  success: "var(--accent)",
  info: "#378ADD",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const map = {
    completed: { label: "COMPLETED", color: "var(--accent)", bg: "rgba(46,204,113,0.1)", border: "rgba(46,204,113,0.28)" },
    "in-progress": { label: "IN PROGRESS", color: "var(--warning)", bg: "rgba(243,156,18,0.1)", border: "rgba(243,156,18,0.28)" },
    issue: { label: "ISSUE", color: "var(--danger)", bg: "rgba(231,76,60,0.1)", border: "rgba(231,76,60,0.28)" },
    pending: { label: "PENDING", color: "var(--warning)", bg: "rgba(243,156,18,0.1)", border: "rgba(243,156,18,0.28)" },
    validated: { label: "VALIDATED", color: "var(--accent)", bg: "rgba(46,204,113,0.1)", border: "rgba(46,204,113,0.28)" },
  };
  const s = map[status] || { label: status.toUpperCase(), color: "var(--text-muted)", bg: "var(--surface-2)", border: "var(--border)" };
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
  const max = Math.max(...data.map(d => d.kg));
  const color = (s) =>
    s === "issue" ? "var(--danger)" : s === "in-progress" ? "var(--warning)" : "var(--accent)";
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 110, padding: "0 4px" }}>
      {data.map((d, i) => (
        <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
          <span style={{ fontSize: 9, color: "var(--text-muted)", fontWeight: 600 }}>{d.kg}</span>
          <div style={{
            width: "100%", height: Math.round((d.kg / max) * 82),
            background: color(d.status), borderRadius: "4px 4px 0 0",
            opacity: 0.85, transition: "height .4s",
          }} title={`${d.name}: ${d.kg}kg`} />
          <span style={{ fontSize: 9, color: "var(--text-muted)", textAlign: "center", lineHeight: 1.2 }}>
            {d.name.split(" ")[0]}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const navigate = useNavigate();

  const [mainTab, setMainTab] = useState("drivers");
  const [hotspotFilter, setHotspotFilter] = useState("all");
  const [expandedDriver, setExpandedDriver] = useState(null);
  const [expandedEsc, setExpandedEsc] = useState(null);
  const [escalations, setEscalations] = useState(MOCK_ESCALATIONS);
  const [hotspots, setHotspots] = useState(MOCK_HOTSPOTS);
  const [toast, setToast] = useState(null);

  const today = new Date().toLocaleDateString("en-US", { weekday: "long" });
  const openEscCount = escalations.length;
  const criticalCount = escalations.filter(e => e.priority === "critical").length;
  const pendingHots = hotspots.filter(h => h.status === "pending").length;

  useEffect(() => {
    // Replace with real API call when backend is ready
    // api.get("/api/admin/stats/").then(r => setStats(r.data)).catch(() => {});
  }, []);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 3200);
  }

  function resolveEscalation(id) {
    setEscalations(prev => prev.filter(e => e.id !== id));
    setExpandedEsc(null);
    showToast("Escalation resolved. Barangay has been notified.");
  }

  function dispatchTruck(id) {
    setEscalations(prev => prev.filter(e => e.id !== id));
    setExpandedEsc(null);
    showToast("🚛 Dispatch order sent to nearest available truck.");
  }

  function validateHotspot(id) {
    setHotspots(prev => prev.map(h => h.id === id ? { ...h, status: "validated" } : h));
    showToast(" Hotspot validated. Added to driver schedule.");
  }

  function dismissHotspot(id) {
    setHotspots(prev => prev.filter(h => h.id !== id));
    showToast("✕ Hotspot dismissed.");
  }

  const filteredHotspots = hotspotFilter === "all"
    ? hotspots
    : hotspots.filter(h => h.status === hotspotFilter);


  return (
    <>

      <style>{`
        @keyframes fadeSlideIn {
          from { opacity:0; transform:translateY(-8px); }
          to   { opacity:1; transform:translateY(0); }
        }
        @keyframes slideDown {
          from { opacity:0; transform:translateY(-5px); }
          to   { opacity:1; transform:translateY(0); }
        }
        .bcard { transition: box-shadow .18s, border-color .18s; }
        .bcard:hover { box-shadow: 0 4px 18px rgba(0,0,0,.08); }
        .abtn  { transition: opacity .15s, transform .1s; cursor:pointer; }
        .abtn:hover  { opacity:.86; }
        .abtn:active { transform:scale(.97); }
        .fpill { transition: all .15s; cursor:pointer; }
        .fpill:hover { opacity:.82; }
        .esc-row { transition: background .15s; cursor:pointer; }
        .esc-row:hover { background: var(--surface-2) !important; }
        .feed-grid { display:grid; grid-template-columns:1fr 1fr; gap:0 24px; }
        @media(max-width:640px) { .feed-grid { grid-template-columns:1fr; } }
      `}</style>

      {/* ── Toast ── */}
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

        {/* ── Page header ── */}
        <div style={{ marginBottom: 20, display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 3 }}>
              <h2 style={{ fontFamily: "var(--font-head)", fontSize: 22, fontWeight: 800, margin: 0 }}>
                Admin Dashboard
              </h2>
              <span style={{
                background: "rgba(231,76,60,0.1)", color: "var(--danger)",
                border: "1px solid rgba(231,76,60,0.28)",
                fontSize: 9, fontWeight: 800, padding: "3px 10px",
                borderRadius: 20, letterSpacing: ".08em",
              }}>CITY ADMIN</span>
            </div>
            <p className="text-muted text-sm">Lucena City · Citywide operations &amp; monitoring</p>
          </div>


        </div>

        {/* ── Hero KPI strip ── */}
        <div className="card" style={{
          background: "var(--surface-3, #0f172a)",
          border: "1px solid rgba(255,255,255,0.06)",
          marginBottom: 20, padding: "20px 18px",
          position: "relative", overflow: "hidden",
        }}>
          <span style={{
            position: "absolute", right: -8, bottom: -12,
            fontSize: 80, opacity: .05, transform: "scaleX(-1)", userSelect: "none",
          }}>🚛</span>

          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em", color: "rgba(255,255,255,0.45)", textTransform: "uppercase", marginBottom: 8 }}>
            Total Waste Collected Today
          </div>
          <div style={{ fontSize: 48, fontWeight: 800, lineHeight: 1, letterSpacing: -2, color: "#fff", marginBottom: 6 }}>
            2,450 <span style={{ fontSize: 26, fontWeight: 700 }}>KG</span>
          </div>
          <div style={{ fontSize: 12, color: "var(--accent)", marginBottom: 16 }}>
            ▲ +{MOCK_STATS.wasteChange}% from last week
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {[
              { label: "BARANGAYS", value: MOCK_STATS.barangaysCovered, color: "#fff" },
              { label: "ESCALATIONS", value: openEscCount, color: "var(--danger)" },
              { label: "STATUS", value: "Operational", color: "var(--accent)" },
            ].map(s => (
              <div key={s.label} style={{
                flex: 1, background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 10, padding: "9px 12px",
              }}>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".08em", color: "rgba(255,255,255,0.4)", marginBottom: 4 }}>
                  {s.label}
                </div>
                <div style={{ fontSize: typeof s.value === "string" ? 13 : 20, fontWeight: 800, color: s.color }}>
                  {s.value}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── KPI stat cards ── */}
        <div className="stat-grid" style={{ marginBottom: 20 }}>
          {[
            { label: "Open Reports", value: MOCK_STATS.pendingReports, color: "var(--danger)", icon: "📋", sub: "Awaiting dispatch", route: "/admin/reports" },
            { label: "Active Trucks", value: MOCK_STATS.activeTrucks, color: "var(--warning)", icon: "🚛", sub: `${MOCK_STATS.delayedTrucks} delayed`, route: "/admin/trucks" },
            { label: "Escalations", value: openEscCount, color: "var(--danger)", icon: "⚠️", sub: `${criticalCount} critical`, route: null },
            { label: "Routes Completed", value: MOCK_STATS.completedRoutes, color: "var(--accent)", icon: "✅", sub: `of ${MOCK_STATS.totalRoutes} total`, route: "/admin/routes" },
          ].map(s => (
            <div key={s.label} className="stat-card abtn"
              onClick={() => s.route && navigate(s.route)}
              style={{ position: "relative", overflow: "hidden", cursor: s.route ? "pointer" : "default" }}>
              <div style={{ position: "absolute", top: 10, right: 12, fontSize: 16, opacity: .12 }}>{s.icon}</div>
              <div className="label">{s.label}</div>
              <div className="value" style={{ color: s.color, fontSize: 30 }}>{s.value}</div>
              <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>{s.sub}</div>
            </div>
          ))}
        </div>

        {/* ── Critical escalation alert banner ── */}
        {criticalCount > 0 && (
          <div style={{
            background: "rgba(231,76,60,0.05)",
            border: "1.5px solid rgba(231,76,60,0.28)",
            borderRadius: 12, padding: "12px 16px", marginBottom: 18,
            display: "flex", alignItems: "center", gap: 12,
            animation: "fadeSlideIn .25s",
          }}>
            <div style={{
              width: 38, height: 38, borderRadius: 10, flexShrink: 0,
              background: "rgba(231,76,60,0.1)",
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16,
            }}>🚨</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--danger)", marginBottom: 1 }}>
                {criticalCount} critical escalation{criticalCount > 1 ? "s" : ""} require immediate action
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                Raised by barangay officials — review and dispatch or resolve.
              </div>
            </div>
            <button className="abtn"
              onClick={() => document.getElementById("esc-panel")?.scrollIntoView({ behavior: "smooth" })}
              style={{
                background: "var(--danger)", color: "#fff", border: "none",
                borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 700, flexShrink: 0,
                fontFamily: "var(--font-body)",
              }}>View</button>
          </div>
        )}

        <div className="page-grid">

          {/* ═══════════════════════════════
              MAIN COLUMN
          ═══════════════════════════════ */}
          <div>

            {/* ── Live Map — centerpiece ── */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <h3 className="section-title" style={{ margin: 0 }}>Live Operations Map</h3>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{
                    fontSize: 9, fontWeight: 800, padding: "3px 9px", borderRadius: 20, letterSpacing: ".05em",
                    background: "rgba(46,204,113,0.1)", color: "var(--accent)",
                    border: "1px solid rgba(46,204,113,0.28)",
                  }}>LIVE</span>
                  <button onClick={() => navigate("/map")} style={{
                    background: "none", border: "none", color: "var(--accent)",
                    fontSize: 12, fontWeight: 700, cursor: "pointer",
                  }}>Full View ›</button>
                </div>
              </div>

              <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                <MiniMap />
                {/* Legend bar */}
                <div style={{
                  padding: "10px 14px", borderTop: "1px solid var(--border)",
                  display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center",
                }}>
                  {[
                    { color: "#378ADD", label: "Collecting", round: true },
                    { color: "var(--danger)", label: "Delayed", round: true },
                    { color: "var(--warning)", label: "Hotspot", round: true, dashed: true },
                    { color: "var(--accent)", label: "Dumpsite", round: false },
                  ].map(l => (
                    <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-muted)" }}>
                      <div style={{
                        width: l.round ? 9 : 12, height: l.round ? 9 : 7,
                        borderRadius: l.round ? "50%" : 2,
                        background: l.color, opacity: .85,
                        outline: l.dashed ? `1.5px dashed ${l.color}` : "none",
                        outlineOffset: 1,
                      }} />
                      {l.label}
                    </div>
                  ))}
                  <div style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-muted)" }}>
                    {MOCK_STATS.activeTrucks} trucks · {MOCK_STATS.hotspots} hotspots
                  </div>
                </div>
              </div>
            </div>

            {/* ── Escalation panel ── */}
            <div id="esc-panel" style={{ marginBottom: 24 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <h3 className="section-title" style={{ margin: 0 }}>Escalation Queue</h3>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{
                    fontSize: 9, fontWeight: 800, padding: "3px 9px", borderRadius: 20,
                    background: "rgba(231,76,60,0.1)", color: "var(--danger)",
                    border: "1px solid rgba(231,76,60,0.28)",
                  }}>{openEscCount} OPEN</span>
                  <button onClick={() => navigate("/admin/escalations")} style={{
                    background: "none", border: "none", color: "var(--accent)",
                    fontSize: 12, fontWeight: 700, cursor: "pointer",
                  }}>All ›</button>
                </div>
              </div>

              {escalations.length === 0 ? (
                <div className="card" style={{ textAlign: "center", padding: "32px 20px" }}>
                  <div style={{ fontWeight: 700, marginBottom: 4, color: "var(--text)" }}>No open escalations</div>
                  <div className="text-muted text-sm">All barangay issues have been resolved.</div>
                </div>
              ) : (
                escalations.map(e => {
                  const p = PRIORITY[e.priority];
                  const isOpen = expandedEsc === e.id;
                  return (
                    <div key={e.id} className="bcard esc-row" style={{
                      background: isOpen ? p.bgColor : "var(--surface)",
                      border: isOpen ? `1.5px solid ${p.borderColor}` : "1px solid var(--border)",
                      borderRadius: 14, marginBottom: 8, overflow: "hidden",
                    }} onClick={() => setExpandedEsc(prev => prev === e.id ? null : e.id)}>

                      <div style={{ padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                        {/* Priority bar */}
                        <div style={{ width: 3, height: 38, borderRadius: 2, background: p.barColor, flexShrink: 0 }} />

                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", marginBottom: 2 }}>
                            <span style={{
                              fontWeight: 700, fontSize: 13, color: "var(--text)",
                              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 180,
                            }}>{e.location}</span>
                            <span style={{
                              fontSize: 9, fontWeight: 800, padding: "2px 8px", borderRadius: 20,
                              background: p.bgColor, color: p.textColor, border: `1px solid ${p.borderColor}`,
                            }}>{p.label.toUpperCase()}</span>
                          </div>
                          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                            {e.type} · {e.reports} reports · Brgy {e.brgy}
                          </div>
                        </div>

                        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, flexShrink: 0 }}>
                          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{e.ago}</span>
                          <span style={{
                            fontSize: 14, color: "var(--text-muted)",
                            transform: isOpen ? "rotate(90deg)" : "rotate(0)", transition: "transform .2s",
                          }}>›</span>
                        </div>
                      </div>

                      {/* Expanded actions */}
                      {isOpen && (
                        <div style={{ borderTop: `1px solid ${p.borderColor}`, padding: "12px 14px", animation: "slideDown .18s" }}
                          onClick={ev => ev.stopPropagation()}>
                          <div style={{
                            background: p.bgColor, border: `1px solid ${p.borderColor}`,
                            borderRadius: 8, padding: "9px 12px", marginBottom: 12,
                            fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6,
                          }}>
                            <strong style={{ color: p.textColor }}>Escalated by Brgy {e.brgy}.</strong>{" "}
                            {e.type} with {e.reports} community reports. Admin action required.
                          </div>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <button className="abtn" onClick={() => navigate("/map")} style={{
                              flex: 1, minWidth: 90,
                              background: "rgba(55,138,221,0.08)", border: "1px solid rgba(55,138,221,0.35)",
                              color: "#185FA5", borderRadius: 10,
                              padding: "9px", fontWeight: 700, fontSize: 12, fontFamily: "var(--font-body)",
                            }}>🗺 View on Map</button>
                            <button className="abtn" onClick={() => dispatchTruck(e.id)} style={{
                              flex: 1, minWidth: 90,
                              background: "rgba(243,156,18,0.08)", border: "1px solid rgba(243,156,18,0.35)",
                              color: "var(--warning)", borderRadius: 10,
                              padding: "9px", fontWeight: 700, fontSize: 12, fontFamily: "var(--font-body)",
                            }}>🚛 Dispatch Truck</button>
                            <button className="abtn" onClick={() => resolveEscalation(e.id)} style={{
                              flex: "1 1 100%",
                              background: "var(--accent)", color: "#0d1117", border: "none",
                              borderRadius: 10, padding: "9px",
                              fontWeight: 700, fontSize: 12, fontFamily: "var(--font-body)",
                            }}>✓ Mark Resolved</button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* ── Main tabs ── */}
            <div style={{
              display: "flex", gap: 4, marginBottom: 16,
              background: "var(--surface-2)", borderRadius: 10, padding: 4,
              width: "fit-content", flexWrap: "wrap",
            }}>
              {[
                { key: "drivers", label: "Driver Activity", badge: MOCK_DRIVERS.filter(d => d.status === "issue").length || null },
                { key: "hotspots", label: "Hotspot Reports", badge: pendingHots || null },
                { key: "schedule", label: "Schedule" },
                { key: "chart", label: "Collection Chart" },
              ].map(t => (
                <button key={t.key} className="abtn" onClick={() => setMainTab(t.key)} style={{
                  position: "relative", padding: "8px 14px", borderRadius: 8,
                  border: "none", fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 600,
                  background: mainTab === t.key ? "var(--surface-3)" : "transparent",
                  color: mainTab === t.key ? "#fff" : "var(--text-muted)",
                  boxShadow: mainTab === t.key ? "0 2px 8px rgba(0,0,0,.15)" : "none",
                }}>
                  {t.label}
                  {t.badge && (
                    <span style={{
                      position: "absolute", top: 5, right: 5,
                      minWidth: 15, height: 15, background: "var(--danger)",
                      color: "#fff", fontSize: 8, fontWeight: 800, borderRadius: 20,
                      display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px",
                    }}>{t.badge}</span>
                  )}
                </button>
              ))}
            </div>

            {/* ════ TAB — DRIVER ACTIVITY ════ */}
            {mainTab === "drivers" && (
              <div style={{ animation: "slideDown .2s" }}>
                <button onClick={() => navigate("/admin/trucks")} style={{
                  display: "block", marginBottom: 14, marginLeft: "auto",
                  border: "1px dashed var(--border)", borderRadius: 20,
                  padding: "8px 14px", fontSize: 12, fontWeight: 600,
                  background: "transparent", color: "var(--text-muted)", cursor: "pointer",
                  fontFamily: "var(--font-body)",
                }}>Manage All Trucks ›</button>

                {MOCK_DRIVERS.map(d => (
                  <div key={d.id} className="bcard" style={{
                    background: "var(--surface)",
                    border: d.status === "issue"
                      ? "1.5px solid rgba(231,76,60,0.4)" : "1px solid var(--border)",
                    borderRadius: 14, marginBottom: 8, overflow: "hidden", cursor: "pointer",
                  }} onClick={() => setExpandedDriver(p => p === d.id ? null : d.id)}>

                    <div style={{ padding: "12px 14px", display: "flex", alignItems: "center", gap: 12 }}>
                      <div style={{
                        width: 38, height: 38, borderRadius: 10, flexShrink: 0,
                        background: "var(--surface-2)",
                        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16,
                      }}>🚛</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", marginBottom: 2 }}>
                          <span style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>{d.name}</span>
                          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{d.truck}</span>
                          <StatusBadge status={d.status} />
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                          {d.route} · {d.time} · {d.km}
                        </div>
                        {/* Mini capacity bar inline */}
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                          <div style={{ background: "var(--border)", borderRadius: 20, height: 5, overflow: "hidden", width: 70 }}>
                            <div style={{
                              height: "100%", borderRadius: 20, width: `${d.capacity}%`,
                              background: d.capacity > 80 ? "var(--danger)" : d.capacity > 55 ? "var(--warning)" : "var(--accent)",
                            }} />
                          </div>
                          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{d.capacity}%</span>
                        </div>
                      </div>
                      <div style={{
                        fontSize: 14, color: "var(--text-muted)",
                        transform: expandedDriver === d.id ? "rotate(90deg)" : "rotate(0)", transition: "transform .2s",
                      }}>›</div>
                    </div>

                    {expandedDriver === d.id && (
                      <div style={{ borderTop: "1px solid var(--border)", padding: "12px 14px", animation: "slideDown .18s" }}
                        onClick={ev => ev.stopPropagation()}>
                        {/* Full capacity bar */}
                        <div style={{ marginBottom: 12 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                            <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", letterSpacing: ".06em" }}>TRUCK CAPACITY</span>
                            <span style={{ fontSize: 12, fontWeight: 700, color: d.capacity > 80 ? "var(--danger)" : "var(--text-muted)" }}>
                              {d.capacity}%
                            </span>
                          </div>
                          <div style={{ background: "var(--border)", borderRadius: 20, height: 7, overflow: "hidden" }}>
                            <div style={{
                              height: "100%", borderRadius: 20, width: `${d.capacity}%`,
                              background: d.capacity > 80 ? "var(--danger)" : d.capacity > 55 ? "var(--warning)" : "var(--accent)",
                              transition: "width .4s",
                            }} />
                          </div>
                        </div>

                        <div style={{
                          background: d.status === "issue" ? "rgba(231,76,60,0.05)" : "rgba(46,204,113,0.05)",
                          border: `1px solid ${d.status === "issue" ? "rgba(231,76,60,0.2)" : "rgba(46,204,113,0.2)"}`,
                          borderRadius: 8, padding: "8px 12px", marginBottom: 12,
                          fontSize: 12, lineHeight: 1.5, color: "var(--text-muted)",
                        }}>
                          {d.status === "issue"
                            ? <><strong style={{ color: "var(--danger)" }}>Issue reported.</strong> Driver flagged a problem on this route.</>
                            : <><strong style={{ color: "var(--accent)" }}>On schedule.</strong> No issues on this route.</>
                          }
                        </div>

                        <div style={{ display: "flex", gap: 8 }}>
                          <button className="abtn" onClick={() => navigate("/map")} style={{
                            flex: 1, background: "rgba(20,184,166,0.08)", border: "1px solid rgba(20,184,166,0.35)",
                            color: "var(--accent)", borderRadius: 10, padding: "9px",
                            fontWeight: 700, fontSize: 12, fontFamily: "var(--font-body)",
                          }}>🗺 Track on Map</button>
                          <button className="abtn" onClick={() => showToast("🚩 Driver flagged. Supervisor notified.")} style={{
                            flex: 1, background: "rgba(231,76,60,0.06)", border: "1px solid rgba(231,76,60,0.35)",
                            color: "var(--danger)", borderRadius: 10, padding: "9px",
                            fontWeight: 700, fontSize: 12, fontFamily: "var(--font-body)",
                          }}>🚩 Flag Issue</button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* ════ TAB — HOTSPOT REPORTS ════ */}
            {mainTab === "hotspots" && (
              <div style={{ animation: "slideDown .2s" }}>
                <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
                  {["all", "pending", "validated"].map(f => (
                    <button key={f} className="fpill" onClick={() => setHotspotFilter(f)} style={{
                      padding: "5px 14px", borderRadius: 20, border: "1px solid",
                      fontSize: 12, fontWeight: 600, fontFamily: "var(--font-body)",
                      borderColor: hotspotFilter === f ? "var(--accent)" : "var(--border)",
                      color: hotspotFilter === f ? "var(--accent)" : "var(--text-muted)",
                      background: hotspotFilter === f ? "rgba(46,204,113,0.08)" : "transparent",
                    }}>{f.charAt(0).toUpperCase() + f.slice(1)}</button>
                  ))}
                  <button onClick={() => navigate("/admin/hotspots")} style={{
                    border: "1px dashed var(--border)", borderRadius: 20,
                    padding: "5px 14px", fontSize: 12, fontWeight: 600,
                    marginLeft: "auto", background: "transparent",
                    color: "var(--text-muted)", cursor: "pointer", fontFamily: "var(--font-body)",
                  }}>View All ›</button>
                </div>

                {filteredHotspots.map(h => (
                  <div key={h.id} className="bcard" style={{
                    background: "var(--surface)", border: "1px solid var(--border)",
                    borderRadius: 14, marginBottom: 8, overflow: "hidden",
                  }}>
                    <div style={{ padding: "12px 14px", display: "flex", alignItems: "flex-start", gap: 12 }}>
                      <div style={{
                        width: 38, height: 38, borderRadius: 10, flexShrink: 0,
                        background: h.severity === "high" ? "rgba(231,76,60,0.1)" : "rgba(243,156,18,0.1)",
                        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16,
                      }}>
                        {h.type === "Illegal Dumping" ? "🚯" : h.type === "Overflow" ? "🗑️" : "📭"}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", marginBottom: 3 }}>
                          <SeverityDot severity={h.severity} />
                          <span style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>{h.location}</span>
                          <StatusBadge status={h.status} />
                        </div>
                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>📋 {h.type}</span>
                          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>📣 {h.reports} reports</span>
                          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>🕐 {h.date}</span>
                        </div>
                      </div>
                    </div>

                    {h.status === "pending" && (
                      <div style={{ borderTop: "1px solid var(--border)", padding: "10px 14px", display: "flex", gap: 8 }}>
                        <button className="abtn" onClick={() => dismissHotspot(h.id)} style={{
                          flex: 1, background: "transparent", border: "1.5px solid var(--danger)",
                          color: "var(--danger)", borderRadius: 10, padding: "8px",
                          fontWeight: 700, fontSize: 12, fontFamily: "var(--font-body)",
                        }}>✕ Dismiss</button>
                        <button className="abtn" onClick={() => navigate("/admin/hotspots")} style={{
                          flex: 1, background: "rgba(46,204,113,0.08)", border: "1px solid rgba(46,204,113,0.35)",
                          color: "var(--accent)", borderRadius: 10, padding: "8px",
                          fontWeight: 700, fontSize: 12, fontFamily: "var(--font-body)",
                        }}>Details</button>
                        <button className="abtn" onClick={() => validateHotspot(h.id)} style={{
                          flex: 1, background: "var(--accent)", color: "#0d1117", border: "none",
                          borderRadius: 10, padding: "8px",
                          fontWeight: 700, fontSize: 12, fontFamily: "var(--font-body)",
                        }}>✓ Validate</button>
                      </div>
                    )}
                    {h.status === "validated" && (
                      <div style={{ borderTop: "1px solid var(--border)", padding: "10px 14px" }}>
                        <button className="abtn" onClick={() => navigate("/map")} style={{
                          width: "100%", background: "rgba(20,184,166,0.08)",
                          border: "1px solid rgba(20,184,166,0.35)", color: "var(--accent)",
                          borderRadius: 10, padding: "8px",
                          fontWeight: 700, fontSize: 12, fontFamily: "var(--font-body)",
                        }}>🗺 View on Map</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* ════ TAB — SCHEDULE ════ */}
            {mainTab === "schedule" && (
              <div style={{ animation: "slideDown .2s" }}>
                <button onClick={() => navigate("/admin/schedule")} style={{
                  display: "block", marginBottom: 14, marginLeft: "auto",
                  border: "1px dashed var(--border)", borderRadius: 20,
                  padding: "8px 14px", fontSize: 12, fontWeight: 600,
                  background: "transparent", color: "var(--text-muted)", cursor: "pointer",
                  fontFamily: "var(--font-body)",
                }}>Manage Full Schedule ›</button>
                <div className="card" style={{ padding: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text)" }}>Collection Schedule</div>
                    <button className="abtn" style={{
                      background: "var(--accent)", color: "#0d1117", border: "none",
                      borderRadius: 8, padding: "5px 12px", fontSize: 11, fontWeight: 700,
                      fontFamily: "var(--font-body)",
                    }}>+ Add</button>
                  </div>
                  {MOCK_SCHEDULE.map((s, i) => {
                    const isToday = s.day === today;
                    return (
                      <div key={i} style={{
                        display: "flex", alignItems: "center", gap: 12, padding: "12px 0",
                        borderBottom: i < MOCK_SCHEDULE.length - 1 ? "1px solid var(--border)" : "none",
                      }}>
                        <div style={{
                          width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                          background: isToday ? "var(--surface-3, #1e293b)" : "var(--surface-2)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 10, fontWeight: 800,
                          color: isToday ? "#fff" : "var(--text-muted)",
                        }}>{s.day.slice(0, 3).toUpperCase()}</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: isToday ? 700 : 500, color: "var(--text)", display: "flex", alignItems: "center", gap: 6 }}>
                            {s.day}
                            {isToday && (
                              <span style={{
                                fontSize: 9, background: "rgba(46,204,113,0.1)", color: "var(--accent)",
                                border: "1px solid rgba(46,204,113,0.28)", borderRadius: 20,
                                padding: "1px 7px", fontWeight: 800, letterSpacing: ".05em",
                              }}>TODAY</span>
                            )}
                          </div>
                          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                            {s.barangays.join(", ")}
                          </div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--accent)" }}>{s.time}</div>
                          <div style={{ fontSize: 9, color: "var(--text-muted)" }}>Active</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ════ TAB — COLLECTION CHART ════ */}
            {mainTab === "chart" && (
              <div style={{ animation: "slideDown .2s" }}>
                <div className="card">
                  <div style={{ padding: "14px 14px 0" }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text)", marginBottom: 14 }}>
                      Waste Collected per Barangay
                    </div>
                    <BarChart data={MOCK_BARANGAY_WASTE} />
                    <div style={{ display: "flex", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
                      {[["var(--accent)", "Completed"], ["var(--warning)", "In Progress"], ["var(--danger)", "Issue"]].map(([color, label]) => (
                        <div key={label} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-muted)" }}>
                          <div style={{ width: 10, height: 10, borderRadius: 3, background: color, opacity: .85 }} />
                          {label}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div style={{ padding: "12px 14px 14px", borderTop: "1px solid var(--border)", marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
                    <button className="abtn" onClick={() => navigate("/admin/reports")} style={{
                      background: "rgba(46,204,113,0.08)", border: "1px solid rgba(46,204,113,0.35)",
                      color: "var(--accent)", borderRadius: 10, padding: "8px 20px",
                      fontSize: 12, fontWeight: 700, fontFamily: "var(--font-body)",
                    }}>See Full Report ›</button>
                  </div>
                </div>
              </div>
            )}

            {/* ── Activity Feed ── */}
            <div style={{ marginTop: 28 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <h3 className="section-title" style={{ margin: 0 }}>Activity Feed</h3>
                <button onClick={() => navigate("/admin/activity-log")} style={{
                  background: "none", border: "none", color: "var(--accent)",
                  fontSize: 12, fontWeight: 700, cursor: "pointer",
                }}>Full Log ›</button>
              </div>
              <div className="card" style={{ padding: "10px 14px" }}>
                <div className="feed-grid">
                  {MOCK_FEED.map((f, i) => (
                    <div key={i} style={{
                      display: "flex", alignItems: "flex-start", gap: 10,
                      padding: "9px 0", borderBottom: "0.5px solid var(--border)",
                    }}>
                      <div style={{
                        width: 7, height: 7, borderRadius: "50%",
                        background: FEED_DOT[f.type] || "var(--text-muted)",
                        flexShrink: 0, marginTop: 5,
                      }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: "var(--text)", lineHeight: 1.4 }}>{f.msg}</div>
                        <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>{f.time}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

          </div>{/* end main column */}

          {/* ═══════════════════════════════
              SIDEBAR (desktop only)
          ═══════════════════════════════ */}
          <div className="sidebar">

            <div className="card">
              <h3 className="section-title" style={{ marginBottom: 12, fontSize: 15 }}>Quick Actions</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {[
                  { label: "🗺 Live Map", bg: "rgba(20,184,166,0.08)", border: "rgba(20,184,166,0.35)", color: "var(--accent)", route: "/map" },
                  { label: "🚛 Manage Trucks", bg: "rgba(243,156,18,0.08)", border: "rgba(243,156,18,0.35)", color: "var(--warning)", route: "/admin/trucks" },
                  { label: "📅 Full Schedule", bg: "rgba(46,204,113,0.08)", border: "rgba(46,204,113,0.35)", color: "var(--accent)", route: "/schedule" },
                  { label: "📤 Export Data", bg: "var(--surface-2)", border: "var(--border)", color: "var(--text-muted)", route: "/admin/export" },
                ].map(a => (
                  <button key={a.label} className="abtn" onClick={() => navigate(a.route)} style={{
                    background: a.bg, border: `1px solid ${a.border}`, color: a.color,
                    borderRadius: 10, padding: "10px", fontWeight: 700, fontSize: 13,
                    fontFamily: "var(--font-body)", textAlign: "center",
                  }}>{a.label}</button>
                ))}
              </div>
            </div>

            <div className="card">
              <h3 className="section-title" style={{ marginBottom: 12, fontSize: 15 }}>Citywide Summary</h3>
              {[
                { label: "Barangays Covered", value: MOCK_STATS.barangaysCovered, color: "var(--text)" },
                { label: "Active Trucks", value: MOCK_STATS.activeTrucks, color: "var(--warning)" },
                { label: "Delayed Trucks", value: MOCK_STATS.delayedTrucks, color: "var(--danger)" },
                { label: "Open Escalations", value: openEscCount, color: "var(--danger)" },
                { label: "Pending Reports", value: MOCK_STATS.pendingReports, color: "var(--warning)" },
                { label: "Routes Completed", value: MOCK_STATS.completedRoutes, color: "var(--accent)" },
              ].map(s => (
                <div key={s.label} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "9px 0", borderBottom: "1px solid var(--border)",
                }}>
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{s.label}</span>
                  <span style={{ fontSize: 18, fontWeight: 800, color: s.color, fontFamily: "var(--font-head)" }}>{s.value}</span>
                </div>
              ))}
            </div>

            <div className="card">
              <h3 className="section-title" style={{ marginBottom: 12, fontSize: 15 }}>Barangay Status</h3>
              {MOCK_BARANGAY_WASTE.map((b, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "9px 0",
                  borderBottom: i < MOCK_BARANGAY_WASTE.length - 1 ? "1px solid var(--border)" : "none",
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{b.name}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{b.kg} kg collected</div>
                  </div>
                  <StatusBadge status={b.status} />
                </div>
              ))}
            </div>

            <div className="card">
              <h3 className="section-title" style={{ marginBottom: 12, fontSize: 15 }}>Pending Summary</h3>
              {[
                { label: "Reports to Action", value: MOCK_STATS.pendingReports, color: "var(--warning)" },
                { label: "Open Escalations", value: openEscCount, color: "var(--danger)" },
                { label: "Critical", value: criticalCount, color: "var(--danger)" },
                { label: "Hotspots Pending", value: pendingHots, color: "var(--warning)" },
              ].map(s => (
                <div key={s.label} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "9px 0", borderBottom: "1px solid var(--border)",
                }}>
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{s.label}</span>
                  <span style={{ fontSize: 18, fontWeight: 800, color: s.color, fontFamily: "var(--font-head)" }}>{s.value}</span>
                </div>
              ))}
            </div>

          </div>
        </div>
      </div>

    </>
  );
}