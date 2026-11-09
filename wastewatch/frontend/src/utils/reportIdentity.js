/**
 * reportIdentity.js
 * -----------------
 * Authoritative GarbageReport identity resolution and validation helpers.
 *
 * Data Contract:
 * - Map pin objects (from `/api/watcher/reports/map_pins/`):
 *   - `id`: The GarbageHotspot primary key.
 *   - `report_id`: The associated GarbageReport primary key (can be null if source_report is None).
 *   - `community_post_id`: The associated CommunityPost primary key (can be null).
 *
 * - Direct GarbageReport objects (from `/api/watcher/reports/`, `/mine/`, or `focusReport`):
 *   - `id`: The GarbageReport primary key.
 *   - Has NO `report_id` field (or undefined).
 *
 * Validation Rules:
 * - Accept positive safe integer numbers.
 * - Accept strings containing only positive decimal digits, provided the converted value is a safe integer.
 * - Reject `null`, `undefined`, empty strings, whitespace, booleans, arrays, objects, decimals, zero,
 *   negative numbers, `NaN`, `Infinity`, hexadecimal strings, exponent notation, and unsafe integers.
 * - A map pin containing a `report_id` property with a null or invalid value must NEVER fall back to its hotspot `id`.
 * - A direct GarbageReport object without a `report_id` property may use its own `id`, provided it passes validation.
 */

export function parsePositiveSafeInteger(val) {
  if (val == null) return null

  if (typeof val === 'number') {
    return Number.isSafeInteger(val) && val > 0 ? val : null
  }

  if (typeof val === 'string') {
    // Strings must contain only positive decimal digits (no whitespace, sign, decimal, hex, or exponent)
    if (!/^\d+$/.test(val)) return null
    try {
      const b = BigInt(val)
      if (b <= 0n || b > BigInt(Number.MAX_SAFE_INTEGER)) return null
      return Number(b)
    } catch {
      return null
    }
  }

  return null
}

export function getGarbageReportId(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null

  // 1. Map pin contract: object has 'report_id' key
  if ('report_id' in item) {
    // A map pin with null or invalid report_id must NEVER fall back to its hotspot id.
    return parsePositiveSafeInteger(item.report_id)
  }

  // 2. Direct GarbageReport or focusReport record without 'report_id' key
  if ('id' in item) {
    return parsePositiveSafeInteger(item.id)
  }

  return null
}

export function hasAssociatedGarbageReport(item) {
  return getGarbageReportId(item) !== null
}
