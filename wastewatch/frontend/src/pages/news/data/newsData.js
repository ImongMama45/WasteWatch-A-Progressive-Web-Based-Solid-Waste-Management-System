/**
 * newsData.js — Mock data for News & Announcements page
 * -------------------------------------------------------
 * REPLACE WITH: api.get('/api/announcements/')
 * All items follow a consistent schema for easy API swap.
 */

// ─── Types ────────────────────────────────────────────────────────────────────
// type: 'announcement' | 'news' | 'emergency'
// category: 'Announcements' | 'News' | 'Cleanup Drives' | 'Rankings' | 'Advisories' | 'Emergencies'
// priority: 'low' | 'medium' | 'high'

// ─── Featured Carousel Items ──────────────────────────────────────────────────
export const FEATURED_ITEMS = [
  {
    id: 'f1',
    type: 'emergency',
    category: 'Emergencies',
    title: 'Collection Suspended — Heavy Rainfall Advisory',
    description:
      'All garbage collection activities in coastal barangays are temporarily suspended due to Tropical Storm Warning Signal No. 1. Operations resume when safe.',
    date: '2026-05-19',
    barangay: 'City-Wide',
    priority: 'high',
    accentColor: '#e74c3c',
    bgColor: '#7f1d1d',
  },
  {
    id: 'f2',
    type: 'announcement',
    category: 'Cleanup Drives',
    title: 'Barangay Isabang Community Cleanup Drive — May 24',
    description:
      'Join us for the quarterly cleanup operation. Volunteers needed 6AM–10AM at the Isabang Barangay Hall. Free breakfast for participants.',
    date: '2026-05-17',
    barangay: 'Isabang',
    priority: 'medium',
    accentColor: '#2ecc71',
    bgColor: '#064e3b',
  },
  {
    id: 'f3',
    type: 'news',
    category: 'Rankings',
    title: 'Gulang-Gulang Tops May 2026 Cleanliness Rankings',
    description:
      'Congratulations to Barangay Gulang-Gulang for achieving a 98% waste compliance score — the highest in Lucena City this month.',
    date: '2026-05-15',
    barangay: 'Gulang-Gulang',
    priority: 'low',
    accentColor: '#f59e0b',
    bgColor: '#451a03',
  },
  {
    id: 'f4',
    type: 'announcement',
    category: 'Announcements',
    title: 'Updated Collection Schedule — June 2026',
    description:
      'The City Environment Office has published the updated garbage collection routes and times for all 33 barangays effective June 1, 2026.',
    date: '2026-05-14',
    barangay: 'City-Wide',
    priority: 'medium',
    accentColor: '#5dade2',
    bgColor: '#0c2340',
  },
]

// ─── Emergency Alerts (pinned at top) ────────────────────────────────────────
export const EMERGENCY_ALERTS = [
  {
    id: 'e1',
    title: 'Typhoon Rainy Season — Adjusted Collection Hours',
    body: 'Garbage collection in all barangays will be moved to 5:00 AM–9:00 AM starting May 20 due to afternoon heavy rains. Avoid leaving trash bags outside before 5AM.',
    date: '2026-05-19',
  },
]

