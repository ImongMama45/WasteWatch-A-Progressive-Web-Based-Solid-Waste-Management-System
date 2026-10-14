import { fmtDay } from './perfMapper'

export function toGlobal(d) {
  if (!d) return null
  
  const peersIncluded = d.peers_included !== false

  // ── Map summary → KPI cards ──────────────────────────────────────────
  const s = d.summary || {}
  const completionPct = s.completion_rate == null ? null : Math.round(s.completion_rate * 100)
  const kpi = {
    // All values from live payload — no PLACEHOLDER spread, no fake values
    collected_kg: Math.round(s.total_weight_kg ?? 0),
    collection_rate: completionPct,
    active_trucks: (d.fleet || []).length,
    open_hotspots: (d.hotspots || []).length,
    escalations: null,  // not yet supplied by backend
    // Only count barangays that had actual activity this period
    barangays_served: peersIncluded
      ? (d.barangay_breakdown || []).filter(b => b.deliveries > 0 || b.stops_completed > 0).length
      : null,
    total_routes: s.stops_total ?? 0,
    completed_routes: s.stops_completed ?? 0,
    missed_stops: s.stops_missed ?? 0,
    pending_stops: s.stops_pending ?? 0,
    completion_rate: completionPct,
    collected_kg_delta: null,
    collection_rate_delta: null,
    hotspots_delta: null,
  }

  // ── Map weight_over_time → daily bar/line chart ───────────────────────
  const wasteDaily = (d.weight_over_time || []).map(row => ({
    label: fmtDay(row.date),
    value: Math.round(row.weight_kg),
    deliveries: row.deliveries,
  }))

  // ── Pre-calculate hotspot counts per barangay ──────────────────────────
  const hotspotCounts = {}
  if (d.hotspots) {
    d.hotspots.forEach(h => {
      if (h.barangay_id) {
        hotspotCounts[h.barangay_id] = (hotspotCounts[h.barangay_id] || 0) + 1
      }
    })
  }

  // ── Map barangay_breakdown → rankings ─────────────────────────────────
  const mappedRankings = (d.barangay_breakdown || [])
    .map(row => {
      const hCount = hotspotCounts[row.id] || 0;
      const totalStops = (row.stops_completed || 0) + (row.stops_missed || 0);

      let score;
      let rate = row.completion_rate ?? 0;
      if (totalStops > 0) {
        score = Math.min(100, Math.max(0, Math.round(rate * 100)));
      } else {
        const activeReports = Math.max(0, (row.reports_total || 0) - (row.reports_resolved || 0));
        if (hCount === 0 && activeReports === 0) {
          score = null;
          rate = null;
        } else {
          score = Math.max(0, Math.round(100 - (hCount * 2.5) - activeReports));
          rate = score / 100;
        }
      }

      const trend = rate == null ? 'none' : rate >= 0.9 ? 'up' : rate >= 0.6 ? 'same' : 'down'
      return {
        name: row.name,
        score,
        compliance: rate == null ? null : Math.round(rate * 100),
        trend,
        weight_kg: row.weight_kg,
        deliveries: row.deliveries,
        stops_completed: row.stops_completed,
        stops_missed: row.stops_missed,
        hotspots: hCount,
        reports: (row.reports_total || 0),
      }
    })
    .sort((a, b) => {
      if (a.score === null && b.score === null) return 0;
      if (a.score === null) return 1;
      if (b.score === null) return -1;
      return b.score - a.score;
    })

  const mappedProblematic = d.hotspots || []

  // ── Map fleet → truck performance ─────────────────────────────────────
  const mappedTrucks = (d.fleet || []).map(row => ({
    truck_id: row.plate_number,
    driver_name: row.driver_name ?? '—',
    routes: row.stops_total,
    completed: row.stops_completed,
    missed: row.stops_missed,
    total_weight: row.total_weight_kg
      ? row.total_weight_kg < 1000 ? `${Math.round(row.total_weight_kg)} kg` : `${(row.total_weight_kg / 1000).toFixed(1)}t`
      : '—',
  }))

  // ── Issue trends from incidents_over_time (reports per day) ───────────
  const issueTrends = (d.incidents_over_time || []).map(row => ({
    label: fmtDay(row.date),
    value: row.count,
  }))

  // ── Derive problematic from live rankings (score < 60) — not hardcoded ──
  const liveProblematic = [...mappedRankings]
    .filter(r => r.score != null && r.score < 60)
    .sort((a, b) => a.score - b.score)

  return {
    peersIncluded,
    kpi,
    wasteDaily,
    rankings: mappedRankings,
    problematic: liveProblematic,
    hotspots: mappedProblematic,
    trucks: mappedTrucks,
    issueTrends,
    forecast: d.forecast || { sufficient: false, reason: 'no_data' },
  }
}
