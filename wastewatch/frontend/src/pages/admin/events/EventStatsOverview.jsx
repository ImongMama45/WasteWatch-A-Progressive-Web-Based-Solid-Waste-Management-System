import {
  Calendar,
  CheckCircle2,
  Clock,
  FileEdit,
  CheckSquare,
  XCircle,
  Archive,
} from 'lucide-react'

export default function EventStatsOverview({ stats = {}, loading = false }) {
  const cards = [
    {
      label: 'Total Events',
      value: stats.total ?? 0,
      icon: <Calendar size={20} color="#0f172a" />,
      bg: '#f1f5f9',
      testId: 'metric-total',
    },
    {
      label: 'Published',
      value: stats.published ?? 0,
      icon: <CheckCircle2 size={20} color="#16a34a" />,
      bg: '#f0fdf4',
      testId: 'metric-published',
    },
    {
      label: 'Upcoming',
      value: stats.upcoming ?? 0,
      icon: <Clock size={20} color="#2563eb" />,
      bg: '#eff6ff',
      testId: 'metric-upcoming',
    },
    {
      label: 'Drafts',
      value: stats.drafts ?? 0,
      icon: <FileEdit size={20} color="#d97706" />,
      bg: '#fffbeb',
      testId: 'metric-drafts',
    },
    {
      label: 'Completed',
      value: stats.completed ?? 0,
      icon: <CheckSquare size={20} color="#0284c7" />,
      bg: '#f0f9ff',
      testId: 'metric-completed',
    },
    {
      label: 'Cancelled',
      value: stats.cancelled ?? 0,
      icon: <XCircle size={20} color="#dc2626" />,
      bg: '#fef2f2',
      testId: 'metric-cancelled',
    },
    {
      label: 'Archived',
      value: stats.archived ?? 0,
      icon: <Archive size={20} color="#64748b" />,
      bg: '#f8fafc',
      testId: 'metric-archived',
    },
  ]

  return (
    <div className="event-metrics-grid" data-testid="event-metrics-overview">
      {cards.map((c, idx) => (
        <div key={idx} className="event-metric-card" data-testid={c.testId}>
          <div className="event-metric-info">
            <span className="event-metric-label">{c.label}</span>
            <span className="event-metric-value">{loading ? '—' : c.value}</span>
          </div>
          <div className="event-metric-icon-wrap" style={{ backgroundColor: c.bg }}>
            {c.icon}
          </div>
        </div>
      ))}
    </div>
  )
}
