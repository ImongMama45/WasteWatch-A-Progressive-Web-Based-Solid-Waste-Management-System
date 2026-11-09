// Local-time date formatter (avoids UTC off-by-one on dates like "2026-10-01")
export const fmtDay = iso =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })

// Sum of completed + missed (the only "decided" stops; pending/en-route excluded)
const decided = (a, b) => (a || 0) + (b || 0)

export function toPerf(d) {
  if (!d) return null
  const s = d.summary || {}

  // Denominator decision: use decided (completed + missed) not stops_total.
  // stops_total includes EN_ROUTE / ARRIVED stops that aren't yet resolved,
  // so it deflates rates during live shifts. decided is the settled count.
  const kpiDecided = decided(s.stops_completed, s.stops_missed)
  const kpiPending = Math.max(0, (s.stops_total ?? 0) - kpiDecided)

  return {
    kpi: {
      collected: Math.round(s.total_weight_kg ?? 0),
      routes: s.stops_total ?? 0,           // raw total (for display only)
      completed: s.stops_completed ?? 0,
      missed: s.stops_missed ?? 0,
      decided: kpiDecided,                  // completed + missed (denominator)
      pending: kpiPending,                  // unresolved stops this shift
      // rate: null if no stops have been decided yet (avoids 0% flash)
      rate: kpiDecided > 0
        ? Math.round((s.stops_completed ?? 0) / kpiDecided * 100)
        : null,
      avgFill: s.avg_fill_pct ?? null,
      reports: s.reports_total ?? 0,        // always a number from backend
      resolved: s.reports_resolved ?? 0,
      resRate: (s.reports_total ?? 0) > 0
        ? Math.round((s.reports_resolved ?? 0) / s.reports_total * 100)
        : null,
    },

    trucks: (d.fleet || []).map(r => {
      const truckDecided = decided(r.stops_completed, r.stops_missed)
      return {
        id: r.plate_number,
        driver: r.driver_name ?? '—',
        routes: r.stops_total ?? 0,
        completed: r.stops_completed ?? 0,
        missed: r.stops_missed ?? 0,
        decided: truckDecided,
        pending: Math.max(0, (r.stops_total ?? 0) - truckDecided),
        hasStops: (r.stops_total ?? 0) > 0,
        // rate: null for delivery-only trucks — prevents fake "0% At Risk" score
        rate: truckDecided > 0
          ? Math.round((r.stops_completed ?? 0) / truckDecided * 100)
          : null,
        fill: r.avg_fill_pct ?? null,
        kg: Math.round(r.total_weight_kg ?? 0),
      }
    }),

    brgy: (d.barangay_breakdown || []).map(r => ({
      name: r.name,
      reports: r.reports_total || 0,
      resolved: r.reports_resolved || 0,
      // resRate pre-computed here; null = no data, sorts last, shows '-'
      resRate: (r.reports_total || 0) > 0
        ? Math.round((r.reports_resolved || 0) / r.reports_total * 100)
        : null,
      kg: Math.round(r.weight_kg ?? 0),
    })),

    // incidents_over_time = GarbageReport count per day (citizen reports, not DumpsiteIncident)
    trend: (d.incidents_over_time || []).map(r => r.count),
    trendLabels: (d.incidents_over_time || []).map(r => fmtDay(r.date)),

    issueTypes: d.issue_types || [],
  }
}
