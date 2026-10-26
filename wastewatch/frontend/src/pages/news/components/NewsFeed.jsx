/**
 * NewsFeed.jsx
 * -------------
 * Filtered, searchable vertical list of NewsCard items.
 * Uses shared filterNews and sortNews utils to prevent runtime crashes.
 * Zero emojis.
 */

import { FileSearch } from 'lucide-react'
import NewsCard from './NewsCard'
import { filterNews, sortNews } from '../utils/newsUtils'

export default function NewsFeed({ items = [], category = 'All', search = '', onReadMore }) {
  const filtered = filterNews(items, category, search)
  const sorted = sortNews(filtered)

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
          onReadMore={onReadMore}
        />
      ))}
    </div>
  )
}
