/**
 * pages/news/utils/newsConfig.js
 * ------------------------------
 * Centralized visual and metadata configuration for the News suite.
 * Shared across NewsCard, ArticleDetailModal, CreatePostModal, and future Community posts.
 * Zero emojis.
 */

import { AlertTriangle, Megaphone, Newspaper } from 'lucide-react'

export const TYPE_CONFIG = {
  emergency: {
    Icon: AlertTriangle,
    badgeColor: '#e74c3c',
    badgeBg: 'rgba(231,76,60,.1)',
    badgeBorder: 'rgba(231,76,60,.3)',
    accentBorder: 'rgba(231,76,60,.3)',
    label: 'Emergency Alert',
  },
  announcement: {
    Icon: Megaphone,
    badgeColor: 'var(--accent)',
    badgeBg: 'rgba(46,204,113,.1)',
    badgeBorder: 'rgba(46,204,113,.3)',
    accentBorder: 'transparent',
    label: 'Announcement',
  },
  news: {
    Icon: Newspaper,
    badgeColor: 'var(--text-muted)',
    badgeBg: 'var(--surface-2)',
    badgeBorder: 'var(--border)',
    accentBorder: 'transparent',
    label: 'News',
  },
}

export const PRIORITY_CONFIG = {
  high:   { label: 'HIGH', color: '#e74c3c',  bg: 'rgba(231,76,60,.08)',  border: 'rgba(231,76,60,.2)'  },
  medium: { label: 'MED',  color: '#f39c12',  bg: 'rgba(243,156,18,.08)', border: 'rgba(243,156,18,.2)' },
  low:    { label: 'LOW',  color: 'var(--text-muted)', bg: 'var(--surface-2)', border: 'var(--border)' },
}

export const NEWS_CATEGORIES = [
  'General',
  'Announcements',
  'News',
  'Cleanup Drives',
  'Rankings',
  'Advisories',
  'Emergencies',
]

export const CATEGORY_TABS = ['All', ...NEWS_CATEGORIES]
