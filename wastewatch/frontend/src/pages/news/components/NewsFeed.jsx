/**
 * NewsFeed.jsx
 * -------------
 * Filtered, searchable vertical list of NewsCard items.
 */

import { FileSearch } from 'lucide-react'
import NewsCard from './NewsCard'
import { NEWS_ITEMS } from '../data/newsData'

export default function NewsFeed({ items = NEWS_ITEMS, category = 'All', search = '' }) {
  // Filter
  const filtered = items.filter(item => {
    const matchCat    = category === 'All' || item.category === category
    const q           = search.toLowerCase()
    const matchSearch = !q || item.title.toLowerCase().includes(q) || item.description.toLowerCase().includes(q) || (item.barangay || '').toLowerCase().includes(q)
    return matchCat && matchSearch
  })

  // Sort: pinned first, then by date desc
  const sorted = [...filtered].sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1
    if (!a.isPinned && b.isPinned) return 1
    return new Date(b.date) - new Date(a.date)
  })

  if (!sorted.length) {
    return (
      <div style={{
        padding: '40px 20px', textAlign: 'center',
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
      }}>
        <FileSearch size={32} strokeWidth={1.5} style={{ color: 'var(--text-muted)', display: 'block', margin: '0 auto 10px' }} />
        <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)', marginBottom: 4 }}>No items found</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {search ? `No results for "${search}" in "${category}"` : `No ${category} posts yet.`}
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {sorted.map((item, i) => (
        <NewsCard
          key={item.id}
          item={item}
          animDelay={i * 30}
        />
      ))}
    </div>
  )
}
