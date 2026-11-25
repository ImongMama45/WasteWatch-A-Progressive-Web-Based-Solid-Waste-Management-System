import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Truck,
  AlertTriangle,
  Scale,
  Home,
  PlusSquare,
  Radio,
  ListChecks,
  Trash2,
  ClipboardCheck,
  ShieldAlert,
  Wrench,
  Activity,
  Fuel,
  ArrowLeftRight,
  History,
  ArrowRight,
  Clock,
  CheckCircle2,
  X,
} from 'lucide-react'
import {
  getDumpsiteDashboard,
  getDumpsiteInboundQueue,
  unwrapList,
} from '../../api/dumpsiteApi'
import LiveTrackerCard from '../../components/analytics/LiveTrackerCard'
import TrucksOverlay from '../dumpsite/components/TrucksOverlay'
import ArrivalLogger from '../dumpsite/ArrivalLogger'
import FacilityWorkspaceHeader from '../dumpsite/components/FacilityWorkspaceHeader'
import { useFacilityScope } from '../dumpsite/components/useFacilityScope'
import { useAuth } from '../../context/AuthContext'
import { getApiErrorMessage } from '../../utils/notificationHelpers'
import {
  Skeleton,
  ChartSkeleton,
  StatCardSkeleton,
  LiveTrackerSkeleton,
  FeedCardSkeleton,
} from '../../components/ui/Skeleton'

