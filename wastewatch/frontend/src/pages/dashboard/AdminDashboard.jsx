import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
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
  const navigate = useNavigate();
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
      api.get('/api/public/schedule/').catch(() => ({ data: [] })),
    ]).then(([st, esc, hs, dr, fd, bw, sc]) => {
      if (st.data) setStats(prev => ({ ...prev, ...st.data }))
      if (esc.data) setEscalations(esc.data)
      if (hs.data) setHotspots(hs.data)
      if (dr.data) setDrivers(dr.data)
      if (fd.data) setFeed(fd.data.slice(0, 8))
      if (bw.data) setBrgyWaste(bw.data.map(b => ({ name: b.barangay_name, kg: b.waste_collected_kg, status: b.resolved >= b.reports ? 'completed' : 'in-progress' })))
      if (sc.data) setSchedule(sc.data)
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
    } catch { showToast("❌ Failed to resolve.") }
  }

  const filteredHotspots = hotspotFilter === "all" ? hotspots : hotspots.filter(h => h.status === hotspotFilter);
  const criticalCount = escalations.filter(e => e.priority === "critical").length;
  const pendingHots = hotspots.filter(h => h.status === "pending").length;

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
            { label: "Open Reports", value: stats.pending_reports || 0, color: "var(--danger)", icon: "📋" },
            { label: "Active Trucks", value: stats.active_trucks || 0, color: "var(--warning)", icon: "🚛" },
            { label: "Escalations", value: escalations.length, color: "var(--danger)", icon: "⚠️" },
            { label: "Routes Done", value: stats.completed_routes || 0, color: "var(--accent)", icon: "✅" },
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
              <h3 className="section-title">Quick Actions</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {[
                  { label: "🗺 Live Map", route: "/map" },
                  { label: "🚛 Trucks", route: "/admin/trucks" },
                  { label: "📅 Schedule", route: "/schedule" },
                ].map(a => (
                  <button key={a.label} className="abtn" onClick={() => navigate(a.route)} style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px", fontWeight: 700, fontSize: 13 }}>{a.label}</button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
