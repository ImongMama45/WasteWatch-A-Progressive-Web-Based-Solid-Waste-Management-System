import { Search, SlidersHorizontal, Layers, Megaphone, Newspaper, ShieldAlert } from 'lucide-react'

export default function ContentFiltersToolbar({
  activeTab = 'all',
  onTabChange,
  counts = {},
  search = '',
  onSearchChange,
  statusFilter = 'all',
  onStatusChange,
  scopeFilter = 'all',
  onScopeChange,
  barangays = [],
  priorityFilter = 'all',
  onPriorityChange,
  sortBy = 'updated',
  onSortChange,
}) {
  const tabs = [
    { id: 'all', label: 'All Content', icon: <Layers size={16} />, count: counts.total || 0 },
    { id: 'announcement', label: 'Announcements', icon: <Megaphone size={16} />, count: counts.announcements || 0 },
    { id: 'news', label: 'News & Features', icon: <Newspaper size={16} />, count: counts.news || 0 },
    { id: 'alerts', label: 'Emergency Alerts', icon: <ShieldAlert size={16} />, count: counts.total_alerts || 0 },
  ]

  return (
    <div className="workspace-controls-card">
      {/* ── Type Tabs ── */}
      <div className="type-tabs" role="tablist" aria-label="Content type tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`type-tab-btn ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => onTabChange(tab.id)}
            data-testid={`tab-${tab.id}`}
          >
            {tab.icon}
            <span>{tab.label}</span>
            <span className="type-tab-badge">{tab.count}</span>
          </button>
        ))}
      </div>

      {/* ── Search and Filters ── */}
      <div className="filters-row">
        {/* Search */}
        <div className="search-box-wrap">
          <span className="search-box-icon">
            <Search size={18} />
          </span>
          <input
            type="text"
            className="search-input"
            placeholder={activeTab === 'alerts' ? "Search alerts by title or content..." : "Search notices by title or keywords..."}
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            aria-label="Search content"
            data-testid="content-search-input"
          />
        </div>

        {/* Status Filter (only for NewsItems, not alert tab) */}
        {activeTab !== 'alerts' && (
          <select
            className="filter-select"
            value={statusFilter}
            onChange={(e) => onStatusChange(e.target.value)}
            aria-label="Filter by lifecycle status"
            data-testid="status-filter-select"
          >
            <option value="all">All Statuses</option>
            <option value="published">Published</option>
            <option value="draft">Drafts</option>
            <option value="archived">Archived</option>
          </select>
        )}

        {/* Scope / Barangay Filter (only for NewsItems) */}
        {activeTab !== 'alerts' && (
          <select
            className="filter-select"
            value={scopeFilter}
            onChange={(e) => onScopeChange(e.target.value)}
            aria-label="Filter by municipal scope"
            data-testid="scope-filter-select"
          >
            <option value="all">All Scopes</option>
            <option value="citywide">City-Wide Only</option>
            <optgroup label="Barangays">
              {(barangays || [])
                .slice()
                .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
                .map((b) => (
                  <option key={b.id} value={String(b.id)}>
                    {b.name}
                  </option>
                ))}
            </optgroup>
          </select>
        )}

        {/* Priority Filter (only for NewsItems) */}
        {activeTab !== 'alerts' && (
          <select
            className="filter-select"
            value={priorityFilter}
            onChange={(e) => onPriorityChange(e.target.value)}
            aria-label="Filter by priority level"
            data-testid="priority-filter-select"
          >
            <option value="all">All Priorities</option>
            <option value="high">High Priority</option>
            <option value="medium">Medium Priority</option>
            <option value="low">Low Priority</option>
          </select>
        )}

        {/* Sort Filter */}
        <select
          className="filter-select"
          value={sortBy}
          onChange={(e) => onSortChange(e.target.value)}
          aria-label="Sort content"
          data-testid="sort-filter-select"
        >
          <option value="updated">Recently Updated</option>
          <option value="date">Date Published</option>
          <option value="title">Title (A-Z)</option>
          {activeTab !== 'alerts' && <option value="priority">Priority</option>}
        </select>
      </div>
    </div>
  )
}
