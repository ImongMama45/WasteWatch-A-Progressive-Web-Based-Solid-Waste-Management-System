import { useState, useEffect } from 'react'
import { getQueue } from '../hooks/useOfflineQueue'

export default function OfflineQueueBadge() {
  const [pendingCount, setPendingCount] = useState(0)

  useEffect(() => {
    const queue = getQueue('inspection_submissions')
    let interval

    async function check() {
      const all = await queue.getAll()
      setPendingCount(all.filter(r => r.status === 'pending').length)
    }

    check()
    interval = setInterval(check, 15_000)
    return () => clearInterval(interval)
  }, [])

  if (pendingCount === 0) return null

  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      background: 'rgba(245,158,11,0.12)',
      border: '1px solid rgba(245,158,11,0.35)',
      borderRadius: 20, padding: '4px 10px',
      fontSize: 11, fontWeight: 700, color: '#d97706',
    }}>
      <span style={{
        width: 7, height: 7, borderRadius: '50%',
        background: '#f59e0b', flexShrink: 0,
        animation: 'pulse 2s infinite',
      }} />
      {pendingCount} inspection{pendingCount !== 1 ? 's' : ''} pending sync
    </div>
  )
}
