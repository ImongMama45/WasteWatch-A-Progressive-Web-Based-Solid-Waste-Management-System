export const TRUCK_COLORS = [
  { color: '#2563EB', bg: '#EFF6FF' }, { color: '#D97706', bg: '#FFFBEB' },
  { color: '#7C3AED', bg: '#F5F3FF' }, { color: '#DC2626', bg: '#FEF2F2' },
  { color: '#0891B2', bg: '#ECFEFF' }, { color: '#C026D3', bg: '#FDF4FF' },
  { color: '#059669', bg: '#ECFDF5' }, { color: '#EA580C', bg: '#FFF7ED' },
]
export function getTruckColorIdx(truckId) {
  if (!truckId) return 0
  const hash = parseInt(truckId, 10) || Array.from(String(truckId)).reduce((s, c) => s + c.charCodeAt(0), 0)
  return hash % TRUCK_COLORS.length
}
export const getTruckColor = id => TRUCK_COLORS[getTruckColorIdx(id)]
