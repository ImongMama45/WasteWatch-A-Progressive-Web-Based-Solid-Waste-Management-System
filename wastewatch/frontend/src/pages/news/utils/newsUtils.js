/**
 * pages/news/utils/newsUtils.js
 * ------------------------------
 * Pure utilities for filtering, sorting, and safely resolving news metadata.
 * Prevents runtime TypeError when item.barangay is a numeric foreign key ID.
 */

export function filterNews(items = [], category = 'All', search = '') {
  const q = (search || '').toLowerCase().trim()

  return (items || []).filter(item => {
    if (!item) return false

    // Category match
    const matchCat = category === 'All' || item.category === category
    if (!matchCat) return false

    if (!q) return true

    // Safe search match
    const title = (item.title || '').toLowerCase()
    const desc = (item.description || item.body || '').toLowerCase()
    const brgy = (
      item.barangay_name ||
      (typeof item.barangay === 'string' ? item.barangay : '') ||
      (item.barangay && typeof item.barangay === 'object' ? item.barangay.name || '' : '')
    ).toLowerCase()

    return title.includes(q) || desc.includes(q) || brgy.includes(q)
  })
}

export function sortNews(items = []) {
  return [...(items || [])].sort((a, b) => {
    const aPinned = Boolean(a.is_pinned ?? a.isPinned)
    const bPinned = Boolean(b.is_pinned ?? b.isPinned)
    if (aPinned && !bPinned) return -1
    if (!aPinned && bPinned) return 1
    return new Date(b.date || 0) - new Date(a.date || 0)
  })
}