const FILL_LABEL = {
  nearly_empty: { label: 'Nearly Empty', color: '#15803d', bg: '#e7f5eb', border: '#bbf7d0' },
  quarter: { label: 'Quarter', color: '#15803d', bg: '#e7f5eb', border: '#bbf7d0' },
  half: { label: 'Half', color: '#b45309', bg: '#fffbeb', border: '#fde68a' },
  three_quarters: { label: 'Three Quarters', color: '#b45309', bg: '#fffbeb', border: '#fde68a' },
  full: { label: 'Full', color: '#b45309', bg: '#fffbeb', border: '#fde68a' },
  overflowing: { label: 'Overflowing', color: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
}

const ACTIVITY_BADGE = {
  shift: { label: 'Shift', color: '#1d4ed8', bg: '#dbeafe', border: '#bfdbfe' },
  inspection: { label: 'Inspection', color: '#15803d', bg: '#e7f5eb', border: '#bbf7d0' },
  hold: { label: 'Hold', color: '#b91c1c', bg: '#fee2e2', border: '#fecaca' },
  maintenance: { label: 'Maintenance', color: '#b45309', bg: '#fef3c7', border: '#fde68a' },
  fuel: { label: 'Fuel', color: '#7c3aed', bg: '#f3e8ff', border: '#ddd6fe' },
  delivery: { label: 'Delivery', color: '#0f766e', bg: '#ccfbf1', border: '#99f6e4' },
  allocation: { label: 'Allocation', color: '#4338ca', bg: '#e0e7ff', border: '#c7d2fe' },
}

function FillBadge({ level }) {
  const f = FILL_LABEL[level]
  if (!f) return null
  return (
    <span
      style={{
        background: f.bg,
        color: f.color,
        border: `1px solid ${f.border}`,
        borderRadius: 4,
        padding: '2px 7px',
        fontSize: 10,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '.04em',
      }}
    >
      {f.label}
    </span>
  )
}

function ArcGauge({ percent }) {
  const numeric = Number(percent) || 0
  const clamped = Math.max(0, Math.min(numeric, 120))
  const radius = 64
  const stroke = 12
  const circumference = Math.PI * radius
  const filled = (clamped / 120) * circumference
  const color = clamped >= 95 ? '#dc2626' : clamped >= 80 ? '#d97706' : '#16a34a'

  return (
    <div style={{ position: 'relative', width: 160, height: 90, margin: '0 auto' }}>
      <svg width="160" height="95" viewBox="0 0 160 95">
        <path
          d={`M 16 80 A ${radius} ${radius} 0 0 1 144 80`}
          fill="none"
          stroke="#e4e6eb"
          strokeWidth={stroke}
          strokeLinecap="round"
        />
        <path
          d={`M 16 80 A ${radius} ${radius} 0 0 1 144 80`}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference}`}
          style={{ transition: 'stroke-dasharray 0.6s ease, stroke 0.4s' }}
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          textAlign: 'center',
          lineHeight: 1,
        }}
      >
        <div style={{ fontSize: 26, fontWeight: 800, color, letterSpacing: '-0.5px' }}>
          {Math.round(numeric)}%
        </div>
        <div style={{ fontSize: 10, color: '#65676b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginTop: 3 }}>
          Site Fill
        </div>
      </div>
    </div>
  )
}

export default function DumpsiteDashboard() {
  const navigate = useNavigate()
  const {
    sites,
    siteId,
    setSiteId,
    activeSite,
    isAdmin,
    loading: scopeLoading,
    error: scopeError,
  } = useFacilityScope()
  const { user } = useAuth()
  const isOperator = Boolean(user?.role === 'dumpsite' && !isAdmin)

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [radarError, setRadarError] = useState(false)
  const [incomingTrucks, setIncomingTrucks] = useState([])
  const [dismissed, setDismissed] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem('radar_dismissed') || '[]')
    } catch {
      return []
    }
  })
  const [overlayOpen, setOverlayOpen] = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  const [logTruckId, setLogTruckId] = useState('')

  useEffect(() => {
    try {
      sessionStorage.setItem('radar_dismissed', JSON.stringify(dismissed))
    } catch {
      // ignore storage errors
    }
  }, [dismissed])

  const fetchDashboardData = useCallback((targetSiteId) => {
    if (!targetSiteId) return
    setLoading(true)
    setError(null)
    getDumpsiteDashboard(targetSiteId)
      .then((payload) => {
        setData(payload)
        setLoading(false)
      })
      .catch((err) => {
        setError(getApiErrorMessage(err, 'Failed to load facility dashboard data.'))
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    if (!siteId) {
      if (!scopeLoading) setLoading(false)
      return
    }
    fetchDashboardData(siteId)

    const fetchRadar = () => {
      if (document.hidden) return
      getDumpsiteInboundQueue(siteId)
        .then((raw) => {
          setRadarError(false)
          const radar = unwrapList(raw)
          setDismissed((prev) => prev.filter((id) => radar.some((r) => r.shift_id === id)))

          const trucks = radar.map((t) => ({
            shift_id: t.shift_id,
            schedule_id: t.schedule_id || t.shift_id,
            state: 'unloading',
            truck: { id: t.truck_id, plate: t.truck_plate, capacity: t.truck_max_capacity_kg },
            driver_name: t.driver,
            op_status: t.op_status,
            eta_min: t.eta_min,
            eta_max: t.eta_max,
            fix_age_s: t.last_fix ? Math.floor((Date.now() - new Date(t.last_fix).getTime()) / 1000) : null,
            is_stale: t.last_fix ? Math.floor((Date.now() - new Date(t.last_fix).getTime()) / 1000) > 180 : false,
          }))
          setIncomingTrucks(trucks)
        })
        .catch((err) => {
          console.error('Radar poll error:', err)
          setRadarError(true)
        })
    }

    fetchRadar()
    const interval = setInterval(fetchRadar, 15000)
    return () => clearInterval(interval)
  }, [siteId, scopeLoading, fetchDashboardData])

  const visibleTrucks = incomingTrucks.filter((t) => !dismissed.includes(t.shift_id))

  if (loading || scopeLoading) {
    return (
      <div style={{ background: '#f0f2f5', minHeight: '100vh', padding: '20px 24px' }}>
        <style>{`
          @media (max-width: 900px) {
            .dd-cmd-top-grid { grid-template-columns: 1fr !important; }
          }
        `}</style>
        <div style={{ maxWidth: 1440, margin: '0 auto' }}>
          <header style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1c1e21', margin: 0, fontFamily: 'var(--font-head)' }}>
                Dumpsite Command Center
              </h1>
              <span style={{ background: '#e7f5eb', color: '#15803d', border: '1px solid #bbf7d0', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4 }}>
                OPERATOR
              </span>
            </div>
            <Skeleton width={260} height={14} radius={4} />
          </header>

          <div className="dd-cmd-top-grid" style={{ display: 'grid', gridTemplateColumns: '240px 1fr 220px', gap: 16, marginBottom: 16, alignItems: 'stretch' }}>
            <ChartSkeleton variant="gauge" height={150} />
            <StatCardSkeleton count={3} style={{ gridTemplateColumns: '1fr', gap: 10 }} />
            <div className="ww-sk-surface" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center' }}>
              <Skeleton height={36} radius={6} />
              <Skeleton height={36} radius={6} />
              <Skeleton height={36} radius={6} />
              <Skeleton height={36} radius={6} />
            </div>
          </div>

          <LiveTrackerSkeleton style={{ marginBottom: 16 }} />
          <div style={{ background: '#ffffff', border: '1px solid #e4e6eb', borderRadius: 8, padding: 18 }}>
            <FeedCardSkeleton count={3} compact />
          </div>
        </div>
      </div>
    )
  }

  if (scopeError || error || !data) {
    return (
      <div style={{ background: '#f0f2f5', minHeight: '100vh', padding: '20px 24px' }}>
        <div style={{ maxWidth: 1240, margin: '0 auto' }}>
          <FacilityWorkspaceHeader
            title="Dumpsite Command Center"
            subtitle="Facility overview, incoming monitoring, fleet compliance, and delivery operations."
            sites={sites}
            siteId={siteId}
            onSiteChange={setSiteId}
            activeSite={activeSite}
            isAdmin={isAdmin}
          />
          <div style={{ background: '#ffffff', border: '1px solid #fecaca', borderRadius: 10, padding: '2.5rem 1.5rem', textAlign: 'center', color: '#b91c1c' }}>
            <AlertTriangle size={36} color="#dc2626" style={{ margin: '0 auto 10px' }} />
            <p style={{ fontWeight: 700, fontSize: 14, margin: 0 }}>{scopeError || error || 'Unable to load facility dashboard.'}</p>
          </div>
        </div>
      </div>
    )
  }

  const dumpsiteInfo = data.dumpsite || activeSite || {}
  const summary = data.summary || {}
  const fillPercent = dumpsiteInfo.fill_percent ?? dumpsiteInfo.capacity_used ?? data.fill_percent ?? 0
  const currentFillKg = Number(dumpsiteInfo.current_fill_kg ?? data.current_fill_kg ?? 0)
  const maxCapKg = Number(dumpsiteInfo.max_capacity_kg ?? data.max_capacity_kg ?? 0)

  const kgReceivedToday = Number(summary.kg_received_today ?? data.today_kg ?? 0)
  const deliveriesToday = Number(summary.deliveries_today ?? data.trucks_today ?? 0)
  const barangaysToday = Number(summary.barangays_covered_today ?? data.barangays_today ?? 0)

  const primaryKpis = [
    { label: 'KG Received Today', value: `${kgReceivedToday.toLocaleString()} kg`, color: '#16a34a', Icon: Scale },
    { label: 'Deliveries Today', value: deliveriesToday, color: '#2563eb', Icon: Truck },
    { label: 'Barangays Covered Today', value: barangaysToday, color: '#7c3aed', Icon: Home },
  ]

  const operationsKpis = [
    {
      label: 'Incoming / Returning',
      value: `${summary.incoming_trucks ?? 0} / ${summary.returned_trucks ?? 0}`,
      sub: 'En route / at facility',
      color: '#1d4ed8',
      bg: '#eff6ff',
      border: '#bfdbfe',
      Icon: Truck,
      path: '/dumpsite/monitoring',
    },
    {
      label: 'Active / Completed Shifts',
      value: `${summary.active_driver_shifts ?? 0} / ${summary.completed_driver_shifts_today ?? 0}`,
      sub: 'Today driver shifts',
      color: '#15803d',
      bg: '#e7f5eb',
      border: '#bbf7d0',
      Icon: Activity,
      path: '/dumpsite/monitoring',
    },
    {
      label: 'Awaiting Inspection',
      value: summary.awaiting_post_shift_inspection ?? 0,
      sub: 'Post-shift queue',
      color: (summary.awaiting_post_shift_inspection ?? 0) > 0 ? '#b45309' : '#65676b',
      bg: (summary.awaiting_post_shift_inspection ?? 0) > 0 ? '#fef3c7' : '#f8fafc',
      border: (summary.awaiting_post_shift_inspection ?? 0) > 0 ? '#fde68a' : '#e4e6eb',
      Icon: ClipboardCheck,
      path: '/dumpsite/inspections',
    },
    {
      label: 'Operational Holds',
      value: summary.operational_holds ?? 0,
      sub: 'Held facility trucks',
      color: (summary.operational_holds ?? 0) > 0 ? '#b91c1c' : '#65676b',
      bg: (summary.operational_holds ?? 0) > 0 ? '#fee2e2' : '#f8fafc',
      border: (summary.operational_holds ?? 0) > 0 ? '#fecaca' : '#e4e6eb',
      Icon: ShieldAlert,
      path: '/dumpsite/holds',
    },
    {
      label: 'Active Maintenance',
      value: summary.active_maintenance ?? 0,
      sub: 'Scheduled / under repair',
      color: (summary.active_maintenance ?? 0) > 0 ? '#b45309' : '#65676b',
      bg: (summary.active_maintenance ?? 0) > 0 ? '#fffbeb' : '#f8fafc',
      border: (summary.active_maintenance ?? 0) > 0 ? '#fde68a' : '#e4e6eb',
      Icon: Wrench,
      path: '/dumpsite/maintenance',
    },
  ]

  const recentDeliveries = Array.isArray(data.recent_deliveries) ? data.recent_deliveries : []
  const recentActivity = Array.isArray(data.recent_activity) ? data.recent_activity : []

  return (
    <div style={{ background: '#f0f2f5', minHeight: '100vh', padding: '20px 24px 60px' }}>
      <style>{`
        @media (max-width: 960px) {
          .dd-cmd-top-grid { grid-template-columns: 1fr !important; }
          .dd-dual-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
      <div className="ww-fade-in" style={{ maxWidth: 1440, margin: '0 auto' }}>
        <FacilityWorkspaceHeader
          title="Dumpsite Command Center"
          subtitle="Real-time facility capacity, incoming truck monitoring, fleet readiness, and operations."
          sites={sites}
          siteId={siteId}
          onSiteChange={setSiteId}
          activeSite={{ ...activeSite, ...dumpsiteInfo }}
          isAdmin={isAdmin}
          operationalDate={data.operational_date}
        />

        {/* Top row: Gauge + Primary Delivery KPIs + Quick Actions */}
        <div
          className="dd-cmd-top-grid ww-stagger"
          style={{ display: 'grid', gridTemplateColumns: '240px 1fr 220px', gap: 16, marginBottom: 16, alignItems: 'stretch' }}
        >
          <div style={{ background: '#ffffff', border: '1px solid #e4e6eb', borderRadius: 10, padding: '16px 20px', textAlign: 'center', boxShadow: '0 1px 2px rgba(0,0,0,0.04)', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#65676b', marginBottom: 12, letterSpacing: '.05em', textTransform: 'uppercase' }}>
              Site Capacity
            </div>
            <ArcGauge percent={fillPercent} />
            <div style={{ marginTop: 12, fontSize: 11, color: '#65676b', fontWeight: 600 }}>
              {currentFillKg.toLocaleString()} / {maxCapKg.toLocaleString()} kg
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateRows: 'repeat(3, 1fr)', gap: 10 }}>
            {primaryKpis.map((k) => {
              const Icon = k.Icon
              return (
                <div
                  key={k.label}
                  style={{
                    background: '#ffffff',
                    border: '1px solid #e4e6eb',
                    borderRadius: 10,
                    padding: '12px 18px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                  }}
                >
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                      {k.label}
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: k.color, lineHeight: 1.2, marginTop: 2 }}>
                      {k.value}
                    </div>
                  </div>
                  <div style={{ width: 38, height: 38, borderRadius: 8, background: '#f8fafc', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon size={19} color={k.color} />
                  </div>
                </div>
              )
            })}
          </div>

          <div style={{ background: '#ffffff', border: '1px solid #e4e6eb', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
            {isOperator && (
              <button
                type="button"
                onClick={() => setLogOpen(true)}
                style={{
                  background: '#16a34a',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: 6,
                  height: 36,
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                }}
              >
                <PlusSquare size={15} /> Log Arrival
              </button>
            )}
            <button
              type="button"
              onClick={() => navigate('/dumpsite/queue')}
              style={secondaryActionBtnStyle}
            >
              <Radio size={15} color="#2563eb" /> Truck Queue
            </button>
            <button
              type="button"
              onClick={() => navigate('/dumpsite/logs')}
              style={secondaryActionBtnStyle}
            >
              <ListChecks size={15} color="#65676b" /> Collection Logs
            </button>
            <button
              type="button"
              onClick={() => setOverlayOpen(true)}
              style={secondaryActionBtnStyle}
            >
              <Truck size={15} color="#65676b" /> Assigned Trucks
            </button>
          </div>
        </div>

        {/* Fleet & Shift Operational KPI Strip */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
            gap: 12,
            marginBottom: 16,
          }}
        >
          {operationsKpis.map((item) => {
            const Icon = item.Icon
            return (
              <button
                key={item.label}
                type="button"
                onClick={() => navigate(item.path)}
                style={{
                  background: '#ffffff',
                  border: '1px solid #e4e6eb',
                  borderRadius: 10,
                  padding: '14px 16px',
                  textAlign: 'left',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                }}
              >
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    {item.label}
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: item.color, marginTop: 2 }}>
                    {item.value}
                  </div>
                  <div style={{ fontSize: 11, color: '#65676b', marginTop: 2 }}>{item.sub}</div>
                </div>
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 8,
                    background: item.bg,
                    border: `1px solid ${item.border}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Icon size={18} color={item.color} />
                </div>
              </button>
            )
          })}
        </div>


        {/* Incoming Trucks Radar */}
        {radarError && (
          <div style={{ padding: '12px 16px', borderRadius: 8, marginBottom: 16, border: '1px solid #fecaca', background: '#fef2f2' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#dc2626' }}>
              <AlertTriangle size={18} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>Unable to update incoming truck radar. Retrying...</span>
            </div>
          </div>
        )}
        {!radarError && visibleTrucks.length > 0 && (
          <div className="ww-fade-in" style={{ background: '#ffffff', border: '1px solid #e4e6eb', borderRadius: 10, padding: 18, marginBottom: 16, boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, color: '#1c1e21', margin: '0 0 14px' }}>Incoming Trucks (Radar)</h2>
            <div className="ww-stagger" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
              {visibleTrucks.map((t) => (
                <div key={t.shift_id} style={{ position: 'relative' }}>
                  <LiveTrackerCard
                    truck={t}
                    variant="operator"
                    onLogArrival={isOperator ? (id) => {
                      setLogTruckId(id)
                      setLogOpen(true)
                    } : undefined}
                  />
                  <button
                    type="button"
                    onClick={() => setDismissed((prev) => [...prev, t.shift_id])}
                    style={{
                      position: 'absolute',
                      top: 10,
                      right: 10,
                      background: '#ffffff',
                      color: '#65676b',
                      border: '1px solid #ced0d4',
                      borderRadius: '50%',
                      width: 24,
                      height: 24,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      zIndex: 10,
                    }}
                    title="Dismiss from radar until next trip"
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Dual Column: Recent Facility Activity + Recent Deliveries */}
        <div className="dd-dual-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {/* Recent Facility Activity */}
          <div style={{ background: '#ffffff', border: '1px solid #e4e6eb', borderRadius: 10, padding: 18, boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h2 style={{ fontSize: 14, fontWeight: 700, color: '#1c1e21', margin: 0, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <History size={16} color="#16a34a" /> Recent Facility Activity
              </h2>
              <button
                type="button"
                onClick={() => navigate('/dumpsite/activity')}
                style={{ fontSize: 12, color: '#16a34a', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
              >
                View Timeline <ArrowRight size={13} />
              </button>
            </div>
            {recentActivity.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '28px 16px', color: '#65676b', border: '1px dashed #ced0d4', borderRadius: 8 }}>
                <Clock size={28} color="#8a8d91" style={{ margin: '0 auto 8px' }} />
                <p style={{ fontWeight: 600, fontSize: 13, margin: 0 }}>No recent facility activity recorded.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {recentActivity.map((ev) => {
                  const badge = ACTIVITY_BADGE[ev.category] || { label: ev.category || 'Event', color: '#4b5563', bg: '#f3f4f6', border: '#e5e7eb' }
                  return (
                    <div
                      key={ev.id}
                      style={{
                        padding: '10px 12px',
                        background: '#f8fafc',
                        borderRadius: 8,
                        border: '1px solid #e2e8f0',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        gap: 10,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 3 }}>
                          <span style={{ background: badge.bg, color: badge.color, border: `1px solid ${badge.border}`, borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>
                            {badge.label}
                          </span>
                          {ev.truck_plate && (
                            <span style={{ fontSize: 12, fontWeight: 700, color: '#1c1e21' }}>{ev.truck_plate}</span>
                          )}
                        </div>
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: '#1c1e21' }}>{ev.summary || ev.action}</div>
                        <div style={{ fontSize: 11, color: '#65676b', marginTop: 2 }}>
                          {ev.actor_name || 'System'} {ev.timestamp ? `· ${new Date(ev.timestamp).toLocaleString()}` : ''}
                        </div>
                      </div>
                      <CheckCircle2 size={15} color="#16a34a" style={{ flexShrink: 0, marginTop: 2 }} />
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Recent Deliveries */}
          <div style={{ background: '#ffffff', border: '1px solid #e4e6eb', borderRadius: 10, padding: 18, boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h2 style={{ fontSize: 14, fontWeight: 700, color: '#1c1e21', margin: 0, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Scale size={16} color="#2563eb" /> Recent Deliveries
              </h2>
              <button
                type="button"
                onClick={() => navigate('/dumpsite/logs')}
                style={{ fontSize: 12, color: '#16a34a', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
              >
                View All <ArrowRight size={13} />
              </button>
            </div>
            {recentDeliveries.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '28px 16px', color: '#65676b', border: '1px dashed #ced0d4', borderRadius: 8 }}>
                <Trash2 size={28} color="#8a8d91" style={{ margin: '0 auto 8px' }} />
                <p style={{ fontWeight: 600, fontSize: 13, margin: 0 }}>No deliveries logged yet today</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {recentDeliveries.map((d) => (
                  <div
                    key={d.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '10px 14px',
                      background: '#f8fafc',
                      borderRadius: 8,
                      border: '1px solid #e2e8f0',
                      gap: 10,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      <span style={{ display: 'flex', alignItems: 'center', color: '#2563eb', background: '#eff6ff', padding: 6, borderRadius: 6, border: '1px solid #bfdbfe' }}>
                        <Truck size={16} />
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 13, color: '#1c1e21' }}>{d.truck || d.truck_plate}</div>
                        <div style={{ fontSize: 11, color: '#65676b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {d.driver || d.driver_name} {d.barangay ? `· ${d.barangay}` : ''} {d.time || d.arrival_time ? `· ${d.time || d.arrival_time}` : ''}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      <FillBadge level={d.fill_level} />
                      <div style={{ fontWeight: 700, color: '#16a34a', fontSize: 13 }}>
                        {Number(d.estimated_kg || 0).toLocaleString()} kg
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <TrucksOverlay open={overlayOpen} onClose={() => setOverlayOpen(false)} siteId={siteId} />
      </div>
    </div>
  )
}

const secondaryActionBtnStyle = {
  background: '#ffffff',
  color: '#1c1e21',
  border: '1px solid #ced0d4',
  borderRadius: 6,
  height: 36,
  fontWeight: 600,
  fontSize: 13,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
}

const shortcutBtnStyle = {
  background: '#f8fafc',
  color: '#1c1e21',
  border: '1px solid #e4e6eb',
  borderRadius: 6,
  padding: '6px 11px',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
}
