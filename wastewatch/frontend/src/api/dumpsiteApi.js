/**
 * dumpsiteApi.js — Shared API client for the Dumpsite Operator Workspace
 * ----------------------------------------------------------------------
 * Wraps all Milestone 4 facility operations, monitoring, inspections,
 * operational holds, maintenance, allocations/replacements, fuel logs,
 * and Admin operator assignment endpoints using src/api/client.js.
 */

import api from './client'

export function unwrapList(data) {
  if (Array.isArray(data)) return data
  if (data && Array.isArray(data.results)) return data.results
  return []
}

export function unwrapPaginated(data, fallbackPageSize = 10) {
  if (Array.isArray(data)) {
    return {
      results: data,
      count: data.length,
      total_pages: 1,
      current_page: 1,
      page_size: fallbackPageSize,
    }
  }
  return {
    results: Array.isArray(data?.results) ? data.results : [],
    count: Number(data?.count ?? (Array.isArray(data?.results) ? data.results.length : 0)),
    total_pages: Number(data?.total_pages ?? 1),
    current_page: Number(data?.current_page ?? 1),
    page_size: Number(data?.page_size ?? fallbackPageSize),
  }
}

// ── Dumpsites & Facility Overview / Monitoring / Activity ──────────────────

export function getDumpsites(params = { paginate: false }) {
  return api.get('/api/dumpsite/dumpsites/', { params }).then((res) => res.data)
}

export function getDumpsiteDetail(siteId) {
  return api.get(`/api/dumpsite/dumpsites/${siteId}/`).then((res) => res.data)
}

export function getDumpsiteDashboard(siteId) {
  return api.get(`/api/dumpsite/dumpsites/${siteId}/dashboard/`).then((res) => res.data)
}

export function getDumpsiteMonitoring(siteId, params = {}) {
  return api.get(`/api/dumpsite/dumpsites/${siteId}/monitoring/`, { params }).then((res) => res.data)
}

export function getDumpsiteActivity(siteId, params = {}) {
  return api.get(`/api/dumpsite/dumpsites/${siteId}/activity/`, { params }).then((res) => res.data)
}

export function getDumpsiteInboundQueue(siteId) {
  return api.get(`/api/dumpsite/dumpsites/${siteId}/inbound_queue/`).then((res) => res.data)
}

export function getDumpsiteDeliveries(siteId, params = {}) {
  return api.get(`/api/dumpsite/dumpsites/${siteId}/deliveries/`, { params }).then((res) => res.data)
}

export function logDumpsiteArrival(siteId, payload) {
  return api.post(`/api/dumpsite/dumpsites/${siteId}/log_arrival/`, payload).then((res) => res.data)
}

export function getDumpsiteBarangayBreakdown(siteId, params = {}) {
  return api.get(`/api/dumpsite/dumpsites/${siteId}/barangay_breakdown/`, { params }).then((res) => res.data)
}

export function assignDumpsiteOperator(siteId, payload) {
  return api.post(`/api/dumpsite/dumpsites/${siteId}/assign-operator/`, payload).then((res) => res.data)
}

export function removeDumpsiteOperator(siteId, payload) {
  return api.post(`/api/dumpsite/dumpsites/${siteId}/remove-operator/`, payload).then((res) => res.data)
}

// ── Post-Shift & Facility Truck Inspections ────────────────────────────────

export function getTruckInspections(params = {}) {
  return api.get('/api/dumpsite/truck-inspections/', { params }).then((res) => res.data)
}

export function createTruckInspection(payload) {
  return api.post('/api/dumpsite/truck-inspections/', payload).then((res) => res.data)
}

// ── Operational Holds & Clearances ─────────────────────────────────────────

export function getTruckHolds(params = {}) {
  return api.get('/api/driver/truck-holds/', { params }).then((res) => res.data)
}

export function clearTruckHold(truckId, payload) {
  return api.post(`/api/driver/trucks/${truckId}/clear-hold/`, payload).then((res) => res.data)
}

// ── Facility Maintenance Records ───────────────────────────────────────────

export function getMaintenanceRecords(params = {}) {
  return api.get('/api/driver/maintenance-records/', { params }).then((res) => res.data)
}

export function createMaintenanceRecord(payload) {
  return api.post('/api/driver/maintenance-records/', payload).then((res) => res.data)
}

export function updateMaintenanceRecord(recordId, payload) {
  return api.patch(`/api/driver/maintenance-records/${recordId}/`, payload).then((res) => res.data)
}

export function startMaintenanceRecord(recordId, payload = {}) {
  return api.post(`/api/driver/maintenance-records/${recordId}/start/`, payload).then((res) => res.data)
}

export function completeMaintenanceRecord(recordId, payload = {}) {
  return api.post(`/api/driver/maintenance-records/${recordId}/complete/`, payload).then((res) => res.data)
}

export function recordTruckMaintenance(truckId, payload) {
  return api.post(`/api/driver/trucks/${truckId}/record-maintenance/`, payload).then((res) => res.data)
}

// ── Schedule Truck Allocations & Replacement Requests ──────────────────────

export function getScheduleTruckAllocations(params = {}) {
  return api.get('/api/driver/schedule-truck-allocations/', { params }).then((res) => res.data)
}

export function createScheduleTruckAllocation(payload) {
  return api.post('/api/driver/schedule-truck-allocations/', payload).then((res) => res.data)
}

export function updateScheduleTruckAllocation(allocationId, payload) {
  return api.patch(`/api/driver/schedule-truck-allocations/${allocationId}/`, payload).then((res) => res.data)
}

export function deleteScheduleTruckAllocation(allocationId) {
  return api.delete(`/api/driver/schedule-truck-allocations/${allocationId}/`).then((res) => res.data)
}

export function allocateScheduleTruck(scheduleId, payload) {
  return api.post(`/api/driver/collection-schedules/${scheduleId}/allocate-truck/`, payload).then((res) => res.data)
}

export function getTruckReplacementRequests(params = {}) {
  return api.get('/api/driver/truck-replacement-requests/', { params }).then((res) => res.data)
}

export function approveTruckReplacementRequest(requestId, payload) {
  return api.post(`/api/driver/truck-replacement-requests/${requestId}/approve/`, payload).then((res) => res.data)
}

export function rejectTruckReplacementRequest(requestId, payload) {
  return api.post(`/api/driver/truck-replacement-requests/${requestId}/reject/`, payload).then((res) => res.data)
}

export function replaceTruckAssignment(truckId, payload) {
  return api.post(`/api/driver/trucks/${truckId}/replace-truck/`, payload).then((res) => res.data)
}

// ── Fuel Logs ──────────────────────────────────────────────────────────────

export function getFuelLogs(params = {}) {
  return api.get('/api/driver/fuel-logs/', { params }).then((res) => res.data)
}

export function submitFuelGauge(payload) {
  return api.post('/api/driver/fuel-logs/submit-gauge/', payload).then((res) => res.data)
}

export function recordFuelRefill(payload) {
  return api.post('/api/driver/fuel-logs/record-refill/', payload).then((res) => res.data)
}

// ── Facility Trucks, Schedules & Read-Only Shifts ──────────────────────────

export function getFacilityTrucks(params = { paginate: false }) {
  return api.get('/api/driver/trucks/', { params }).then((res) => res.data)
}

export function getFacilitySchedules(params = { paginate: false }) {
  return api.get('/api/driver/collection-schedules/', { params }).then((res) => res.data)
}

export function getFacilityShifts(params = {}) {
  return api.get('/api/driver/shift/', { params }).then((res) => res.data)
}
