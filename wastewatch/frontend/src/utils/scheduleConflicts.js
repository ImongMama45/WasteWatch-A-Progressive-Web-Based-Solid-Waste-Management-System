// utils/scheduleConflicts.js

export function formatTime12h(timeStr) {
  if (!timeStr) return ''
  const [h, m] = timeStr.split(':')
  const hNum = parseInt(h, 10)
  if (isNaN(hNum)) return timeStr
  const ampm = hNum >= 12 ? 'PM' : 'AM'
  const h12 = hNum % 12 || 12
  return `${h12}:${m} ${ampm}`
}

function timeToMinutes(t) {
  if (!t) return 0
  const [h, m] = t.split(':').map(Number)
  return h * 60 + (m || 0)
}

export function detectConflicts(newSched, existingSchedules) {
  const newStart = timeToMinutes(newSched.start_time)
  const newEnd   = timeToMinutes(newSched.end_time)
  const newDays  = new Set(newSched.days || [])

  if (newStart >= newEnd || newDays.size === 0) return []

  const conflicts = []

  for (const ex of existingSchedules) {
    if (newSched.editId && String(ex.id) === String(newSched.editId)) continue

    const exDays = new Set((ex.days || '').split(', ').filter(Boolean))
    const shared = [...newDays].filter(d => exDays.has(d))
    if (shared.length === 0) continue

    const exStart = timeToMinutes(ex.start_time)
    const exEnd   = timeToMinutes(ex.end_time)

    const overlaps = newStart < exEnd && newEnd > exStart
    if (!overlaps) continue

    const sameTruck  = newSched.truck && String(ex.truck) === String(newSched.truck)
    const sameDriver = newSched.driver && String(ex.driver) === String(newSched.driver)

    if (sameTruck || sameDriver) {
      conflicts.push({
        type: sameTruck && sameDriver ? 'both' : sameTruck ? 'truck' : 'driver',
        conflictingScheduleId: ex.id,
        sharedDays: shared,
        existingTime: `${formatTime12h(ex.start_time)} – ${formatTime12h(ex.end_time)}`,
        truckPlate: ex.truck_plate,
        driverName: ex.driver_name,
      })
    }
  }

  return conflicts
}
