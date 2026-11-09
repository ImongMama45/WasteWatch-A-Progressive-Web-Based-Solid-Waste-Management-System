/**
 * pages/news/utils/newsConfig.js
 * ------------------------------
 * Centralized visual and metadata configuration for the News and Announcements suite.
 * Maps backend categories to public taxonomy without modifying database records.
 * Provides deterministic hero announcement selection, reading-time estimation,
 * and canonical category definitions.
 * Zero emojis. Material / Lucide icons only.
 */

import {
  AlertTriangle,
  Megaphone,
  Newspaper,
  Sparkles,
  Trophy,
  AlertCircle,
  ShieldAlert,
  Info,
  RefreshCw,
  LayoutGrid,
} from 'lucide-react'

// ── Public Category Taxonomy & Database Reconciliation ──────────────────────
export const ANNOUNCEMENT_CATEGORIES = [
  {
    id: 'All',
    label: 'All Notices',
    rawKeys: [],
  },
  {
    id: 'Announcements',
    label: 'Announcements',
    rawKeys: ['Announcements', 'announcement'],
  },
  {
    id: 'Service Updates',
    label: 'Service Updates',
    rawKeys: ['Service Updates'],
  },
  {
    id: 'Cleanup Drives',
    label: 'Cleanup Drives',
    rawKeys: ['Cleanup Drives'],
  },
  {
    id: 'Advisories',
    label: 'Advisories & Alerts',
    rawKeys: ['Advisories', 'Emergencies', 'Emergency', 'emergency'],
  },
  {
    id: 'Rankings',
    label: 'Barangay Rankings',
    rawKeys: ['Rankings'],
  },
  {
    id: 'Community News',
    label: 'Community News',
    rawKeys: ['News', 'news', 'General', 'Community'],
  },
]

export const CATEGORY_TABS = ANNOUNCEMENT_CATEGORIES.map(c => ({
  id: c.id,
  label: c.label,
}))

/**
 * Resolves the public display label for any internal category id or alias.
 */
export function getCategoryLabel(categoryId) {
  if (!categoryId) return 'All Notices'
  const target = String(categoryId).trim().toLowerCase()
  const found = ANNOUNCEMENT_CATEGORIES.find(
    c => c.id.toLowerCase() === target || c.label.toLowerCase() === target
  )
  return found ? found.label : categoryId
}

/**
 * Pure category matching utility.
 * - Matches strictly against item.category (never uses item.type).
 * - Case-insensitive and whitespace-tolerant.
 * - Gracefully handles missing, null, undefined, or unexpected category values.
 */
export function matchesCategory(itemCategory, targetCategory) {
  if (!targetCategory) return true
  const target = String(targetCategory).trim().toLowerCase()
  if (target === 'all' || target === 'all notices') return true

  const raw = (itemCategory || '').trim().toLowerCase()
  if (!raw) return false

  // Find configuration for the target category by id or label
  let config = ANNOUNCEMENT_CATEGORIES.find(
    c => c.id.toLowerCase() === target || c.label.toLowerCase() === target
  )

  // If not found by id or label, check if target itself is a legacy rawKey (e.g. 'emergencies')
  if (!config) {
    config = ANNOUNCEMENT_CATEGORIES.find(c =>
      c.rawKeys.some(k => k.trim().toLowerCase() === target)
    )
  }

  if (config && config.rawKeys.length > 0) {
    return config.rawKeys.some(k => k.trim().toLowerCase() === raw)
  }

  // Fallback for custom or direct category name comparison
  return target === raw
}

// ── Deterministic Hero Announcement Selection ──────────────────────────────
/**
 * Selects the featured announcement from active eligible items:
 * 1. is_featured === true, newest first
 * 2. is_pinned === true, newest first
 * 3. priority === 'high', newest first
 * 4. Otherwise null
 *
 * Does NOT mutate the input array.
 * Deterministically breaks ties using record ID.
 */
export function selectFeaturedAnnouncement(items) {
  if (!Array.isArray(items) || items.length === 0) return null

  // Filter eligible, active items
  const eligible = items.filter(item => {
    if (!item || typeof item !== 'object') return false
    if (item.is_active === false) return false
    return true
  })

  if (eligible.length === 0) return null

  const sortByNewest = (a, b) => {
    const timeA = a.date ? new Date(a.date).getTime() : 0
    const timeB = b.date ? new Date(b.date).getTime() : 0
    const validA = Number.isFinite(timeA) ? timeA : 0
    const validB = Number.isFinite(timeB) ? timeB : 0
    if (validB !== validA) return validB - validA

    const idA = Number(a.id) || 0
    const idB = Number(b.id) || 0
    return idB - idA
  }

  // 1. is_featured === true
  const featured = eligible.filter(item => item.is_featured === true).sort(sortByNewest)
  if (featured.length > 0) return featured[0]

  // 2. is_pinned === true
  const pinned = eligible.filter(item => item.is_pinned === true).sort(sortByNewest)
  if (pinned.length > 0) return pinned[0]

  // 3. priority === 'high'
  const highPriority = eligible.filter(item => item.priority === 'high').sort(sortByNewest)
  if (highPriority.length > 0) return highPriority[0]

  // 4. Otherwise omit hero
  return null
}

// ── Reading-Time Calculation Utility ─────────────────────────────────────────
/**
 * Estimates reading time based on approximately 200 words per minute.
 * Returns null for missing, empty, or descriptions with fewer than 15 words.
 * Never hardcodes reading time.
 * Returns string e.g. "1 min read", "2 min read", or null.
 */
