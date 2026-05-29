/**
 * hooks/useAnalytics.js
 * ---------------------
 * Fetches aggregate analytics for GlobalInsights.
 */

import { useState, useEffect, useCallback } from 'react'
import api from '../api/client'

export function useAnalytics() {
  const [data, setData] = useState({
    wasteDaily: [],
    wasteMonthly: [],
    hotspots: [],
    rankings: [],
    problematic: [],
    stats: {
      totalWaste: 0,
      totalOrganic: 0,
      totalResidual: 0,
      resolutionRate: 0,
      avgResponse: 0,
      reportsThisWeek: 0,
    }
  })
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      // Parallel fetch for all analytics endpoints
      const [kpiRes, trendsRes, brgyRes, hsRes] = await Promise.all([
        api.get('/api/analytics/kpi/'),
        api.get('/api/analytics/trends/'),
        api.get('/api/analytics/barangay-performance/'),
        api.get('/api/watcher/hotspots/'),
      ])

      // Transform Trends to WASTE_DAILY format
      const wasteDaily = trendsRes.data.slice(-7).map(t => ({
        label: new Date(t.date).toLocaleDateString('en-US', { weekday: 'short' }),
        organic: Math.round(t.report_count * 0.6), // Mocking split for now
        residual: Math.round(t.report_count * 0.4),
        general: t.report_count
      }))

      // Transform Brgy to Rankings
      const rankings = brgyRes.data
        .filter(b => b.period === 'This Month')
        .map(b => ({
          name: b.barangay_name,
          score: Math.round((b.resolved / (b.reports || 1)) * 100),
          reports: b.reports,
          waste: b.waste_collected_kg
        }))
        .sort((a, b) => b.score - a.score)

      setData({
        wasteDaily,
        wasteMonthly: [], // Can add monthly trends endpoint later
        hotspots: hsRes.data.map(h => ({
          id: h.id,
          location: h.barangay_name,
          type: h.type,
          reports: h.count,
          reportsWeek: Math.round(h.count * 0.3), // Mock
          resolutionDays: 2.1, // Mock
          severity: h.status,
          resolved: Math.round(h.count * 0.7) // Mock
        })),
        rankings: rankings.slice(0, 10),
        problematic: [...rankings].reverse().slice(0, 5),
        stats: {
          totalWaste: wasteDaily.reduce((a, d) => a + d.general, 0),
          totalOrganic: wasteDaily.reduce((a, d) => a + d.organic, 0),
          totalResidual: wasteDaily.reduce((a, d) => a + d.residual, 0),
          resolutionRate: rankings.length ? Math.round(rankings.reduce((a, b) => a + b.score, 0) / rankings.length) : 0,
          avgResponse: 2.1,
          reportsThisWeek: wasteDaily.reduce((a, d) => a + d.general, 0),
        }
      })
    } catch (err) {
      console.error('Failed to fetch analytics:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { data, loading, refresh }
}
