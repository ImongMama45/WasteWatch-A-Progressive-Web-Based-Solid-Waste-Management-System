import api from './client'

export const ATTENDANCE_STATUSES = Object.freeze([
  'PRESENT',
  'ABSENT',
  'LATE',
  'EXCUSED',
])

export const BASE_ARRIVAL_RADIUS_M = 150
export const MAX_ARRIVAL_GPS_ACCURACY_M = 50

export function getCurrentShift(options = {}) {
  return api.get('/api/driver/shift/current/', options).then((res) => res.data)
}

export function getActiveShift() {
  return api.get('/api/driver/shift/active/').then((res) => res.data)
}

export function getDriverProfile() {
  return api.get('/api/driver/shift/profile/').then((res) => res.data)
}

export function getPreallocatedTruck(scheduleId) {
  const params = scheduleId != null ? { schedule_id: scheduleId } : undefined
  return api.get('/api/driver/shift/preallocated-truck/', { params }).then((res) => res.data)
}

export function getCollectionSchedules(params = { paginate: false }) {
  return api.get('/api/driver/collection-schedules/', { params }).then((res) => res.data)
}

export function createCollectionSchedule(payload) {
  return api.post('/api/driver/collection-schedules/', payload).then((res) => res.data)
}

export function updateCollectionSchedule(scheduleId, payload) {
  return api.patch(`/api/driver/collection-schedules/${scheduleId}/`, payload).then((res) => res.data)
}

export function deleteCollectionSchedule(scheduleId) {
  return api.delete(`/api/driver/collection-schedules/${scheduleId}/`).then((res) => res.data)
}

export function optimizeScheduleRoute({ dumpsite_id, stops }) {
  return api.post('/api/driver/collection-schedules/optimize-route/', {
    dumpsite_id,
    stops,
  }).then((res) => res.data)
}

export function getTeamRoster({ scheduleId = null, date = null } = {}) {
  const params = {}
  if (scheduleId != null && scheduleId !== '') params.schedule_id = scheduleId
  if (date) params.date = date
  return api.get('/api/driver/shift/my_team_roster/', { params }).then((res) => res.data)
}

export function preStartShift(payload) {
  return api.post('/api/driver/shift/pre_start/', payload).then((res) => res.data)
}

export function startDriverShift(payload) {
  return api.post('/api/driver/shift/start/', payload).then((res) => res.data)
}

export function endDriverShift(payload) {
  return api.post('/api/driver/shift/end/', payload).then((res) => res.data)
}

export function updateShiftPhase(shiftId, payload) {
  return api.patch(`/api/driver/shift/${shiftId}/update-status/`, payload).then((res) => res.data)
}

export function submitDeploymentAttendance({ schedule_id, service_date, records }) {
  return api.post('/api/driver/shift/submit-deployment-attendance/', {
    schedule_id,
    service_date,
    records,
    attendance: records,
  }).then((res) => res.data)
}

export function getShiftRosterSnapshot(shiftId) {
  return api.get(`/api/driver/shift/${shiftId}/roster-snapshot/`).then((res) => res.data)
}

export function getShiftAttendance(shiftId) {
  return api.get(`/api/driver/shift/${shiftId}/attendance/`).then((res) => res.data)
}

export function submitShiftAttendance(shiftId, records) {
  return api.post(`/api/driver/shift/${shiftId}/attendance/`, {
    attendance: records,
    records,
  }).then((res) => res.data)
}

export function submitShiftAttendanceCorrection(shiftId, { record_id, corrected_status, reason }) {
  const url = shiftId != null && shiftId !== ''
    ? `/api/driver/shift/${shiftId}/attendance-correction/`
    : '/api/driver/shift/correct-deployment-attendance/'
  return api.post(url, {
    record_id,
    corrected_status,
    reason,
  }).then((res) => res.data)
}

export function requestTruckReplacement({ driver_shift_id = null, schedule_id = null, reason }) {
  const payload = { reason }
  if (driver_shift_id != null) payload.driver_shift_id = driver_shift_id
  if (schedule_id != null) payload.schedule_id = schedule_id
  return api.post('/api/driver/shift/request-truck-replacement/', payload).then((res) => res.data)
}

export function getPostShiftTruckInspection(driverShiftId) {
  return api.get('/api/dumpsite/truck-inspections/', {
    params: { driver_shift_id: driverShiftId },
  }).then((res) => res.data)
}

export function submitPostShiftTruckInspection({
  driver_shift_id,
  inspection_state,
  mechanical_condition,
  notes = '',
}) {
  return api.post('/api/dumpsite/truck-inspections/', {
    driver_shift_id,
    inspection_state,
    mechanical_condition,
    notes,
  }).then((res) => res.data)
}

export function getMyAttendanceHistory() {
  return api.get('/api/driver/shift/my-attendance-history/').then((res) => res.data)
}

export function getWorkerAttendanceHistory(workerId) {
  return api.get(`/api/driver/workers/${workerId}/attendance-history/`).then((res) => res.data)
}

export function getUserAttendanceHistory(userId) {
  return api.get(`/api/accounts/users/${userId}/attendance-history/`).then((res) => res.data)
}

export function getCrewShifts(params = {}) {
  return api.get('/api/driver/crew-shifts/', { params }).then((res) => res.data)
}

export function getCrewShiftAttendance(crewShiftId) {
  return api.get(`/api/driver/crew-shifts/${crewShiftId}/attendance/`).then((res) => res.data)
}

export function getCrewShiftRosterSnapshot(crewShiftId) {
  return api.get(`/api/driver/crew-shifts/${crewShiftId}/roster-snapshot/`).then((res) => res.data)
}

export function submitCrewShiftAttendanceCorrection(crewShiftId, { record_id, corrected_status, reason }) {
  return api.post(`/api/driver/crew-shifts/${crewShiftId}/attendance-correction/`, {
    record_id,
    corrected_status,
    reason,
  }).then((res) => res.data)
}

export function submitDeploymentAttendanceCorrection({ record_id, corrected_status, reason }) {
  return api.post('/api/driver/shift/correct-deployment-attendance/', {
    record_id,
    corrected_status,
    reason,
  }).then((res) => res.data)
}
