import { Layers, CheckCircle2, FileEdit, Archive, ShieldAlert } from 'lucide-react'

export default function ContentStatsOverview({ stats = {}, loading = false }) {
  const cards = [
    {
      label: 'Total Content',
      value: stats.total ?? 0,
      icon: <Layers size={22} color="#0f172a" />,
      bg: '#f1f5f9',
    },
    {
      label: 'Published Active',
      value: stats.published ?? 0,
      icon: <CheckCircle2 size={22} color="#16a34a" />,
      bg: '#f0fdf4',
    },
    {
      label: 'Draft Notices',
      value: stats.drafts ?? 0,
      icon: <FileEdit size={22} color="#d97706" />,
      bg: '#fffbeb',
    },
    {
      label: 'Archived',
      value: stats.archived ?? 0,
      icon: <Archive size={22} color="#64748b" />,
      bg: '#f8fafc',
    },
    {
      label: 'Active Alerts',
      value: stats.active_alerts ?? 0,
      icon: <ShieldAlert size={22} color="#dc2626" />,
      bg: '#fef2f2',
    },
  ]

  return (
    <div className="metrics-grid" data-testid="content-metrics-overview">
      {cards.map((c, i) => (
        <div key={i} className="metric-card">
          <div className="metric-info">
            <span className="metric-label">{c.label}</span>
            <span className="metric-value">
              {loading ? '—' : c.value}
            </span>
          </div>
          <div className="metric-icon-wrap" style={{ backgroundColor: c.bg }}>
            {c.icon}
          </div>
        </div>
      ))}
    </div>
  )
}
