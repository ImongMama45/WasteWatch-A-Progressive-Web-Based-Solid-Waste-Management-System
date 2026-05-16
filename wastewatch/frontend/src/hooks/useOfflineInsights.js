/**
 * hooks/useOfflineInsights.js
 * ----------------------------
 * Pure client-side insight engine — no API calls.
 * Reads cached localStorage keys and generates smart predictions.
 *
 * Outputs:
 *   wasteSpikeDays    — upcoming events with high waste impact
 *   riskBarangays     — zones with ≥3 pending offline reports
 *   collectionDelayRisk — schedule entries with 'missed' status
 *   improvingBarangays — rankings with positive score delta
 *   overallRiskLevel  — 'low' | 'medium' | 'high'
 *   insights          — array of human-readable insight strings
 *   generated         — ISO timestamp of last computation
 */

import { useState, useEffect } from 'react'

// ─── localStorage readers ─────────────────────────────────────────────────────

function readLS(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch { return fallback }
}

// ─── Insight generators ───────────────────────────────────────────────────────

function computeWasteSpikeDays(events) {
  if (!events?.length) return []
  const now  = new Date()
  const soon = new Date(now.getTime() + 7 * 86400000) // next 7 days
  return events.filter(e => {
    const d = new Date(e.date)
    return d >= now && d <= soon && (e.wasteImpact === 'high' || e.wasteImpact === 'medium')
  }).sort((a, b) => new Date(a.date) - new Date(b.date))
}

function computeRiskBarangays(reports) {
  if (!reports?.length) return []
  const pending = reports.filter(r => r.status === 'pending' || !r.synced)
  const counts  = {}
  pending.forEach(r => {
    const zone = r.location?.address || r.zone || 'Unknown'
    counts[zone] = (counts[zone] || 0) + 1
  })
  return Object.entries(counts)
    .filter(([, c]) => c >= 2)
    .map(([zone, count]) => ({ zone, count }))
    .sort((a, b) => b.count - a.count)
}

function computeCollectionDelayRisk(schedule) {
  if (!schedule?.length) return []
  return schedule.filter(s => s.status === 'missed')
}

function computeImprovingBarangays(rankings) {
  if (!rankings?.length) return []
  return rankings
    .filter(r => (r.delta ?? 0) > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 3)
}

function buildInsightMessages({ spikes, risks, delays, improving }) {
  const msgs = []

  if (spikes.length > 0) {
    const names = spikes.slice(0, 2).map(e => e.name).join(', ')
    msgs.push({ icon: '📅', text: `High waste expected during: ${names}`, level: 'warning' })
  }
  if (risks.length > 0) {
    const top = risks[0]
    msgs.push({ icon: '⚠️', text: `${top.zone} has ${top.count} unsynced reports — possible hotspot`, level: 'danger' })
  }
  if (delays.length > 0) {
    msgs.push({ icon: '🚛', text: `${delays.length} collection(s) marked missed — expect overflow risk`, level: 'warning' })
  }
  if (improving.length > 0) {
    msgs.push({ icon: '📈', text: `${improving[0].barangay} is improving — up ${improving[0].delta} points`, level: 'success' })
  }
  if (msgs.length === 0) {
    msgs.push({ icon: '✅', text: 'No anomalies detected in cached data', level: 'success' })
  }
  return msgs
}

function overallRisk(risks, delays, spikes) {
  if (risks.length >= 2 || delays.length >= 2) return 'high'
  if (risks.length >= 1 || delays.length >= 1 || spikes.some(s => s.wasteImpact === 'high')) return 'medium'
  return 'low'
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useOfflineInsights() {
  const [result, setResult] = useState({
    wasteSpikeDays      : [],
    riskBarangays       : [],
    collectionDelayRisk : [],
    improvingBarangays  : [],
    overallRiskLevel    : 'low',
    insights            : [],
    generated           : null,
  })

  function compute() {
    const events   = readLS('ww_events', [])
    const reports  = readLS('ww_offline_reports', [])   // legacy key
    const schedule = readLS('ww_schedule', [])
    const rankings = readLS('ww_rankings', [])

    const spikes    = computeWasteSpikeDays(events)
    const risks     = computeRiskBarangays(reports)
    const delays    = computeCollectionDelayRisk(schedule)
    const improving = computeImprovingBarangays(rankings)
    const insights  = buildInsightMessages({ spikes, risks, delays, improving })
    const riskLevel = overallRisk(risks, delays, spikes)

    setResult({
      wasteSpikeDays      : spikes,
      riskBarangays       : risks,
      collectionDelayRisk : delays,
      improvingBarangays  : improving,
      overallRiskLevel    : riskLevel,
      insights,
      generated           : new Date().toISOString(),
    })
  }

  // Re-compute on mount + whenever localStorage changes (cross-tab)
  useEffect(() => {
    compute()
    const handler = () => compute()
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return result
}