export function calculateReadingTime(text) {
  if (!text || typeof text !== 'string') return null
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length < 15) return null
  const minutes = Math.max(1, Math.ceil(words.length / 200))
  return `${minutes} min read`
}

/**
 * Detailed reading time object for advanced metadata badges.
 */
export function estimateReadingTime(text) {
  if (!text || typeof text !== 'string') return null
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length < 15) return null
  const minutes = Math.max(1, Math.ceil(words.length / 200))
  return {
    minutes,
    words: words.length,
    text: `${minutes} min read`,
  }
}

// ── Content Format / Archetype Visual Configuration ─────────────────────────
export const TYPE_CONFIG = {
  emergency: {
    Icon: AlertTriangle,
    badgeColor: '#dc2626',
    badgeBg: 'rgba(220,38,38,.1)',
    badgeBorder: 'rgba(220,38,38,.3)',
    accentBorder: 'rgba(220,38,38,.4)',
    label: 'Emergency Alert',
  },
  announcement: {
    Icon: Megaphone,
    badgeColor: '#16a34a',
    badgeBg: 'rgba(220,163,74,.1)',
    badgeBorder: 'rgba(22,163,74,.3)',
    accentBorder: 'transparent',
    label: 'Announcement',
  },
  news: {
    Icon: Newspaper,
    badgeColor: '#2563eb',
    badgeBg: 'rgba(37,99,235,.1)',
    badgeBorder: 'rgba(37,99,235,.25)',
    accentBorder: 'transparent',
    label: 'News',
  },
}

// ── Category Thematic Visual Configuration ──────────────────────────────────
export const CATEGORY_CONFIG = {
  // Canonical Identifiers & Labels
  All: {
    Icon: LayoutGrid,
    color: '#16a34a',
    bg: 'rgba(22,163,74,.09)',
    border: 'rgba(22,163,74,.25)',
  },
  'All Notices': {
    Icon: LayoutGrid,
    color: '#16a34a',
    bg: 'rgba(22,163,74,.09)',
    border: 'rgba(22,163,74,.25)',
  },
  Announcements: {
    Icon: Megaphone,
    color: '#16a34a',
    bg: 'rgba(22,163,74,.09)',
    border: 'rgba(22,163,74,.25)',
  },
  'Service Updates': {
    Icon: RefreshCw,
    color: '#0284c7',
    bg: 'rgba(2,132,199,.09)',
    border: 'rgba(2,132,199,.25)',
  },
  'Cleanup Drives': {
    Icon: Sparkles,
    color: '#059669',
    bg: 'rgba(5,150,105,.09)',
    border: 'rgba(5,150,105,.25)',
  },
  Advisories: {
    Icon: AlertCircle,
    color: '#b45309',
    bg: 'rgba(180,83,9,.09)',
    border: 'rgba(180,83,9,.25)',
  },
  'Advisories & Alerts': {
    Icon: AlertCircle,
    color: '#b45309',
    bg: 'rgba(180,83,9,.09)',
    border: 'rgba(180,83,9,.25)',
  },
  Rankings: {
    Icon: Trophy,
    color: '#d97706',
    bg: 'rgba(217,119,6,.09)',
    border: 'rgba(217,119,6,.25)',
  },
  'Barangay Rankings': {
    Icon: Trophy,
    color: '#d97706',
    bg: 'rgba(217,119,6,.09)',
    border: 'rgba(217,119,6,.25)',
  },
  'Community News': {
    Icon: Newspaper,
    color: '#2563eb',
    bg: 'rgba(37,99,235,.09)',
    border: 'rgba(37,99,235,.25)',
  },

  // Raw Database Values & Backward Compatibility Aliases
  General: {
    Icon: Info,
    color: '#4b5563',
    bg: 'rgba(75,85,99,.08)',
    border: 'rgba(75,85,99,.2)',
  },
  News: {
    Icon: Newspaper,
    color: '#2563eb',
    bg: 'rgba(37,99,235,.09)',
    border: 'rgba(37,99,235,.25)',
  },
  Emergencies: {
    Icon: ShieldAlert,
    color: '#dc2626',
    bg: 'rgba(220,38,38,.09)',
    border: 'rgba(220,38,38,.25)',
  },
  Emergency: {
    Icon: ShieldAlert,
    color: '#dc2626',
    bg: 'rgba(220,38,38,.09)',
    border: 'rgba(220,38,38,.25)',
  },
  Community: {
    Icon: Newspaper,
    color: '#2563eb',
    bg: 'rgba(37,99,235,.09)',
    border: 'rgba(37,99,235,.25)',
  },
}

// ── Urgency Level Configuration ──────────────────────────────────────────────
export const PRIORITY_CONFIG = {
  high:   { label: 'HIGH', color: '#dc2626', bg: 'rgba(220,38,38,.09)',  border: 'rgba(220,38,38,.25)' },
  medium: { label: 'MED',  color: '#d97706', bg: 'rgba(217,119,6,.09)', border: 'rgba(217,119,6,.25)' },
  low:    { label: 'LOW',  color: 'var(--text-muted, #64748b)', bg: 'rgba(100,116,139,.08)', border: 'rgba(100,116,139,.18)' },
}

// ── Dropdown and Tab Arrays (Backward Compatible) ─────────────────────────────
export const NEWS_CATEGORIES = [
  'General',
  'Announcements',
  'News',
  'Service Updates',
  'Cleanup Drives',
  'Rankings',
  'Advisories',
  'Emergencies',
]
