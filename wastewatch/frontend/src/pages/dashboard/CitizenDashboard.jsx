/**
 * CitizenDashboard.jsx — Citizen / Resident Dashboard (Meta Business Suite Style)
 * -------------------------------------------------------------------------------
 * Route: /dashboard (Citizen role)
 *
 * Clean, modern resident portal redesigned in the Meta Business Suite aesthetic:
 *  - Crisp #f0f2f5 canvas with elevated #ffffff cards and subtle borders (#e4e6eb).
 *  - Header with resident identity, location pill, and prominent quick actions.
 *  - Real-time collection truck tracking and schedule highlights.
 *  - Integrated LGU Announcements carousel/banner.
 *  - 4-metric overview cards for submissions, pending reviews, resolved issues, and next pickup.
 *  - Two-column dashboard: My Reports with segmented tab filtering + Collection Schedule on left;
 *    Interactive MiniMap, Nearby Hotspots, and Cleanliness Guide on right.
 *  - Preserves 100% of functionality: OfflineReportBuilder, ReportDetail, MiniMap,
 *    BarangayTracker, Crew Member assignment, RankingModal.
 *  - Zero emojis, compliant with Material/SVG iconography rules.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import MiniMap from '../../components/MiniMap'
import { useAuth } from '../../context/AuthContext'
import api from '../../api/client'
import OfflineReportBuilder from '../../components/OfflineReportBuilder'
import { useOfflineReports } from '../../hooks/useOfflineReports'
import DispatchCard from '../../components/DispatchCard'
import ReportDetail from '../admin/ReportDetail'
import { useBarangayTracker } from '../../hooks/useBarangayTracker'
import LiveTrackerCard from '../../components/analytics/LiveTrackerCard'
import RankingModal from '../../components/carousel/RankingModal'
import {
  StatCardSkeleton,
  FeedCardSkeleton,
  SidebarWidgetSkeleton,
} from '../../components/ui/Skeleton'

// ─── STATUS & SEVERITY CONSTANTS ──────────────────────────────────────────────

const STATUS_META = {
  pending: { label: 'Pending', color: '#b45309', bg: '#fef3c7', border: '#fde68a' },
  approved: { label: 'Approved', color: '#15803d', bg: '#e7f5eb', border: '#bbf7d0' },
  resolved: { label: 'Resolved', color: '#1d4ed8', bg: '#dbeafe', border: '#bfdbfe' },
  rejected: { label: 'Rejected', color: '#b91c1c', bg: '#fee2e2', border: '#fecaca' },
}

const SEVERITY_META = {
  high: { label: 'High Priority', color: '#dc2626', bg: '#fee2e2' },
  medium: { label: 'Medium', color: '#d97706', bg: '#fef3c7' },
  low: { label: 'Low', color: '#16a34a', bg: '#e7f5eb' },
}

// ─── SVG ICONS (NO EMOJIS) ────────────────────────────────────────────────────

const SvgCamera = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
    <circle cx="12" cy="13" r="4" />
  </svg>
)

const SvgTrophy = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
    <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
    <path d="M4 22h16" />
    <path d="M10 14.66V17c0 .55-.45 1-1 1H7" />
    <path d="M14 14.66V17c0 .55.45 1 1 1h2" />
    <path d="M18 2H6v7a6 6 0 0 0 12 0V2z" />
  </svg>
)

const SvgMapPin = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
)

const SvgMegaphone = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m3 11 18-5v12L3 13v-2z" />
    <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
  </svg>
)

const SvgChevronRight = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
)

const SvgAlertTriangle = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
)

const SvgCheckCircle = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </svg>
)

const SvgClock = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
)

const SvgTrash = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
)

const SvgCalendar = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
)

const SvgInfo = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>
)

const SvgTruck = ({ size = 18, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="3" width="15" height="13" rx="1" />
    <path d="M16 8h4l3 5v3h-7V8z" />
    <circle cx="5.5" cy="18.5" r="2.5" />
    <circle cx="18.5" cy="18.5" r="2.5" />
  </svg>
)

const SvgHotspot = ({ size = 16, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
  </svg>
)

// ─── COMPONENT ────────────────────────────────────────────────────────────────

export default function CitizenDashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { addReport } = useOfflineReports()

  const [myReports, setMyReports] = useState([])
  const [stats, setStats] = useState({ total: 0, pending: 0, resolved: 0 })
  const [hotspots, setHotspots] = useState([])
  const [schedule, setSchedule] = useState([])
  const [loading, setLoading] = useState(true)
  const [reportsTab, setReportsTab] = useState('all') // all | pending | done | rejected
  const [crewAssignment, setCrewAssignment] = useState(null)
  const [showBuilder, setShowBuilder] = useState(false)
  const [selectedReportId, setSelectedReportId] = useState(null)
  const [announcements, setAnnouncements] = useState([])
  const [announcementIdx, setAnnouncementIdx] = useState(0)
  const [rankOpen, setRankOpen] = useState(false)

  const userBrgy = user?.barangay_name || user?.barangay?.name || ''
  const userBrgyId = user?.barangay || user?.barangay_id
  const tracker = useBarangayTracker(userBrgyId)
  const [activeDispatch, setActiveDispatch] = useState(null)

  // Filter schedule for user's barangay
  const filteredSchedule = useMemo(() => {
    if (!schedule.length) return []
    if (!userBrgy) return schedule
    return schedule.filter(s => s.zone && s.zone.toLowerCase().includes(userBrgy.toLowerCase()))
  }, [schedule, userBrgy])

  const nextDay = useMemo(() => {
    if (!filteredSchedule.length) return schedule.find(s => s.isNext) || schedule[0] || null
    return filteredSchedule.find(s => s.isNext) || filteredSchedule[0] || null
  }, [filteredSchedule, schedule])

  // Data loading
  useEffect(() => {
    let cancelled = false

    Promise.all([
      api.get('/api/news/items/for-dashboard/').catch(() => ({ data: [] })),
      api.get('/api/watcher/reports/mine/?paginate=false').catch(() => ({ data: [] })),
      api.get('/api/watcher/reports/mine_stats/').catch(() => ({ data: { total: 0, pending: 0, resolved: 0 } })),
      api.get('/api/watcher/hotspots/').catch(() => ({ data: [] })),
      api.get('/api/public/schedule/').catch(() => ({ data: [] })),
      api.get('/api/public/live/').catch(() => ({ data: [] })),
    ])
      .then(([newsRes, reportsRes, statsRes, hotspotsRes, scheduleRes, liveRes]) => {
        if (cancelled) return
        if (newsRes?.data) setAnnouncements(newsRes.data)
        if (reportsRes?.data) {
          const rData = reportsRes.data
          setMyReports(Array.isArray(rData) ? rData : (rData?.results || []))
        }
        if (statsRes?.data) setStats(statsRes.data)
        if (hotspotsRes?.data) {
          setHotspots(
            hotspotsRes.data.map(h => ({
              ...h,
              count: h.report_count || 0,
              type: h.type || 'Mixed Waste',
              status: h.severity || 'low',
            }))
          )
        }
        if (scheduleRes?.data) setSchedule(scheduleRes.data)

        if (liveRes && liveRes.data) {
          const brgyName = user?.barangay_name || user?.barangay?.name
          if (brgyName) {
            const dispatched = liveRes.data.find(d => d.barangays && d.barangays.includes(brgyName))
            if (dispatched) setActiveDispatch(dispatched)
          }
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    // Fetch crew assignment only if user is a crew member
    if (user?.employee_type === 'crew_member') {
      api
        .get('/api/driver/crew-assignments/my-assignment/')
        .then(res => {
          if (!cancelled) setCrewAssignment(res.data)
        })
        .catch(() => {
          if (!cancelled) setCrewAssignment(null)
        })
    }

    return () => {
      cancelled = true
    }
  }, [user?.employee_type, user?.barangay_name, user?.barangay?.name])

  const handleSubmitReport = useCallback(
    async fields => {
      await addReport(fields)
      setShowBuilder(false)
      // Refresh reports after submission
      api.get('/api/watcher/reports/mine/?paginate=false').then(r => {
        if (r.data) setMyReports(Array.isArray(r.data) ? r.data : (r.data?.results || []))
      }).catch(() => {})
      api.get('/api/watcher/reports/mine_stats/').then(r => r.data && setStats(r.data)).catch(() => {})
    },
    [addReport]
  )

  // Filtered reports for current tab
  const filteredReports = useMemo(() => {
    const list = Array.isArray(myReports) ? myReports : (myReports?.results || [])
    return list.filter(r => {
      if (reportsTab === 'all') return true
      if (reportsTab === 'pending') return r.status === 'pending'
      if (reportsTab === 'done') return r.status === 'resolved' || r.status === 'approved'
      if (reportsTab === 'rejected') return r.status === 'rejected'
      return true
    })
  }, [myReports, reportsTab])

  // Counts for tabs
  const tabCounts = useMemo(() => {
    const all = myReports.length
    const pending = myReports.filter(r => r.status === 'pending').length
    const done = myReports.filter(r => r.status === 'resolved' || r.status === 'approved').length
    const rejected = myReports.filter(r => r.status === 'rejected').length
    return { all, pending, done, rejected }
  }, [myReports])

  // Active announcement
  const currentAnnouncement = announcements.length > 0
    ? announcements[announcementIdx % announcements.length]
    : {
        title: 'Lucena City Solid Waste Segregation Advisory',
        description:
          'Please ensure waste is sorted into Biodegradable, Non-Biodegradable, and Recyclable bags before the scheduled pickup in your area.',
        date: 'City-wide Advisory',
        is_pinned: true,
      }

  return (
    <>
      <style>{`
        /* ── Meta Business Suite Theme Tokens & Layout ── */
        .cd-meta-canvas {
          background-color: #f0f2f5;
          min-height: 100vh;
          padding: 24px 28px 48px;
          color: #1c1e21;
          font-family: inherit;
          --surface: #ffffff;
          --bg: #f8fafc;
          --border: #e4e6eb;
        }

        .cd-container {
          max-width: 1400px;
          margin: 0 auto;
        }

        /* ── Cards ── */
        .cd-card {
          background: #ffffff;
          border: 1px solid #e4e6eb;
          border-radius: 8px;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
          overflow: hidden;
          margin-bottom: 20px;
        }

        .cd-card-header {
          padding: 16px 20px;
          border-bottom: 1px solid #e4e6eb;
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: #ffffff;
        }

        .cd-card-title {
          font-size: 15px;
          font-weight: 700;
          color: #1c1e21;
          margin: 0;
          letter-spacing: -0.01em;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .cd-card-subtitle {
          font-size: 12px;
          color: #65676b;
          margin: 2px 0 0 0;
        }

        /* ── Top Header Bar ── */
        .cd-header-row {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 22px;
          flex-wrap: wrap;
        }

        .cd-meta-title {
          font-size: 24px;
          font-weight: 800;
          color: #1c1e21;
          letter-spacing: -0.02em;
          margin: 0 0 4px 0;
          line-height: 1.2;
        }

        .cd-meta-subtitle {
          font-size: 13px;
          color: #65676b;
          margin: 0;
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }

        .cd-badge-group {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 6px;
        }

        .cd-role-badge {
          background: #e7f5eb;
          color: #15803d;
          border: 1px solid #bbf7d0;
          font-size: 10px;
          font-weight: 800;
          padding: 2px 8px;
          border-radius: 4px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }

        .cd-crew-badge {
          background: #fef3c7;
          color: #b45309;
          border: 1px solid #fde68a;
          font-size: 10px;
          font-weight: 800;
          padding: 2px 8px;
          border-radius: 4px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }

        .cd-location-badge {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          background: #ffffff;
          border: 1px solid #e4e6eb;
          color: #4b5563;
          font-size: 11px;
          font-weight: 600;
          padding: 2px 8px;
          border-radius: 4px;
        }

        /* ── Header Action Buttons ── */
        .cd-header-actions {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }

        .cd-btn-primary {
          background: #16a34a;
          color: #ffffff;
          border: 1px solid #15803d;
          font-size: 13px;
          font-weight: 700;
          padding: 8px 16px;
          border-radius: 6px;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          transition: background 0.15s, transform 0.1s, box-shadow 0.15s;
          box-shadow: 0 1px 2px rgba(22, 163, 74, 0.2);
        }

        .cd-btn-primary:hover {
          background: #15803d;
        }

        .cd-btn-primary:active {
          transform: scale(0.98);
        }

        .cd-btn-secondary {
          background: #ffffff;
          color: #1c1e21;
          border: 1px solid #ccd0d5;
          font-size: 13px;
          font-weight: 600;
          padding: 8px 14px;
          border-radius: 6px;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          transition: background 0.15s, border-color 0.15s;
        }

        .cd-btn-secondary:hover {
          background: #f2f3f5;
          border-color: #bec3c9;
        }

        /* ── LGU Announcement Banner (Meta Style) ── */
        .cd-announcement-card {
          background: #ffffff;
          border: 1px solid #e4e6eb;
          border-left: 4px solid #16a34a;
          border-radius: 8px;
          padding: 14px 20px;
          margin-bottom: 20px;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
        }

        .cd-announcement-left {
          display: flex;
          align-items: center;
          gap: 14px;
          flex: 1;
          min-width: 0;
        }

        .cd-announcement-icon-wrap {
          width: 40px;
          height: 40px;
          border-radius: 8px;
          background: #e7f5eb;
          color: #16a34a;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .cd-announcement-content {
          flex: 1;
          min-width: 0;
        }

        .cd-announcement-tag {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.06em;
          color: #15803d;
          text-transform: uppercase;
          margin-bottom: 2px;
        }

        .cd-announcement-title {
          font-size: 14px;
          font-weight: 700;
          color: #1c1e21;
          margin: 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .cd-announcement-body {
          font-size: 12px;
          color: #65676b;
          margin: 2px 0 0 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .cd-announcement-actions {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-shrink: 0;
        }

        .cd-pager-btn {
          background: #f0f2f5;
          border: 1px solid #e4e6eb;
          color: #4b5563;
          border-radius: 4px;
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          font-size: 11px;
          font-weight: 700;
          transition: background 0.12s;
        }

        .cd-pager-btn:hover {
          background: #e4e6eb;
          color: #1c1e21;
        }

        /* ── Metric Stat Cards Grid ── */
        .cd-stat-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 14px;
          margin-bottom: 20px;
        }

        @media (max-width: 900px) {
          .cd-stat-grid {
            grid-template-columns: repeat(2, 1fr);
          }
        }

        @media (max-width: 540px) {
          .cd-stat-grid {
            grid-template-columns: 1fr;
          }
        }

        .cd-stat-card {
          background: #ffffff;
          border: 1px solid #e4e6eb;
          border-radius: 8px;
          padding: 16px 18px;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
          cursor: pointer;
          transition: background 0.15s, border-color 0.15s, transform 0.1s;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .cd-stat-card:hover {
          background: #fafbfc;
          border-color: #ccd0d5;
          transform: translateY(-1px);
        }

        .cd-stat-label {
          font-size: 11px;
          font-weight: 700;
          color: #65676b;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          margin-bottom: 4px;
        }

        .cd-stat-val {
          font-size: 26px;
          font-weight: 800;
          color: #1c1e21;
          line-height: 1.1;
          margin-bottom: 2px;
          letter-spacing: -0.02em;
        }

        .cd-stat-sub {
          font-size: 11px;
          color: #8a8d91;
        }

        .cd-stat-icon-wrap {
          width: 42px;
          height: 42px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        /* ── Two-Column Main Layout ── */
        .cd-page-grid {
          display: grid;
          grid-template-columns: 1fr 380px;
          gap: 20px;
          align-items: start;
        }

        @media (max-width: 1080px) {
          .cd-page-grid {
            grid-template-columns: 1fr;
          }
        }

        /* ── Meta Filter Tabs (Segmented Control) ── */
        .cd-tab-segmented {
          display: inline-flex;
          background: #f0f2f5;
          padding: 3px;
          border-radius: 6px;
          gap: 2px;
          border: 1px solid #e4e6eb;
        }

        .cd-tab-item {
          padding: 6px 14px;
          font-size: 12px;
          font-weight: 600;
          border-radius: 4px;
          border: none;
          cursor: pointer;
          background: transparent;
          color: #65676b;
          transition: all 0.15s ease;
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }

        .cd-tab-item.active {
          background: #ffffff;
          color: #1c1e21;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
          font-weight: 700;
        }

        .cd-tab-count {
          font-size: 10px;
          font-weight: 800;
          padding: 1px 6px;
          border-radius: 10px;
          background: #e4e6eb;
          color: #4b5563;
        }

        .cd-tab-item.active .cd-tab-count {
          background: #e7f5eb;
          color: #15803d;
        }

        /* ── Report Rows ── */
        .cd-meta-row {
          padding: 14px 20px;
          display: flex;
          align-items: center;
          gap: 14px;
          border-bottom: 1px solid #e4e6eb;
          transition: background 0.12s;
          cursor: pointer;
        }

        .cd-meta-row:last-child {
          border-bottom: none;
        }

        .cd-meta-row:hover {
          background: #f8fafc;
        }

        .cd-type-icon-box {
          width: 40px;
          height: 40px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .cd-status-pill {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: 10px;
          font-weight: 800;
          padding: 3px 8px;
          border-radius: 4px;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }

        /* ── Next Pickup Hero Box Inside Schedule ── */
        .cd-next-pickup-banner {
          background: #e7f5eb;
          border: 1px solid #bbf7d0;
          border-radius: 8px;
          padding: 16px 20px;
          margin: 16px 20px;
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .cd-pickup-icon {
          width: 44px;
          height: 44px;
          border-radius: 8px;
          background: #ffffff;
          color: #16a34a;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
          flex-shrink: 0;
        }

        /* ── Sidebar Mini Widgets ── */
        .cd-guide-item {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          padding: 10px 0;
          border-bottom: 1px solid #f0f2f5;
        }

        .cd-guide-item:last-child {
          border-bottom: none;
          padding-bottom: 0;
        }

        .cd-guide-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          margin-top: 6px;
          flex-shrink: 0;
        }

        /* Empty state styling */
        .cd-empty-box {
          padding: 36px 20px;
          text-align: center;
          color: #65676b;
        }

        .cd-empty-icon {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          background: #f0f2f5;
          color: #8a8d91;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 12px;
        }
      `}</style>

      <div className="cd-meta-canvas">
        <div className="cd-container">

          {/* ══════════════════════════════════════════════════════════════
              1. TOP HEADER & QUICK ACTION BAR (Meta Business Suite Style)
          ══════════════════════════════════════════════════════════════ */}
          <div className="cd-header-row">
            <div>
              <div className="cd-badge-group">
                <span className="cd-role-badge">RESIDENT</span>
                {user?.employee_type === 'crew_member' && (
                  <span className="cd-crew-badge">CREW MEMBER</span>
                )}
                <span className="cd-location-badge">
                  <SvgMapPin />
                  {userBrgy || 'Lucena City'}
                </span>
              </div>
              <h1 className="cd-meta-title">
                Hello, {user?.full_name?.split(' ')[0] || 'Resident'}
              </h1>
              <p className="cd-meta-subtitle">
                Lucena City Solid Waste Citizen Portal · Stay informed on truck routes, schedules, and active reports
              </p>
            </div>

            <div className="cd-header-actions">
              <button
                className="cd-btn-primary"
                onClick={() => setShowBuilder(true)}
                title="Submit a new waste or uncollected garbage report"
              >
                <SvgCamera />
                <span>Submit Report</span>
              </button>
              <button
                className="cd-btn-secondary"
                onClick={() => setRankOpen(true)}
                title="View clean barangay standings in Lucena City"
              >
                <SvgTrophy />
                <span>City Rankings</span>
              </button>
              <button
                className="cd-btn-secondary"
                onClick={() => navigate('/public-map')}
                title="Open live tracking map"
              >
                <SvgMapPin />
                <span>Live Map</span>
              </button>
            </div>
          </div>

          {/* ══════════════════════════════════════════════════════════════
              2. TODAY'S LIVE TRUCK TRACKER (OR SCHEDULE STATUS HERO)
          ══════════════════════════════════════════════════════════════ */}
          {tracker.loading && !tracker.data?.trucks?.length ? (
            <LiveTrackerCard loading={true} />
          ) : tracker.data?.trucks?.length > 0 ? (
            tracker.data.trucks.map(t => <LiveTrackerCard key={t.schedule_id} truck={t} loading={tracker.loading} />)
          ) : loading ? (
            <LiveTrackerCard loading={true} />
          ) : (
            <DispatchCard
              dispatchData={activeDispatch}
              userBarangay={user?.barangay_name || user?.barangay?.name}
            />
          )}

          {/* ══════════════════════════════════════════════════════════════
              3. LGU ADVISORY / ANNOUNCEMENTS (Light Meta Suite Banner)
          ══════════════════════════════════════════════════════════════ */}
          <div
            className="cd-announcement-card"
            style={{
              borderLeft:
                currentAnnouncement.type === 'emergency'
                  ? '4px solid #dc2626'
                  : currentAnnouncement.priority === 'high'
                  ? '4px solid #d97706'
                  : currentAnnouncement.is_pinned
                  ? '4px solid #16a34a'
                  : '1px solid #e4e6eb',
            }}
          >
            <div className="cd-announcement-left">
              <div
                className="cd-announcement-icon-wrap"
                style={{
                  background:
                    currentAnnouncement.type === 'emergency'
                      ? '#fee2e2'
                      : currentAnnouncement.priority === 'high'
                      ? '#fef3c7'
                      : '#e7f5eb',
                  color:
                    currentAnnouncement.type === 'emergency'
                      ? '#dc2626'
                      : currentAnnouncement.priority === 'high'
                      ? '#d97706'
                      : '#15803d',
                }}
              >
                {currentAnnouncement.type === 'emergency' ? (
                  <SvgAlertTriangle />
                ) : (
                  <SvgMegaphone />
                )}
              </div>
              <div className="cd-announcement-content">
                <div
                  className="cd-announcement-tag"
                  style={{
                    color:
                      currentAnnouncement.type === 'emergency'
                        ? '#dc2626'
                        : currentAnnouncement.priority === 'high'
                        ? '#d97706'
                        : '#15803d',
                  }}
                >
                  {currentAnnouncement.type === 'emergency'
                    ? 'Emergency Alert'
                    : currentAnnouncement.priority === 'high'
                    ? 'Urgent Notice'
                    : currentAnnouncement.is_pinned
                    ? 'Pinned Advisory'
                    : 'LGU Advisory'}
                </div>
                <div className="cd-announcement-title">
                  {currentAnnouncement.title}
                </div>
                <div className="cd-announcement-body">
                  {currentAnnouncement.description || currentAnnouncement.body}
                </div>
              </div>
            </div>

            <div className="cd-announcement-actions">
              {announcements.length > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <button
                    className="cd-pager-btn"
                    onClick={() =>
                      setAnnouncementIdx(
                        p => (p - 1 + announcements.length) % announcements.length
                      )
                    }
                    title="Previous announcement"
                    aria-label="Previous announcement"
                  >
                    ‹
                  </button>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#65676b', minWidth: 32, textAlign: 'center' }}>
                    {(announcementIdx % announcements.length) + 1}/{announcements.length}
                  </span>
                  <button
                    className="cd-pager-btn"
                    onClick={() =>
                      setAnnouncementIdx(p => (p + 1) % announcements.length)
                    }
                    title="Next announcement"
                    aria-label="Next announcement"
                  >
                    ›
                  </button>
                </div>
              )}
              <button
                className="cd-btn-secondary"
                style={{ padding: '6px 12px', fontSize: 12 }}
                onClick={() =>
                  navigate(
                    currentAnnouncement?.id
                      ? `/announcements?article=${currentAnnouncement.id}`
                      : '/announcements'
                  )
                }
              >
                Read More
                <SvgChevronRight />
              </button>
            </div>
          </div>

          {/* ══════════════════════════════════════════════════════════════
              4. CREW MEMBER SECTION (Rendered only if user is crew_member)
          ══════════════════════════════════════════════════════════════ */}
          {user?.employee_type === 'crew_member' && (
            <div className="cd-card" style={{ borderLeft: '4px solid #f59e0b' }}>
              <div className="cd-card-header">
                <div>
                  <h3 className="cd-card-title">
                    <span style={{ color: '#d97706', display: 'inline-flex' }}><SvgTruck size={18} color="#d97706" /></span>
                    My Assigned Crew Shift
                  </h3>
                  <p className="cd-card-subtitle">Collection team assignment and shift schedule</p>
                </div>
                <span className="cd-crew-badge">ACTIVE DUTY</span>
              </div>

              <div style={{ padding: 20 }}>
                {crewAssignment ? (
                  <div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 16 }}>
                      <div style={{ background: '#f8fafc', border: '1px solid #e4e6eb', borderRadius: 8, padding: 14 }}>
                        <div style={{ fontSize: 10, fontWeight: 800, color: '#65676b', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>Assigned Truck</div>
                        <div style={{ fontSize: 18, fontWeight: 800, color: '#1c1e21' }}>{crewAssignment.truck_plate}</div>
                        <div style={{ fontSize: 12, color: '#65676b' }}>{crewAssignment.truck_model || 'Compactor Truck'}</div>
                      </div>

                      <div style={{ background: '#f8fafc', border: '1px solid #e4e6eb', borderRadius: 8, padding: 14 }}>
                        <div style={{ fontSize: 10, fontWeight: 800, color: '#65676b', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>Lead Driver</div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: '#1c1e21' }}>{crewAssignment.driver_name || 'Assigned Driver'}</div>
                        <div style={{ fontSize: 12, color: '#65676b' }}>Operator in charge</div>
                      </div>

                      <div style={{ background: '#f8fafc', border: '1px solid #e4e6eb', borderRadius: 8, padding: 14 }}>
                        <div style={{ fontSize: 10, fontWeight: 800, color: '#65676b', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>Shift Window</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#1c1e21' }}>
                          {crewAssignment.schedule_start || '06:00 AM'} - {crewAssignment.schedule_end || '02:00 PM'}
                        </div>
                        <div style={{ fontSize: 12, color: '#65676b' }}>{crewAssignment.schedule_days || 'Mon-Sat'}</div>
                      </div>
                    </div>

                    {crewAssignment.crew_names?.length > 0 && (
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', marginBottom: 8 }}>Crew Members on this Shift</div>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {crewAssignment.crew_names.map(m => (
                            <span key={m.id} style={{
                              fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 4,
                              background: m.id === user?.id ? '#fef3c7' : '#f0f2f5',
                              color: m.id === user?.id ? '#b45309' : '#1c1e21',
                              border: m.id === user?.id ? '1px solid #fde68a' : '1px solid #e4e6eb',
                              display: 'inline-flex', alignItems: 'center', gap: 6,
                            }}>
                              {m.id === user?.id && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#f59e0b' }} />}
                              {m.full_name} {m.id === user?.id ? '(You)' : ''}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: '16px 0', color: '#65676b', fontSize: 13 }}>
                    No specific truck assignment registered for today's shift. Contact dispatch for assignment.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════
              5. RESIDENT STAT CARDS (4 METRICS)
          ══════════════════════════════════════════════════════════════ */}
          {loading ? (
            <StatCardSkeleton count={4} style={{ marginBottom: 20 }} />
          ) : (
          <div className="cd-stat-grid ww-stagger">
            {/* Stat 1: Total Reports */}
            <div
              className="cd-stat-card"
              onClick={() => {
                setReportsTab('all')
                document.getElementById('my-reports-section')?.scrollIntoView({ behavior: 'smooth' })
              }}
            >
              <div>
                <div className="cd-stat-label">My Submissions</div>
                <div className="cd-stat-val">{stats.total || myReports.length}</div>
                <div className="cd-stat-sub">Total waste reports logged</div>
              </div>
              <div className="cd-stat-icon-wrap" style={{ background: '#f0f2f5', color: '#1c1e21' }}>
                <SvgTrash />
              </div>
            </div>

            {/* Stat 2: Pending Approval */}
            <div
              className="cd-stat-card"
              onClick={() => {
                setReportsTab('pending')
                document.getElementById('my-reports-section')?.scrollIntoView({ behavior: 'smooth' })
              }}
            >
              <div>
                <div className="cd-stat-label">Pending Review</div>
                <div className="cd-stat-val" style={{ color: '#d97706' }}>
                  {stats.pending || tabCounts.pending}
                </div>
                <div className="cd-stat-sub">Awaiting barangay verification</div>
              </div>
              <div className="cd-stat-icon-wrap" style={{ background: '#fef3c7', color: '#b45309' }}>
                <SvgClock />
              </div>
            </div>

            {/* Stat 3: Resolved */}
            <div
              className="cd-stat-card"
              onClick={() => {
                setReportsTab('done')
                document.getElementById('my-reports-section')?.scrollIntoView({ behavior: 'smooth' })
              }}
            >
              <div>
                <div className="cd-stat-label">Resolved Issues</div>
                <div className="cd-stat-val" style={{ color: '#16a34a' }}>
                  {stats.resolved || tabCounts.done}
                </div>
                <div className="cd-stat-sub">Cleaned & confirmed</div>
              </div>
              <div className="cd-stat-icon-wrap" style={{ background: '#e7f5eb', color: '#15803d' }}>
                <SvgCheckCircle />
              </div>
            </div>

            {/* Stat 4: Next Pickup */}
            <div
              className="cd-stat-card"
              onClick={() => {
                document.getElementById('schedule-section')?.scrollIntoView({ behavior: 'smooth' })
              }}
            >
              <div>
                <div className="cd-stat-label">Next Collection</div>
                <div className="cd-stat-val" style={{ fontSize: 20, color: '#16a34a' }}>
                  {nextDay ? nextDay.day : 'Check Schedule'}
                </div>
                <div className="cd-stat-sub">
                  {nextDay ? nextDay.time : 'Weekly pickup times'}
                </div>
              </div>
              <div className="cd-stat-icon-wrap" style={{ background: '#e7f5eb', color: '#16a34a' }}>
                <SvgCalendar />
              </div>
            </div>
          </div>
          )}

          {/* ══════════════════════════════════════════════════════════════
              6. TWO-COLUMN MAIN GRID
          ══════════════════════════════════════════════════════════════ */}
          <div className="cd-page-grid">

            {/* ─── LEFT COLUMN: MY REPORTS & COLLECTION SCHEDULE ─── */}
            <div>

              {/* SECTION: MY REPORTS */}
              <div className="cd-card" id="my-reports-section">
                <div className="cd-card-header">
                  <div>
                    <h2 className="cd-card-title">
                      <SvgTrash />
                      My Waste Reports
                    </h2>
                    <p className="cd-card-subtitle">
                      Track real-time status of your uncollected waste and hotspot submissions
                    </p>
                  </div>

                  <button
                    className="cd-btn-primary"
                    style={{ padding: '6px 12px', fontSize: 12 }}
                    onClick={() => setShowBuilder(true)}
                  >
                    <SvgCamera />
                    <span>+ New Report</span>
                  </button>
                </div>

                {/* Filter Tabs (Segmented control) */}
                <div style={{ padding: '12px 20px', borderBottom: '1px solid #e4e6eb', background: '#fafbfc' }}>
                  <div className="cd-tab-segmented">
                    <button
                      className={`cd-tab-item ${reportsTab === 'all' ? 'active' : ''}`}
                      onClick={() => setReportsTab('all')}
                    >
                      All
                      <span className="cd-tab-count">{tabCounts.all}</span>
                    </button>
                    <button
                      className={`cd-tab-item ${reportsTab === 'pending' ? 'active' : ''}`}
                      onClick={() => setReportsTab('pending')}
                    >
                      Pending
                      <span className="cd-tab-count">{tabCounts.pending}</span>
                    </button>
                    <button
                      className={`cd-tab-item ${reportsTab === 'done' ? 'active' : ''}`}
                      onClick={() => setReportsTab('done')}
                    >
                      Resolved
                      <span className="cd-tab-count">{tabCounts.done}</span>
                    </button>
                    <button
                      className={`cd-tab-item ${reportsTab === 'rejected' ? 'active' : ''}`}
                      onClick={() => setReportsTab('rejected')}
                    >
                      Rejected
                      <span className="cd-tab-count">{tabCounts.rejected}</span>
                    </button>
                  </div>
                </div>

                {/* Reports List */}
                <div>
                  {loading ? (
                    <div style={{ padding: 20 }}>
                      <FeedCardSkeleton count={3} compact />
                    </div>
                  ) : filteredReports.length === 0 ? (
                    <div className="cd-empty-box ww-fade-in">
                      <div className="cd-empty-icon">
                        <SvgTrash />
                      </div>
                      <div style={{ fontWeight: 700, fontSize: 15, color: '#1c1e21', marginBottom: 4 }}>
                        {reportsTab === 'all' ? 'No waste reports yet' : `No ${reportsTab} reports`}
                      </div>
                      <div style={{ fontSize: 13, color: '#65676b', maxWidth: 360, margin: '0 auto 16px' }}>
                        Notice uncollected trash or illegal dumping in your barangay? Snap a photo and let our team know.
                      </div>
                      <button
                        className="cd-btn-primary"
                        onClick={() => setShowBuilder(true)}
                        style={{ margin: '0 auto' }}
                      >
                        <SvgCamera />
                        Submit a Report
                      </button>
                    </div>
                  ) : (
                    <div className="ww-stagger">
                    {filteredReports.map(report => {
                      const sm = STATUS_META[report.status] || STATUS_META.pending
                      const formattedDate = new Date(report.created_at).toLocaleDateString('en-PH', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })

                      return (
                        <div
                          key={report.id}
                          className="cd-meta-row"
                          onClick={() => setSelectedReportId(report.id)}
                          title="Click to view report details"
                        >
                          {/* Left icon */}
                          <div
                            className="cd-type-icon-box"
                            style={{
                              background:
                                report.status === 'resolved'
                                  ? '#e7f5eb'
                                  : report.status === 'rejected'
                                  ? '#fee2e2'
                                  : '#f0f2f5',
                              color:
                                report.status === 'resolved'
                                  ? '#15803d'
                                  : report.status === 'rejected'
                                  ? '#dc2626'
                                  : '#4b5563',
                            }}
                          >
                            <SvgTrash />
                          </div>

                          {/* Center info */}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                              <span style={{ fontWeight: 700, fontSize: 14, color: '#1c1e21' }}>
                                {report.issue_type_display ||
                                  report.waste_type_display ||
                                  (report.issue_type || report.waste_type || 'Waste Issue').toUpperCase()}
                              </span>
                              {report.is_urgent && (
                                <span style={{ background: '#fee2e2', color: '#dc2626', fontSize: 10, fontWeight: 800, padding: '1px 6px', borderRadius: 3 }}>
                                  URGENT
                                </span>
                              )}
                            </div>

                            <div style={{ fontSize: 12, color: '#65676b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {report.address || report.barangay_name || 'Lucena City'}
                            </div>

                            {/* Rejection callout box if rejected */}
                            {report.status === 'rejected' && report.rejection_reason && (
                              <div
                                style={{
                                  marginTop: 8,
                                  background: '#fee2e2',
                                  border: '1px solid #fecaca',
                                  borderRadius: 4,
                                  padding: '6px 10px',
                                  fontSize: 12,
                                  color: '#b91c1c',
                                  display: 'flex',
                                  alignItems: 'flex-start',
                                  gap: 6,
                                }}
                              >
                                <span style={{ marginTop: 1, flexShrink: 0 }}><SvgAlertTriangle /></span>
                                <div>
                                  <strong>Reason for rejection:</strong> {report.rejection_reason}
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Right status & date */}
                          <div style={{ textAlign: 'right', flexShrink: 0 }}>
                            <span
                              className="cd-status-pill"
                              style={{
                                background: sm.bg,
                                color: sm.color,
                                border: `1px solid ${sm.border}`,
                              }}
                            >
                              {sm.label}
                            </span>
                            <div style={{ fontSize: 11, color: '#8a8d91', marginTop: 4 }}>
                              {formattedDate}
                            </div>
                          </div>

                          {/* Chevron */}
                          <div style={{ color: '#bcc0c4', flexShrink: 0 }}>
                            <SvgChevronRight />
                          </div>
                        </div>
                      )
                    })}
                    </div>
                  )}
                </div>
              </div>

              {/* SECTION: WEEKLY COLLECTION SCHEDULE */}
              <div className="cd-card" id="schedule-section">
                <div className="cd-card-header">
                  <div>
                    <h2 className="cd-card-title">
                      <SvgCalendar />
                      Collection Schedule · {userBrgy || 'Lucena City'}
                    </h2>
                    <p className="cd-card-subtitle">Official solid waste collection timetable for your neighborhood</p>
                  </div>

                  <button
                    className="cd-btn-secondary"
                    style={{ padding: '6px 12px', fontSize: 12 }}
                    onClick={() => navigate('/schedule')}
                  >
                    Full City Schedule
                  </button>
                </div>

                {/* Highlight Next Pickup */}
                {!loading && nextDay && (
                  <div className="cd-next-pickup-banner ww-fade-in">
                    <div className="cd-pickup-icon">
                      <SvgTruck size={22} color="#16a34a" />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 10, fontWeight: 800, color: '#15803d', letterSpacing: '.07em', textTransform: 'uppercase', marginBottom: 2 }}>
                        Upcoming Scheduled Collection
                      </div>
                      <div style={{ fontSize: 17, fontWeight: 800, color: '#1c1e21', marginBottom: 2 }}>
                        {nextDay.day}
                      </div>
                      <div style={{ fontSize: 12, color: '#4b5563' }}>
                        Window: <strong>{nextDay.time}</strong> · Zone: {nextDay.zone}
                      </div>
                    </div>
                    <span
                      style={{
                        background: '#ffffff',
                        color: '#15803d',
                        border: '1px solid #bbf7d0',
                        fontSize: 10,
                        fontWeight: 800,
                        padding: '4px 10px',
                        borderRadius: 4,
                        letterSpacing: '.04em',
                      }}
                    >
                      NEXT
                    </span>
                  </div>
                )}

                {/* Full Schedule List */}
                <div>
                  {loading ? (
                    <div style={{ padding: 20 }}>
                      <SidebarWidgetSkeleton rows={3} />
                    </div>
                  ) : filteredSchedule.length === 0 ? (
                    <div className="ww-fade-in" style={{ padding: 28, textAlign: 'center', color: '#65676b', fontSize: 13 }}>
                      No specific scheduled routes currently registered for {userBrgy || 'your barangay'}. Please check back later.
                    </div>
                  ) : (
                    <div className="ww-stagger">
                    {filteredSchedule.map((s, i) => (
                      <div
                        key={i}
                        className="cd-meta-row"
                        style={{
                          background: s.isNext ? '#f8fafc' : 'transparent',
                          cursor: 'default',
                        }}
                      >
                        <div
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: 6,
                            background: s.isNext ? '#e7f5eb' : '#f0f2f5',
                            color: s.isNext ? '#16a34a' : '#65676b',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}
                        >
                          <SvgCalendar />
                        </div>

                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontWeight: s.isNext ? 700 : 600, fontSize: 14, color: '#1c1e21' }}>
                              {s.day}
                            </span>
                            {s.isNext && (
                              <span style={{ background: '#e7f5eb', color: '#15803d', fontSize: 9, fontWeight: 800, padding: '1px 6px', borderRadius: 3 }}>
                                NEXT PICKUP
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 12, color: '#65676b', marginTop: 1 }}>
                            {s.zone}
                          </div>
                        </div>

                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: s.time === 'N/A' ? '#8a8d91' : '#1c1e21' }}>
                            {s.time}
                          </div>
                          <div style={{ fontSize: 10, color: '#8a8d91', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                            Collection Window
                          </div>
                        </div>
                      </div>
                    ))}
                    </div>
                  )}
                </div>
              </div>

            </div>

            {/* ─── RIGHT COLUMN (SIDEBAR): MAP, HOTSPOTS, GUIDELINES ─── */}
            <div>

              {/* CARD 1: INTERACTIVE NEIGHBORHOOD MAP */}
              <div className="cd-card">
                <div className="cd-card-header">
                  <div>
                    <h3 className="cd-card-title">
                      <SvgMapPin />
                      Area Map &amp; Routes
                    </h3>
                    <p className="cd-card-subtitle">Collection points and active trucks</p>
                  </div>

                  <button
                    onClick={() => navigate('/public-map')}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#16a34a',
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: 0,
                    }}
                  >
                    <span>Full Map</span>
                    <SvgChevronRight />
                  </button>
                </div>

                <div style={{ padding: 12 }}>
                  <div style={{ borderRadius: 6, overflow: 'hidden', border: '1px solid #e4e6eb' }}>
                    <MiniMap />
                  </div>
                </div>

                <div style={{ padding: '10px 16px', background: '#fafbfc', borderTop: '1px solid #e4e6eb', fontSize: 11, color: '#65676b', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <SvgInfo />
                  <span>Real-time GPS updates for collection trucks when actively on route.</span>
                </div>
              </div>

              {/* CARD 2: ACTIVE HOTSPOTS IN BARANGAY */}
              <div className="cd-card" id="hotspots-section">
                <div className="cd-card-header">
                  <div>
                    <h3 className="cd-card-title">
                      <span style={{ color: '#dc2626', display: 'inline-flex' }}><SvgHotspot size={16} color="#dc2626" /></span>
                      Nearby Waste Hotspots
                    </h3>
                    <p className="cd-card-subtitle">Locations flagged for heavy accumulation</p>
                  </div>

                  <span
                    style={{
                      background: hotspots.length > 0 ? '#fee2e2' : '#e7f5eb',
                      color: hotspots.length > 0 ? '#b91c1c' : '#15803d',
                      fontSize: 10,
                      fontWeight: 800,
                      padding: '3px 8px',
                      borderRadius: 4,
                      letterSpacing: '.04em',
                    }}
                  >
                    {hotspots.length} ACTIVE
                  </span>
                </div>

                <div>
                  {loading ? (
                    <div style={{ padding: 20 }}>
                      <SidebarWidgetSkeleton rows={3} />
                    </div>
                  ) : hotspots.length === 0 ? (
                    <div className="ww-fade-in" style={{ padding: '24px 20px', textAlign: 'center', color: '#65676b', fontSize: 12 }}>
                      <div style={{ color: '#16a34a', marginBottom: 4 }}><SvgCheckCircle /></div>
                      No active waste hotspots currently reported in {userBrgy || 'your area'}.
                    </div>
                  ) : (
                    <div className="ww-stagger">
                    {hotspots.map((h, i) => {
                      const sev = SEVERITY_META[h.status] || SEVERITY_META.low
                      return (
                        <div
                          key={h.id || i}
                          className="cd-meta-row"
                          onClick={() => navigate('/public-map')}
                          title="View on Map"
                        >
                          <div
                            style={{
                              width: 32,
                              height: 32,
                              borderRadius: 6,
                              background: sev.bg,
                              color: sev.color,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                            }}
                          >
                            <SvgMapPin />
                          </div>

                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: 13, color: '#1c1e21', marginBottom: 1 }}>
                              {h.barangay_name || userBrgy}
                            </div>
                            <div style={{ fontSize: 11, color: '#65676b' }}>
                              {h.type}
                            </div>
                          </div>

                          <div style={{ textAlign: 'right', flexShrink: 0 }}>
                            <span
                              style={{
                                fontSize: 10,
                                fontWeight: 800,
                                background: sev.bg,
                                color: sev.color,
                                padding: '2px 6px',
                                borderRadius: 3,
                              }}
                            >
                              {h.count} reports
                            </span>
                          </div>
                        </div>
                      )
                    })}
                    </div>
                  )}
                </div>
              </div>

              {/* CARD 3: CITIZEN INFORMATION & CLEANLINESS STANDINGS */}
              <div className="cd-card">
                <div className="cd-card-header">
                  <div>
                    <h3 className="cd-card-title">
                      <SvgTrophy />
                      Cleanliness &amp; Guidelines
                    </h3>
                    <p className="cd-card-subtitle">Lucena City Solid Waste Management Portal</p>
                  </div>
                </div>

                <div style={{ padding: '16px 20px' }}>
                  {/* Cleanliness Ranking Teaser */}
                  <div
                    style={{
                      background: '#f8fafc',
                      border: '1px solid #e4e6eb',
                      borderRadius: 6,
                      padding: '12px 14px',
                      marginBottom: 16,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      cursor: 'pointer',
                    }}
                    onClick={() => setRankOpen(true)}
                  >
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 800, color: '#15803d', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 2 }}>
                        City Cleanliness Standings
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#1c1e21' }}>
                        {userBrgy || 'Lucena City'} Barangay Ranking
                      </div>
                    </div>
                    <button
                      className="cd-btn-primary"
                      style={{ padding: '4px 10px', fontSize: 11 }}
                      onClick={e => {
                        e.stopPropagation()
                        setRankOpen(true)
                      }}
                    >
                      View Top 10
                    </button>
                  </div>

                  {/* Segregation Guide */}
                  <div style={{ fontSize: 11, fontWeight: 800, color: '#65676b', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
                    Waste Segregation Reminder
                  </div>

                  <div className="cd-guide-item">
                    <div className="cd-guide-dot" style={{ background: '#16a34a' }} />
                    <div style={{ fontSize: 12, color: '#4b5563', lineHeight: 1.4 }}>
                      <strong style={{ color: '#1c1e21' }}>Biodegradable:</strong> Food scraps, leaves, and organic kitchen waste.
                    </div>
                  </div>

                  <div className="cd-guide-item">
                    <div className="cd-guide-dot" style={{ background: '#d97706' }} />
                    <div style={{ fontSize: 12, color: '#4b5563', lineHeight: 1.4 }}>
                      <strong style={{ color: '#1c1e21' }}>Non-Biodegradable:</strong> Single-use plastics, sanitary items, and wrappers.
                    </div>
                  </div>

                  <div className="cd-guide-item">
                    <div className="cd-guide-dot" style={{ background: '#2563eb' }} />
                    <div style={{ fontSize: 12, color: '#4b5563', lineHeight: 1.4 }}>
                      <strong style={{ color: '#1c1e21' }}>Recyclables:</strong> Clean bottles, cardboard, metals, and scrap paper.
                    </div>
                  </div>

                  {/* Hotline */}
                  <div
                    style={{
                      marginTop: 16,
                      paddingTop: 12,
                      borderTop: '1px solid #f0f2f5',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: 11,
                      color: '#65676b',
                    }}
                  >
                    <span>LGU Lucena Hotline:</span>
                    <strong style={{ color: '#1c1e21' }}>(042) 710-3500</strong>
                  </div>
                </div>
              </div>

            </div>

          </div>

        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════
          MODALS & OVERLAYS (100% PRESERVED FUNCTIONALITIES)
      ══════════════════════════════════════════════════════════════ */}
      <OfflineReportBuilder
        isOpen={showBuilder}
        onClose={() => setShowBuilder(false)}
        onSubmit={handleSubmitReport}
      />

      {selectedReportId && (
        <ReportDetail
          reportId={selectedReportId}
          onClose={() => setSelectedReportId(null)}
        />
      )}

      <RankingModal
        open={rankOpen}
        onClose={() => setRankOpen(false)}
        userBarangay={user?.barangay_name}
      />
    </>
  )
}