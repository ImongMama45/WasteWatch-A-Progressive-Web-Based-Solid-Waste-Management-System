import { Search, RotateCcw, Filter } from 'lucide-react'

const EVENT_CATEGORIES = [
  { value: 'all', label: 'All Categories' },
  { value: 'cleanup', label: 'Cleanup Drive' },
  { value: 'community_meeting', label: 'Community Meeting' },
  { value: 'hazardous_waste', label: 'Special Waste Collection' },
  { value: 'tree_planting', label: 'Tree Planting' },
  { value: 'workshop', label: 'Public Orientation & Seminar' },
  { value: 'general', label: 'General Municipal Event' },
]

export default function EventFiltersToolbar({
  search = '',
  onSearchChange,
  statusFilter = 'all',
  onStatusChange,
  categoryFilter = 'all',
  onCategoryChange,
  scopeFilter = 'all',
  onScopeChange,
  barangays = [],
  startDate = '',
  onStartDateChange,
  endDate = '',
  onEndDateChange,
  onResetFilters,
}) {
  return (
    <div className="event-controls-card" data-testid="event-filters-toolbar">
      <div className="event-filters-row">
        {/* Search */}
        <div className="event-search-wrap">
          <span className="event-search-icon">
            <Search size={18} />
          </span>
          <input
            type="text"
            className="event-search-input"
            placeholder="Search events by title, venue, or organizer..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            aria-label="Search events"
            data-testid="event-search-input"
          />
        </div>

        {/* Status Filter */}
        <select
          className="event-select-filter"
          value={statusFilter}
          onChange={(e) => onStatusChange(e.target.value)}
          aria-label="Filter by event status"
          data-testid="event-status-filter"
        >
          <option value="all">All Statuses</option>
          <option value="published">Published</option>
          <option value="draft">Drafts</option>
          <option value="cancelled">Cancelled</option>
          <option value="completed">Completed</option>
          <option value="archived">Archived</option>
        </select>

        {/* Category Filter */}
        <select
          className="event-select-filter"
          value={categoryFilter}
          onChange={(e) => onCategoryChange(e.target.value)}
          aria-label="Filter by event category"
          data-testid="event-category-filter"
        >
          {EVENT_CATEGORIES.map((cat) => (
            <option key={cat.value} value={cat.value}>
              {cat.label}
            </option>
          ))}
        </select>

        {/* Scope / Barangay Filter */}
        <select
          className="event-select-filter"
          value={scopeFilter}
          onChange={(e) => onScopeChange(e.target.value)}
          aria-label="Filter by municipal scope"
          data-testid="event-scope-filter"
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

        {/* Date Range Inputs */}
        <div className="event-date-filter-wrap">
          <label htmlFor="event-start-date" style={{ fontSize: '0.75rem', fontWeight: 600 }}>From:</label>
          <input
            id="event-start-date"
            type="date"
            className="event-date-input"
            value={startDate}
            onChange={(e) => onStartDateChange(e.target.value)}
            aria-label="Filter from date"
            data-testid="event-start-date-input"
          />
          <label htmlFor="event-end-date" style={{ fontSize: '0.75rem', fontWeight: 600 }}>To:</label>
          <input
            id="event-end-date"
            type="date"
            className="event-date-input"
            value={endDate}
            onChange={(e) => onEndDateChange(e.target.value)}
            aria-label="Filter to date"
            data-testid="event-end-date-input"
          />
        </div>

        {/* Reset Filter Button */}
        <button
          type="button"
          className="btn-reset-filters"
          onClick={onResetFilters}
          title="Reset all filters"
          data-testid="event-reset-filters-btn"
        >
          <RotateCcw size={14} />
          <span>Reset</span>
        </button>
      </div>
    </div>
  )
}