// ─── News Feed Items ──────────────────────────────────────────────────────────
export const NEWS_ITEMS = [
  {
    id: 1,
    type: 'emergency',
    category: 'Emergencies',
    title: 'Collection Suspended — Heavy Rainfall Advisory',
    description: 'All garbage collection in coastal barangays suspended until further notice due to tropical storm.',
    date: '2026-05-19',
    barangay: 'City-Wide',
    priority: 'high',
    isPinned: true,
    isFeatured: true,
  },
  {
    id: 2,
    type: 'announcement',
    category: 'Announcements',
    title: 'Updated Garbage Collection Schedule — June 2026',
    description:
      'The City Environment Office has released the updated official collection schedule for all 33 barangays of Lucena City effective June 1, 2026. Please check your barangay\'s designated collection day.',
    date: '2026-05-18',
    barangay: 'City-Wide',
    priority: 'medium',
    isPinned: true,
    isFeatured: true,
  },
  {
    id: 3,
    type: 'news',
    category: 'Cleanup Drives',
    title: 'Barangay Isabang Cleanup Drive — May 24',
    description:
      'A community-led cleanup drive will be held in Barangay Isabang on May 24, 2026, from 6:00 AM to 10:00 AM. All residents are encouraged to participate.',
    date: '2026-05-17',
    barangay: 'Isabang',
    priority: 'low',
    isFeatured: true,
  },
  {
    id: 4,
    type: 'news',
    category: 'Rankings',
    title: 'May 2026 Cleanliness Rankings Released',
    description:
      'Gulang-Gulang tops this month\'s rankings with 98% compliance. Ibabang Dupay follows at 95%, with Mayao Crossing at 92%. See the full leaderboard in the Analytics section.',
    date: '2026-05-15',
    barangay: 'City-Wide',
    priority: 'low',
    isFeatured: true,
  },
  {
    id: 5,
    type: 'announcement',
    category: 'Advisories',
    title: 'Proper Waste Segregation Reminder',
    description:
      'The City Environment Office reminds all residents to properly segregate biodegradable, non-biodegradable, and hazardous waste. Non-compliant households may face penalties under City Ordinance 2019-04.',
    date: '2026-05-14',
    barangay: 'City-Wide',
    priority: 'medium',
  },
  {
    id: 6,
    type: 'news',
    category: 'News',
    title: 'New Dump Truck Deployed in Zone A',
    description:
      'The Lucena City Government has procured an additional garbage truck to service Zone A barangays, reducing missed collection incidents by an estimated 30%.',
    date: '2026-05-13',
    barangay: 'Zone A',
    priority: 'low',
  },
  {
    id: 7,
    type: 'announcement',
    category: 'Announcements',
    title: 'No Collection on May 28 — Regular Holiday',
    description:
      'There will be no garbage collection city-wide on May 28, 2026 in observance of the National Regular Holiday. Resumption of regular service on May 29.',
    date: '2026-05-12',
    barangay: 'City-Wide',
    priority: 'medium',
  },
  {
    id: 8,
    type: 'news',
    category: 'Cleanup Drives',
    title: 'Cotta Riverside Cleanup — 120 Volunteers Joined',
    description:
      'A successful river cleanup operation in Cotta removed over 2.4 metric tons of solid waste from the riverbanks. Thank you to all 120 volunteers who participated.',
    date: '2026-05-10',
    barangay: 'Cotta',
    priority: 'low',
  },
  {
    id: 9,
    type: 'announcement',
    category: 'Advisories',
    title: 'Electronic Waste Drop-Off Points Now Available',
    description:
      'E-waste collection points are now available at all barangay halls. Items accepted: batteries, mobile phones, chargers, fluorescent bulbs. Drop off Monday–Friday, 8AM–5PM.',
    date: '2026-05-09',
    barangay: 'City-Wide',
    priority: 'low',
  },
  {
    id: 10,
    type: 'news',
    category: 'News',
    title: 'WasteWatch App Reaches 1,000 Registered Users',
    description:
      'The WasteWatch community platform has reached a milestone of 1,000 registered residents. The system has processed over 4,700 waste reports since launch.',
    date: '2026-05-08',
    barangay: 'City-Wide',
    priority: 'low',
  },
]

// ─── Barangay Spotlights ──────────────────────────────────────────────────────
export const BARANGAY_SPOTLIGHTS = [
  {
    id: 'sp1',
    barangay: 'Gulang-Gulang',
    achievement: 'Cleanest Barangay of the Month',
    description: 'Achieved a record 98% waste compliance ratio for May 2026, driven by consistent resident participation and zero missed collections.',
    score: 98,
    improvement: '+4%',
    trend: 'up',
    icon: 'award',
  },
  {
    id: 'sp2',
    barangay: 'Cotta',
    achievement: 'Most Improved Barangay',
    description: 'Improved from 71% to 84% compliance in 30 days following the successful adoption of the segregation-at-source program.',
    score: 84,
    improvement: '+13%',
    trend: 'up',
    icon: 'trending-up',
  },
  {
    id: 'sp3',
    barangay: 'Isabang',
    achievement: 'Community Cleanup Champion',
    description: '3 successful community cleanup drives this month, mobilizing over 200 volunteers and collecting 3.2 metric tons of solid waste.',
    score: 87,
    improvement: '+6%',
    trend: 'up',
    icon: 'users',
  },
]

// ─── Category list ────────────────────────────────────────────────────────────
export const CATEGORIES = [
  'All',
  'Announcements',
  'News',
  'Cleanup Drives',
  'Rankings',
  'Advisories',
  'Emergencies',
]
