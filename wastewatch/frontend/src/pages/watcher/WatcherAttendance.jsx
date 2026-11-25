import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Users,
  Calendar,
  Truck,
  MapPin,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ArrowLeft,
  RefreshCw,
} from 'lucide-react'
import Navbar from '../../components/Navbar'
import BottomNav from '../../components/BottomNav'
import CrewAttendanceBoard from '../../components/CrewAttendanceBoard'
import { getWatcherAttendanceDeployments } from '../../api/watcherAttendanceApi'
import { formatToManilaDateString } from '../../api/calendarService'
import { getApiErrorMessage } from '../../utils/notificationHelpers'
import { formatReadinessErrorLabel } from '../../utils/routeBaseHelpers'

export default function WatcherAttendance() {
  const navigate = useNavigate()
  const [serviceDate, setServiceDate] = useState(() => formatToManilaDateString(new Date()))
  const [deployments, setDeployments] = useState([])
  const [selectedScheduleId, setSelectedScheduleId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const loadDeployments = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getWatcherAttendanceDeployments(serviceDate)
      const list = Array.isArray(data) ? data : data?.results || data?.deployments || []
      setDeployments(list)
      setSelectedScheduleId((prev) => {
        if (prev && list.some((d) => String(d.schedule_id) === String(prev))) {
          return prev
        }
        return list.length > 0 ? list[0].schedule_id : null
      })
    } catch (err) {
      setDeployments([])
      setSelectedScheduleId(null)
      setError(getApiErrorMessage(err, 'Failed to load Team Leader deployments.'))
    } finally {
      setLoading(false)
    }
  }, [serviceDate])

  useEffect(() => {
    loadDeployments()
  }, [loadDeployments])

  const pendingCount = deployments.filter((d) => d.attendance_status !== 'SUBMITTED').length

  return (
    <>
      <Navbar />
      <div
        style={{
          minHeight: '100vh',
          background: '#f8fafc',
          paddingBottom: 92,
        }}
      >
        <div
          style={{
            maxWidth: 960,
            margin: '0 auto',
            padding: '20px 16px',
          }}
        >
          {/* Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 12,
              marginBottom: 18,
            }}
          >
            <div>
              <button
                type="button"
                onClick={() => navigate('/dashboard')}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  marginBottom: 6,
                  color: '#475569',
                  fontSize: 12.5,
                  fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  cursor: 'pointer',
                }}
              >
                <ArrowLeft size={14} /> Back to Dashboard
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <h1
                  style={{
                    margin: 0,
                    fontFamily: 'var(--font-head)',
                    fontSize: 22,
                    fontWeight: 800,
                    color: '#0f172a',
                  }}
                >
                  Crew Attendance
                </h1>
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 800,
                    padding: '3px 9px',
                    borderRadius: 999,
                    background: pendingCount > 0 ? '#fffbeb' : '#ecfdf5',
                    color: pendingCount > 0 ? '#b45309' : '#065f46',
                    border: `1px solid ${pendingCount > 0 ? '#fde68a' : '#a7f3d0'}`,
                    letterSpacing: '0.04em',
                  }}
                >
                  {pendingCount > 0 ? `${pendingCount} PENDING` : 'TEAM LEADER'}
                </span>
              </div>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748b' }}>
                Deployments where you are the resolved Team Leader. Submit initial roll-call independently of truck shift start.
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  background: '#ffffff',
                  border: '1px solid #cbd5e1',
                  borderRadius: 10,
                  padding: '6px 10px',
                }}
              >
                <Calendar size={15} color="#059669" />
                <input
                  type="date"
                  value={serviceDate}
                  onChange={(e) => setServiceDate(e.target.value)}
                  style={{
                    border: 'none',
                    outline: 'none',
                    fontSize: 13,
                    fontWeight: 600,
                    color: '#0f172a',
                    background: 'transparent',
                  }}
                />
              </div>
              <button
                type="button"
                onClick={loadDeployments}
                title="Refresh deployments"
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                  color: '#334155',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                }}
              >
                <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>

          {error && (
            <div
              style={{
                background: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: 12,
                padding: '12px 14px',
                color: '#991b1b',
                fontSize: 13,
                marginBottom: 16,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <AlertTriangle size={16} />
              <span>{error}</span>
            </div>
          )}

          {loading ? (
            <div
              style={{
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: 14,
                padding: 36,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 10,
                color: '#64748b',
              }}
            >
              <RefreshCw size={24} className="animate-spin" color="#059669" />
              <span style={{ fontSize: 13, fontWeight: 600 }}>Loading Team Leader deployments...</span>
            </div>
          ) : deployments.length === 0 ? (
            <div
              style={{
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: 16,
                padding: '36px 20px',
                textAlign: 'center',
                color: '#64748b',
              }}
            >
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 12,
                  background: '#f1f5f9',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#64748b',
                  marginBottom: 12,
                }}
              >
                <Users size={24} />
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>
                No Team Leader deployments for {serviceDate}
              </div>
              <div style={{ fontSize: 13, maxWidth: 420, margin: '0 auto', lineHeight: 1.5 }}>
                Only deployments where you are the resolved Team Leader appear here. Switch dates above if checking another scheduled day.
              </div>
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: deployments.length > 1 ? 'minmax(0, 320px) minmax(0, 1fr)' : '1fr',
                gap: 16,
                alignItems: 'start',
              }}
            >
              {/* Deployment selector list */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {deployments.map((dep) => {
                  const isSelected = String(dep.schedule_id) === String(selectedScheduleId)
                  const isSubmitted = dep.attendance_status === 'SUBMITTED'
                  const hasBlockers =
                    dep.is_operationally_ready === false ||
                    (Array.isArray(dep.readiness_errors) && dep.readiness_errors.length > 0)

                  return (
                    <button
                      key={`${dep.schedule_id}-${dep.allocation_id || 'noalloc'}`}
                      type="button"
                      onClick={() => setSelectedScheduleId(dep.schedule_id)}
                      style={{
                        textAlign: 'left',
                        width: '100%',
                        padding: '14px 16px',
                        borderRadius: 14,
                        border: `1.5px solid ${isSelected ? '#059669' : '#e2e8f0'}`,
                        background: isSelected ? '#f0fdf4' : '#ffffff',
                        cursor: 'pointer',
                        boxShadow: isSelected
                          ? '0 4px 14px rgba(5, 150, 105, 0.1)'
                          : '0 1px 3px rgba(15, 23, 42, 0.04)',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 8,
                          marginBottom: 6,
                        }}
                      >
                        <span style={{ fontSize: 14, fontWeight: 800, color: '#0f172a' }}>
                          {dep.team?.name || 'Sanitation Team'}
                        </span>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '2px 8px',
                            borderRadius: 999,
                            fontSize: 10.5,
                            fontWeight: 700,
                            background: isSubmitted ? '#dcfce7' : '#fef3c7',
                            color: isSubmitted ? '#166534' : '#92400e',
                          }}
                        >
                          {isSubmitted ? <CheckCircle2 size={11} /> : <Clock size={11} />}
                          {isSubmitted ? 'SUBMITTED' : 'PENDING'}
                        </span>
                      </div>

                      <div style={{ fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
                        {dep.schedule_name || dep.barangay_name || `Schedule #${dep.schedule_id}`}
                      </div>

                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 11, color: '#64748b' }}>
                        {dep.truck?.plate_number && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <Truck size={12} /> {dep.truck.plate_number}
                          </span>
                        )}
                        {dep.dumpsite?.name && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <MapPin size={12} /> {dep.dumpsite.name}
                          </span>
                        )}
                        <span>
                          Driver Shift:{' '}
                          <strong style={{ color: '#334155' }}>
                            {dep.driver_shift_status || (dep.driver_shift_id ? 'Active' : 'Not started')}
                          </strong>
                        </span>
                      </div>

                      {hasBlockers && (
                        <div
                          style={{
                            marginTop: 8,
                            padding: '5px 8px',
                            borderRadius: 8,
                            background: '#fef2f2',
                            border: '1px solid #fecaca',
                            color: '#991b1b',
                            fontSize: 11,
                            fontWeight: 600,
                          }}
                        >
                          {(dep.readiness_errors || []).map(formatReadinessErrorLabel).join(' ') ||
                            'Schedule missing operational readiness.'}
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>

              {/* Active deployment attendance board */}
              {selectedScheduleId && (
                <CrewAttendanceBoard
                  key={`${selectedScheduleId}-${serviceDate}`}
                  mode="watcher"
                  scheduleId={selectedScheduleId}
                  serviceDate={serviceDate}
                  onSubmitted={loadDeployments}
                  onCorrected={loadDeployments}
                />
              )}
            </div>
          )}
        </div>
      </div>
      <BottomNav />
    </>
  )
}
