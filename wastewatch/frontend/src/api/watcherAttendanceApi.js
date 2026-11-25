import api from './client'

export function getWatcherAttendanceDeployments(date = null) {
  const params = date ? { date } : undefined
  return api.get('/api/watcher/crew-attendance/deployments/', { params }).then((res) => res.data)
}

export function getWatcherDeploymentDetail(scheduleId, date = null) {
  const params = date ? { date } : undefined
  return api.get(`/api/watcher/crew-attendance/deployments/${scheduleId}/`, { params }).then((res) => res.data)
}

export function submitWatcherDeploymentAttendance(scheduleId, { service_date, records }) {
  const payload = { records }
  if (service_date) payload.service_date = service_date
  return api.post(`/api/watcher/crew-attendance/deployments/${scheduleId}/submit/`, payload).then((res) => res.data)
}

export function submitWatcherAttendanceCorrection(scheduleId, { service_date, attendance_record_id, new_status, reason }) {
  const payload = {
    attendance_record_id,
    new_status,
    reason,
  }
  if (service_date) payload.service_date = service_date
  return api.post(`/api/watcher/crew-attendance/deployments/${scheduleId}/correct/`, payload).then((res) => res.data)
}
