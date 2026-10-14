export const STALE_SHIFT_MS = 6 * 60 * 60 * 1000 // live shift silent this long = abandoned
                                                  // keep in sync with SHIFT_STALE_HOURS in settings.py

// isToday: for normal shifts check last_update; for swept shifts check ended_at
const _isToday = ts => ts != null && new Date(ts).toDateString() === new Date().toDateString()

/**
 * classifyShift(sh) — single source of truth for shift lifecycle.
 *
 * Input: one row from /api/driver/shift/active_shifts/
 * Output: { lifecycle, signal, lastSeen }
 *
 * lifecycle: 'active' | 'extended' | 'done' | 'abandoned' | 'past'
 *   - 'past': today-filter already handles most, but done shifts from
 *             yesterday can slip through; mark them past so fleet ignores them.
 *   - 'abandoned': heartbeat_timeout or truck_deleted (authoritative from backend),
 *                  OR frontend fallback (no sweep yet, gone silent >6h).
 *
 * signal: 'live' | 'weak' | 'lost' | 'ended'
 */
export function classifyShift(sh) {
  const ts    = sh.last_update ? new Date(sh.last_update).getTime() : null
  const endTs = sh.ended_at   ? new Date(sh.ended_at).getTime()    : null

  // 1. Authoritative abandoned (backend sweep, truck-delete signal, or API returning status='abandoned')
  if (sh.status === 'abandoned' || sh.end_reason === 'heartbeat_timeout' || sh.end_reason === 'truck_deleted') {
    const visibleToday = _isToday(sh.ended_at) || _isToday(sh.last_update)
    return {
      lifecycle: visibleToday ? 'abandoned' : 'past',
      signal: 'lost',
      lastSeen: endTs ?? ts,
    }
  }

  // 2. Normal completion (driver ended shift properly)
  if (sh.status === 'done') {
    const lastSeen = endTs ?? ts
    return {
      lifecycle: lastSeen != null && !_isToday(lastSeen) ? 'past' : 'done',
      signal: 'ended',
      lastSeen,
    }
  }

  // 3. Frontend fallback — sweep hasn't run yet but shift is very stale
  if (ts != null && Date.now() - ts > STALE_SHIFT_MS) {
    return { lifecycle: 'abandoned', signal: 'lost', lastSeen: ts }
  }

  // 4. Live states
  return {
    lifecycle: sh.is_extended_mode ? 'extended' : 'active',
    signal: sh.status === 'offline'      ? 'lost'
           : sh.status === 'weak_signal' ? 'weak'
           : 'live',
    lastSeen: ts,
  }
}
