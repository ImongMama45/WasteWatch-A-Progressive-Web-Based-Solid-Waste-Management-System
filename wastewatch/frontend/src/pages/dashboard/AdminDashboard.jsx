/**
 * AdminDashboard.jsx
 * ------------------
 * City-level admin panel for WasteWatch.
 * Redesigned to match BrgyDashboard.jsx design language:
 *   - CSS variables throughout (var(--accent), var(--surface), var(--border), etc.)
 *   - Same card/stat/badge/tab/button patterns
 *   - Same animation keyframes (fadeSlideIn, slideDown)
 *   - Same global class conventions (.card, .btn, .stat-card, .stat-grid, etc.)
 *
 * Place at: src/pages/AdminDashboard.jsx
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Navbar from "../../components/Navbar";
import BottomNav from "../../components/BottomNav";
import MiniMap from "../../components/MiniMap";

// ─── Mock Data ───────────────────────────────────────────────────────────────

const MOCK_STATS = {
  totalWasteKg: 2450,
  wasteChange: 12,
  activeTrucks: 3,
  hotspots: 15,
  hotspotChange: -4,
  completedRoutes: 3,
  pendingReports: 8,
  barangaysCovered: 12,
};

const MOCK_BARANGAY_WASTE = [
  { name: "Isabang",          kg: 520, routes: 4, status: "completed"  },
  { name: "Kanlurang Cotta",  kg: 310, routes: 3, status: "in-progress" },
  { name: "Cotta",            kg: 470, routes: 4, status: "completed"  },
  { name: "Ibabang Dupay",    kg: 380, routes: 3, status: "completed"  },
  { name: "Gulang-Gulang",    kg: 290, routes: 2, status: "issue"      },
  { name: "Mayao Crossing",   kg: 480, routes: 4, status: "completed"  },
];

const MOCK_DRIVERS = [
  { id: 1, name: "Juan Dela Cruz", route: "Barangay 1, 5th Ave",    status: "completed",  time: "10:30 AM", km: "0.3 KM", truck: "Truck 01", capacity: 85 },
  { id: 2, name: "Pedro Santos",   route: "Barangay 2, Main St",    status: "in-progress",time: "10:45 AM", km: "0.5 KM", truck: "Truck 02", capacity: 60 },
  { id: 3, name: "Maria Reyes",    route: "Barangay 3, Rizal Ave",  status: "issue",      time: "11:00 AM", km: "0.2 KM", truck: "Truck 03", capacity: 40 },
  { id: 4, name: "Jose Bautista",  route: "Barangay 4, Quezon Blvd",status: "completed",  time: "09:50 AM", km: "0.7 KM", truck: "Truck 04", capacity: 92 },
];

const MOCK_HOTSPOTS = [
  { id: 1, location: "Purok 3, Barangay Isabang",  type: "Illegal Dumping", severity: "high",   reports: 5, date: "Today, 8:12 AM",  status: "pending"   },
  { id: 2, location: "Near Market, Cotta",          type: "Overflow",        severity: "medium", reports: 3, date: "Today, 9:04 AM",  status: "pending"   },
  { id: 3, location: "Riverside, Kanlurang",        type: "Missed Pickup",   severity: "low",    reports: 2, date: "Yesterday",        status: "validated" },
  { id: 4, location: "Gulang-Gulang Crossing",      type: "Illegal Dumping", severity: "high",   reports: 7, date: "Today, 7:45 AM",  status: "pending"   },
];

const MOCK_SCHEDULE = [
  { day: "Monday",    barangays: ["Isabang", "Cotta", "Ibabang Dupay"],  time: "6:00 AM", status: "active" },
  { day: "Tuesday",   barangays: ["Kanlurang Cotta", "Gulang-Gulang"],   time: "6:00 AM", status: "active" },
  { day: "Wednesday", barangays: ["Mayao Crossing", "Barangay 1"],        time: "7:00 AM", status: "active" },
  { day: "Thursday",  barangays: ["Isabang", "Cotta"],                    time: "6:00 AM", status: "active" },
  { day: "Friday",    barangays: ["All Barangays — Market Day"],           time: "5:30 AM", status: "active" },
];

const MOCK_NOTIFICATIONS = [
  { id: 1, type: "alert",   msg: "Truck 03 reported a missed collection in Brgy Gulang-Gulang",       time: "5m ago",  read: false },
  { id: 2, type: "success", msg: "Route completed — Brgy Isabang (Truck 01, Juan Dela Cruz)",          time: "22m ago", read: false },
  { id: 3, type: "warning", msg: "15 hotspot reports require validation today",                        time: "1h ago",  read: true  },
  { id: 4, type: "info",    msg: "Weekly collection report is ready to export",                        time: "2h ago",  read: true  },
];

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const map = {
    completed:   { label: "COMPLETED",   colorVar: "var(--accent)",   bgVar: "rgba(46,204,113,0.1)",   borderVar: "rgba(46,204,113,0.28)"  },
    "in-progress":{ label: "IN PROGRESS",colorVar: "var(--warning)",  bgVar: "rgba(243,156,18,0.1)",   borderVar: "rgba(243,156,18,0.28)"  },
    issue:       { label: "ISSUE",        colorVar: "var(--danger)",   bgVar: "rgba(231,76,60,0.1)",    borderVar: "rgba(231,76,60,0.28)"   },
    pending:     { label: "PENDING",      colorVar: "var(--warning)",  bgVar: "rgba(243,156,18,0.1)",   borderVar: "rgba(243,156,18,0.28)"  },
    validated:   { label: "VALIDATED",    colorVar: "var(--accent)",   bgVar: "rgba(46,204,113,0.1)",   borderVar: "rgba(46,204,113,0.28)"  },
  };
  const s = map[status] || { label: status.toUpperCase(), colorVar: "var(--text-muted)", bgVar: "var(--surface-2)", borderVar: "var(--border)" };
  return (
    <span style={{
      background: s.bgVar,
      border: `1px solid ${s.borderVar}`,
      color: s.colorVar,
      borderRadius: 20,
      padding: "2px 10px",
      fontSize: 9,
      fontWeight: 800,
      letterSpacing: ".05em",
      whiteSpace: "nowrap",
    }}>{s.label}</span>
  );
}

// ─── Severity dot ─────────────────────────────────────────────────────────────

function SeverityDot({ severity }) {
  const colors = { high: "var(--danger)", medium: "var(--warning)", low: "var(--accent)" };
  return (
    <span style={{
      display: "inline-block", width: 7, height: 7,
      borderRadius: "50%", background: colors[severity] || "var(--text-muted)",
      marginRight: 5, flexShrink: 0,
    }} />
  );
}

// ─── CSS bar chart ────────────────────────────────────────────────────────────

function BarChart({ data }) {
  const maxKg = Math.max(...data.map(d => d.kg));
  const barColor = (status) =>
    status === "issue"       ? "var(--danger)"
    : status === "in-progress"? "var(--warning)"
    : "var(--accent)";

  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 120, padding: "0 4px" }}>
      {data.map((d, i) => (
        <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 9, color: "var(--text-muted)", fontWeight: 600 }}>{d.kg}kg</span>
          <div style={{
            width: "100%",
            height: Math.round((d.kg / maxKg) * 90),
            background: barColor(d.status),
            borderRadius: "4px 4px 0 0",
            transition: "height 0.4s ease",
            opacity: 0.85,
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

  const [chartTab,        setChartTab]        = useState("waste");
  const [updatesTab,      setUpdatesTab]      = useState("current");
  const [notifOpen,       setNotifOpen]       = useState(false);
  const [notifications,   setNotifications]   = useState(MOCK_NOTIFICATIONS);
  const [expandedDriver,  setExpandedDriver]  = useState(null);
  const [hotspotFilter,   setHotspotFilter]   = useState("all");
  const [toast,           setToast]           = useState(null);

  const unreadCount = notifications.filter(n => !n.read).length;
  const today       = new Date().toLocaleDateString("en-US", { weekday: "long" });

  const markAllRead = () => setNotifications(prev => prev.map(n => ({ ...n, read: true })));

  const filteredHotspots = hotspotFilter === "all"
    ? MOCK_HOTSPOTS
    : MOCK_HOTSPOTS.filter(h => h.status === hotspotFilter);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  const notifIcon = { alert: "🚨", success: "✅", warning: "⚠️", info: "ℹ️" };

  return (
    <>
      <Navbar />

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
        .bcard:hover { box-shadow: 0 4px 18px rgba(0,0,0,.09); }
        .abtn { transition: opacity .15s, transform .1s; cursor:pointer; }
        .abtn:hover { opacity:.88; }
        .abtn:active { transform:scale(.97); }
        .fpill { transition: all .15s; cursor:pointer; }
        .fpill:hover { opacity:.85; }

        /* Notification panel scroll */
        .notif-scroll { overflow-y:auto; max-height:280px; }
        .notif-scroll::-webkit-scrollbar { width:4px; }
        .notif-scroll::-webkit-scrollbar-thumb { background: var(--border); border-radius:4px; }
      `}</style>

      {/* ── Toast ── */}
      {toast && (
        <div style={{
          position: "fixed", top: 70, left: "50%", transform: "translateX(-50%)",
          background: "#0f172a", color: "#fff", padding: "10px 22px",
          borderRadius: 12, zIndex: 9999, fontSize: 13, fontWeight: 600,
          border: "1px solid rgba(20,184,166,0.3)",
          boxShadow: "0 8px 32px rgba(0,0,0,.35)",
          whiteSpace: "nowrap", animation: "fadeSlideIn .2s",
        }}>{toast}</div>
      )}

      {/* ── Notification Panel ── */}
      {notifOpen && (
        <div style={{
          position: "fixed", top: 56, right: 0,
          width: 300,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "0 0 0 16px",
          boxShadow: "0 8px 24px rgba(0,0,0,.15)",
          zIndex: 200,
          animation: "fadeSlideIn .2s",
        }}>
          <div style={{
            padding: "12px 14px",
            borderBottom: "1px solid var(--border)",
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <span style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>Notifications</span>
            <button onClick={markAllRead} className="abtn" style={{
              fontSize: 11, color: "var(--accent)", background: "none",
              border: "none", fontWeight: 600, fontFamily: "var(--font-body)",
            }}>Mark all read</button>
          </div>
          <div className="notif-scroll">
            {notifications.map(n => (
              <div key={n.id} style={{
                padding: "10px 14px",
                display: "flex", gap: 10, alignItems: "flex-start",
                background: n.read ? "var(--surface)" : "rgba(46,204,113,0.04)",
                borderBottom: "1px solid var(--border)",
              }}>
                <span style={{ fontSize: 15, flexShrink: 0 }}>{notifIcon[n.type]}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: "var(--text)", lineHeight: 1.4 }}>{n.msg}</div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 3 }}>{n.time}</div>
                </div>
                {!n.read && (
                  <div style={{
                    width: 7, height: 7, borderRadius: "50%",
                    background: "var(--accent)", flexShrink: 0, marginTop: 3,
                  }} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="page">

        {/* ── Page Header ── */}
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
            <p className="text-muted text-sm">
              Lucena City · Citywide operations &amp; monitoring
            </p>
          </div>
          {/* Notification bell */}
          <button className="abtn" onClick={() => setNotifOpen(!notifOpen)} style={{
            background: "none", border: "none",
            position: "relative", fontSize: 18, padding: 6,
            color: "var(--text)",
          }}>
            🔔
            {unreadCount > 0 && (
              <span style={{
                position: "absolute", top: 2, right: 2,
                background: "var(--danger)", color: "#fff",
                borderRadius: "50%", width: 15, height: 15,
                fontSize: 8, fontWeight: 800,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>{unreadCount}</span>
            )}
          </button>
        </div>

        {/* ── Hero KPI strip ── */}
        <div className="card" style={{
          background: "var(--surface-3, #0f172a)",
          border: "1px solid rgba(255,255,255,0.06)",
          marginBottom: 20, padding: "20px 18px",
          position: "relative", overflow: "hidden",
        }}>
          {/* faint truck watermark */}
          <span style={{
            position: "absolute", right: -8, bottom: -12,
            fontSize: 80, opacity: 0.05, transform: "scaleX(-1)", userSelect: "none",
          }}>🚛</span>

          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em", color: "rgba(255,255,255,0.45)", textTransform: "uppercase", marginBottom: 8 }}>
            Total Waste Collected
          </div>
          <div style={{ fontSize: 48, fontWeight: 800, lineHeight: 1, letterSpacing: -2, color: "#fff", marginBottom: 6 }}>
            2,450 <span style={{ fontSize: 26, fontWeight: 700 }}>KG</span>
          </div>
          <div style={{ fontSize: 12, color: "var(--accent)", display: "flex", alignItems: "center", gap: 4, marginBottom: 16 }}>
            ▲ +{MOCK_STATS.wasteChange}% from last week
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            {[
              { label: "BARANGAYS",   value: MOCK_STATS.barangaysCovered, color: "#fff"              },
              { label: "PENDING",     value: MOCK_STATS.pendingReports,   color: "var(--warning)"    },
              { label: "TODAY",       value: "On Track",                  color: "var(--accent)"     },
            ].map(s => (
              <div key={s.label} style={{
                flex: 1,
                background: "rgba(255,255,255,0.06)",
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

        {/* ── Stat cards ── */}
        <div className="stat-grid" style={{ marginBottom: 20 }}>
          {[
            { label: "Active Trucks",     value: MOCK_STATS.activeTrucks,      color: "var(--warning)", icon: "🚛", sub: "On route now",              route: "/admin/trucks"   },
            { label: "Hotspots Reported", value: MOCK_STATS.hotspots,          color: "var(--danger)",  icon: "🗑️", sub: `${Math.abs(MOCK_STATS.hotspotChange)} from yesterday`, route: "/admin/hotspots" },
            { label: "Routes Completed",  value: MOCK_STATS.completedRoutes,   color: "var(--accent)",  icon: "✅", sub: `of ${MOCK_STATS.activeTrucks + MOCK_STATS.completedRoutes} total`, route: "/admin/routes" },
            { label: "Pending Reports",   value: MOCK_STATS.pendingReports,    color: "var(--warning)", icon: "📋", sub: "Require action",             route: "/admin/reports"  },
          ].map(s => (
            <div key={s.label} className="stat-card abtn" onClick={() => navigate(s.route)}
              style={{ position: "relative", overflow: "hidden", cursor: "pointer" }}>
              <div style={{ position: "absolute", top: 10, right: 12, fontSize: 16, opacity: .13 }}>{s.icon}</div>
              <div className="label">{s.label}</div>
              <div className="value" style={{ color: s.color, fontSize: 30 }}>{s.value}</div>
              <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>{s.sub}</div>
            </div>
          ))}
        </div>

        {/* ── Alert bar for pending hotspots ── */}
        {MOCK_STATS.hotspots > 10 && (
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
            }}>⚠️</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--danger)", marginBottom: 1 }}>
                {MOCK_STATS.hotspots} active hotspot reports citywide
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                {MOCK_STATS.pendingReports} require barangay validation before dispatch.
              </div>
            </div>
            <button className="abtn" onClick={() => setUpdatesTab("hotspots")} style={{
              background: "var(--danger)", color: "#fff", border: "none",
              borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 700, flexShrink: 0,
            }}>Review</button>
          </div>
        )}

        <div className="page-grid">

          {/* ════ MAIN COLUMN ════ */}
          <div>

            {/* ── Live Map ── */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <h3 className="section-title" style={{ margin: 0 }}>Live Map</h3>
                <button onClick={() => navigate("/map")} style={{
                  background: "none", border: "none", color: "var(--accent)",
                  fontSize: 12, fontWeight: 700, cursor: "pointer",
                }}>Full View ›</button>
              </div>
              <MiniMap />
            </div>

            {/* ── Chart tabs ── */}
            <div style={{ display: "flex", gap: 4, marginBottom: 16, background: "var(--surface-2)", borderRadius: 10, padding: 4, width: "fit-content" }}>
              {[["waste", "Waste Collected"], ["weekly", "Weekly Collection"]].map(([key, label]) => (
                <button key={key} className="abtn" onClick={() => setChartTab(key)} style={{
                  padding: "8px 16px", borderRadius: 8, border: "none",
                  fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 600,
                  background: chartTab === key ? "var(--surface-3)" : "transparent",
                  color:      chartTab === key ? "#fff" : "var(--text-muted)",
                  boxShadow:  chartTab === key ? "0 2px 8px rgba(0,0,0,.15)" : "none",
                }}>{label}</button>
              ))}
            </div>

            <div className="card" style={{ marginBottom: 24, animation: "slideDown .2s" }}>
              <div style={{ padding: "16px 16px 0" }}>
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
              <div style={{ padding: "12px 16px 14px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
                <button className="abtn" onClick={() => navigate("/admin/reports")} style={{
                  background: "rgba(46,204,113,0.08)",
                  border: "1px solid rgba(46,204,113,0.35)",
                  color: "var(--accent)", borderRadius: 10,
                  padding: "8px 20px", fontSize: 12, fontWeight: 700,
                  fontFamily: "var(--font-body)",
                }}>See Full Report ›</button>
              </div>
            </div>

            {/* ── Main tabs ── */}
            <div style={{
              display: "flex", gap: 4, marginBottom: 16,
              background: "var(--surface-2)", borderRadius: 10, padding: 4,
              width: "fit-content", flexWrap: "wrap",
            }}>
              {[
                { key: "current",  label: "Driver Activity",   badge: null },
                { key: "hotspots", label: "Hotspot Reports",   badge: MOCK_HOTSPOTS.filter(h => h.status === "pending").length || null },
                { key: "schedule", label: "Schedule"                       },
              ].map(t => (
                <button key={t.key} className="abtn" onClick={() => setUpdatesTab(t.key)} style={{
                  position: "relative", padding: "8px 16px", borderRadius: 8,
                  border: "none", fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 600,
                  background: updatesTab === t.key ? "var(--surface-3)" : "transparent",
                  color:      updatesTab === t.key ? "#fff" : "var(--text-muted)",
                  boxShadow:  updatesTab === t.key ? "0 2px 8px rgba(0,0,0,.15)" : "none",
                }}>
                  {t.label}
                  {t.badge && (
                    <span style={{
                      position: "absolute", top: 5, right: 5,
                      minWidth: 15, height: 15, background: "var(--warning)",
                      color: "#fff", fontSize: 8, fontWeight: 800, borderRadius: 20,
                      display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px",
                    }}>{t.badge}</span>
                  )}
                </button>
              ))}
            </div>

            {/* ════ TAB 1 — DRIVER ACTIVITY ════ */}
            {updatesTab === "current" && (
              <div style={{ animation: "slideDown .2s" }}>
                <button onClick={() => navigate("/admin/trucks")} style={{
                  display: "block", marginBottom: 14, marginLeft: "auto",
                  border: "1px dashed var(--border)", borderRadius: 20,
                  padding: "8px 14px", fontSize: 12, fontWeight: 600,
                  background: "transparent", color: "var(--text-muted)", cursor: "pointer",
                  fontFamily: "var(--font-body)",
                }}>Manage All Trucks ›</button>

                {MOCK_DRIVERS.map(driver => (
                  <div key={driver.id} className="bcard" style={{
                    background: "var(--surface)",
                    border: driver.status === "issue"
                      ? "1.5px solid rgba(231,76,60,0.4)" : "1px solid var(--border)",
                    borderRadius: 14, marginBottom: 10,
                    overflow: "hidden", cursor: "pointer",
                  }} onClick={() => setExpandedDriver(p => p === driver.id ? null : driver.id)}>

                    {/* Row */}
                    <div style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
                      <div style={{
                        width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                        background: "var(--surface-2)",
                        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18,
                      }}>🚛</div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", marginBottom: 2 }}>
                          <span style={{ fontWeight: 700, fontSize: 14, color: "var(--text)" }}>{driver.name}</span>
                          <StatusBadge status={driver.status} />
                        </div>
                        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                          {driver.truck} · {driver.route}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>
                          {driver.time} · {driver.km}
                        </div>
                      </div>

                      <div style={{
                        fontSize: 16, color: "var(--text-muted)",
                        transform: expandedDriver === driver.id ? "rotate(90deg)" : "rotate(0)",
                        transition: "transform .2s",
                      }}>›</div>
                    </div>

                    {/* Expanded */}
                    {expandedDriver === driver.id && (
                      <div style={{ borderTop: "1px solid var(--border)", padding: "14px 16px", animation: "slideDown .18s" }}
                        onClick={e => e.stopPropagation()}>

                        {/* Capacity bar */}
                        <div style={{ marginBottom: 14 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                            <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", letterSpacing: ".06em" }}>TRUCK CAPACITY</span>
                            <span style={{ fontSize: 12, fontWeight: 700, color: driver.capacity > 80 ? "var(--danger)" : "var(--text-muted)" }}>
                              {driver.capacity}%
                            </span>
                          </div>
                          <div style={{ background: "var(--border)", borderRadius: 20, height: 7, overflow: "hidden" }}>
                            <div style={{
                              height: "100%", borderRadius: 20,
                              width: `${driver.capacity}%`,
                              background: driver.capacity > 80 ? "var(--danger)" : driver.capacity > 60 ? "var(--warning)" : "var(--accent)",
                              transition: "width .4s",
                            }} />
                          </div>
                        </div>

                        <div style={{
                          background: driver.status === "issue" ? "rgba(231,76,60,0.05)" : "rgba(46,204,113,0.05)",
                          border: `1px solid ${driver.status === "issue" ? "rgba(231,76,60,0.2)" : "rgba(46,204,113,0.2)"}`,
                          borderRadius: 8, padding: "9px 12px", marginBottom: 14,
                          fontSize: 12, lineHeight: 1.6, color: "var(--text-muted)",
                        }}>
                          {driver.status === "issue"
                            ? <><strong style={{ color: "var(--danger)" }}>⚠️ Issue reported.</strong> This driver flagged a problem on route.</>
                            : <><strong style={{ color: "var(--accent)" }}>✅ On schedule.</strong> No issues reported on this route.</>
                          }
                        </div>

                        <div style={{ display: "flex", gap: 8 }}>
                          <button className="abtn" onClick={() => navigate("/map")} style={{
                            flex: 1,
                            background: "rgba(20,184,166,0.08)",
                            border: "1px solid rgba(20,184,166,0.35)",
                            color: "var(--accent)", borderRadius: 10,
                            padding: "9px", fontWeight: 700, fontSize: 12,
                            fontFamily: "var(--font-body)",
                          }}>🗺 Track on Map</button>
                          <button className="abtn" onClick={() => showToast("🚩 Driver flagged. Supervisor notified.")} style={{
                            flex: 1,
                            background: "rgba(231,76,60,0.06)",
                            border: "1px solid rgba(231,76,60,0.35)",
                            color: "var(--danger)", borderRadius: 10,
                            padding: "9px", fontWeight: 700, fontSize: 12,
                            fontFamily: "var(--font-body)",
                          }}>🚩 Flag Issue</button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* ════ TAB 2 — HOTSPOT REPORTS ════ */}
            {updatesTab === "hotspots" && (
              <div style={{ animation: "slideDown .2s" }}>
                {/* Filter pills */}
                <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
                  {["all", "pending", "validated"].map(f => (
                    <button key={f} className="fpill" onClick={() => setHotspotFilter(f)} style={{
                      padding: "5px 14px", borderRadius: 20, border: "1px solid",
                      fontSize: 12, fontWeight: 600, fontFamily: "var(--font-body)",
                      borderColor: hotspotFilter === f ? "var(--accent)" : "var(--border)",
                      color:       hotspotFilter === f ? "var(--accent)" : "var(--text-muted)",
                      background:  hotspotFilter === f ? "rgba(46,204,113,0.08)" : "transparent",
                    }}>{f.charAt(0).toUpperCase() + f.slice(1)}</button>
                  ))}
                  <button onClick={() => navigate("/admin/hotspots")} style={{
                    border: "1px dashed var(--border)", borderRadius: 20,
                    padding: "5px 14px", fontSize: 12, fontWeight: 600,
                    marginLeft: "auto", background: "transparent",
                    color: "var(--text-muted)", cursor: "pointer",
                    fontFamily: "var(--font-body)",
                  }}>View All ›</button>
                </div>

                {filteredHotspots.map(h => (
                  <div key={h.id} className="bcard" style={{
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: 14, marginBottom: 10,
                    overflow: "hidden",
                  }}>
                    <div style={{ padding: "14px 16px", display: "flex", alignItems: "flex-start", gap: 12 }}>
                      <div style={{
                        width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                        background: h.severity === "high" ? "rgba(231,76,60,0.1)"
                          : h.severity === "medium" ? "rgba(243,156,18,0.1)"
                          : "rgba(46,204,113,0.1)",
                        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18,
                      }}>
                        {h.type === "Illegal Dumping" ? "🚯" : h.type === "Overflow" ? "🗑️" : "📭"}
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", marginBottom: 2 }}>
                          <SeverityDot severity={h.severity} />
                          <span style={{ fontWeight: 700, fontSize: 14, color: "var(--text)" }}>{h.location}</span>
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
                      <div style={{ borderTop: "1px solid var(--border)", padding: "12px 16px", display: "flex", gap: 8 }}>
                        <button className="abtn" onClick={() => showToast("✕ Report dismissed.")} style={{
                          flex: 1, background: "transparent",
                          border: "1.5px solid var(--danger)", color: "var(--danger)",
                          borderRadius: 10, padding: "8px", fontWeight: 700, fontSize: 12,
                          fontFamily: "var(--font-body)",
                        }}>✕ Dismiss</button>
                        <button className="abtn" onClick={() => navigate("/admin/hotspots")} style={{
                          flex: 1,
                          background: "rgba(46,204,113,0.08)",
                          border: "1px solid rgba(46,204,113,0.35)",
                          color: "var(--accent)", borderRadius: 10,
                          padding: "8px", fontWeight: 700, fontSize: 12,
                          fontFamily: "var(--font-body)",
                        }}>View Details</button>
                        <button className="abtn" onClick={() => showToast("✅ Hotspot validated. Added to dispatch queue.")} style={{
                          flex: 1, background: "var(--accent)", color: "#0d1117",
                          border: "none", borderRadius: 10,
                          padding: "8px", fontWeight: 700, fontSize: 12,
                          fontFamily: "var(--font-body)",
                        }}>✓ Validate</button>
                      </div>
                    )}
                    {h.status === "validated" && (
                      <div style={{ borderTop: "1px solid var(--border)", padding: "12px 16px" }}>
                        <button className="abtn" onClick={() => navigate("/map")} style={{
                          width: "100%",
                          background: "rgba(20,184,166,0.08)",
                          border: "1px solid rgba(20,184,166,0.35)",
                          color: "var(--accent)", borderRadius: 10,
                          padding: "8px", fontWeight: 700, fontSize: 12,
                          fontFamily: "var(--font-body)",
                        }}>🗺 View on Map</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* ════ TAB 3 — SCHEDULE ════ */}
            {updatesTab === "schedule" && (
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
                      background: "var(--accent)", color: "#0d1117",
                      border: "none", borderRadius: 8,
                      padding: "5px 12px", fontSize: 11, fontWeight: 700,
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
                          fontSize: 10, fontWeight: 800, color: isToday ? "#fff" : "var(--text-muted)",
                        }}>{s.day.slice(0, 3).toUpperCase()}</div>

                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: isToday ? 700 : 500, color: "var(--text)", display: "flex", alignItems: "center", gap: 6 }}>
                            {s.day}
                            {isToday && (
                              <span style={{
                                fontSize: 9, background: "rgba(46,204,113,0.1)", color: "var(--accent)",
                                border: "1px solid rgba(46,204,113,0.28)", borderRadius: 20, padding: "1px 7px",
                                fontWeight: 800, letterSpacing: ".05em",
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

          </div>{/* end main column */}

          {/* ════ SIDEBAR (desktop) ════ */}
          <div className="sidebar">

            <div className="card">
              <h3 className="section-title" style={{ marginBottom: 12, fontSize: 15 }}>Quick Actions</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {[
                  { label: "🗺 Live Map",       color: "rgba(20,184,166,0.08)", border: "rgba(20,184,166,0.35)", text: "var(--accent)",   route: "/map"             },
                  { label: "🚛 Manage Trucks",  color: "rgba(243,156,18,0.08)", border: "rgba(243,156,18,0.35)", text: "var(--warning)",  route: "/admin/trucks"    },
                  { label: "📋 View Reports",   color: "rgba(231,76,60,0.06)",  border: "rgba(231,76,60,0.35)",  text: "var(--danger)",   route: "/admin/reports"   },
                  { label: "📅 Full Schedule",  color: "rgba(46,204,113,0.08)", border: "rgba(46,204,113,0.35)", text: "var(--accent)",   route: "/admin/schedule"  },
                  { label: "📤 Export Data",    color: "var(--surface-2)",       border: "var(--border)",         text: "var(--text-muted)",route: "/admin/export"   },
                ].map(a => (
                  <button key={a.label} className="abtn" onClick={() => navigate(a.route)} style={{
                    background: a.color, border: `1px solid ${a.border}`,
                    color: a.text, borderRadius: 10,
                    padding: "10px", fontWeight: 700, fontSize: 13,
                    fontFamily: "var(--font-body)", textAlign: "center",
                  }}>{a.label}</button>
                ))}
              </div>
            </div>

            <div className="card">
              <h3 className="section-title" style={{ marginBottom: 12, fontSize: 15 }}>Citywide Summary</h3>
              {[
                { label: "Barangays Covered",  value: MOCK_STATS.barangaysCovered, color: "var(--text)"          },
                { label: "Active Trucks",       value: MOCK_STATS.activeTrucks,     color: "var(--warning)"      },
                { label: "Hotspots Pending",    value: MOCK_STATS.hotspots,         color: "var(--danger)"       },
                { label: "Pending Reports",     value: MOCK_STATS.pendingReports,   color: "var(--warning)"      },
                { label: "Routes Completed",    value: MOCK_STATS.completedRoutes,  color: "var(--accent)"       },
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

          </div>
        </div>
      </div>

      <BottomNav />
    </>
  );
}