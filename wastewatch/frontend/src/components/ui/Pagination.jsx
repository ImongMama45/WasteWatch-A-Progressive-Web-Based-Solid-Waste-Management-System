import React from 'react'
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight
} from 'lucide-react'

/**
 * Standard WasteWatch Pagination Component
 * Displays standard ratio indicator "10/900" and page controls.
 * Maximum page size: 10 items.
 */
export default function Pagination({
  currentPage = 1,
  totalPages = 1,
  totalCount = 0,
  pageSize = 10,
  onPageChange,
  loading = false,
  className = '',
  style = {}
}) {
  if (totalCount === 0 && totalPages <= 1) {
    return null
  }

  const validCurrentPage = Math.max(1, Math.min(currentPage, Math.max(1, totalPages)))
  const startItem = totalCount === 0 ? 0 : (validCurrentPage - 1) * pageSize + 1
  const endItem = Math.min(validCurrentPage * pageSize, totalCount)
  const currentBatchCount = Math.max(0, endItem - startItem + 1)

  // Generate page numbers with ellipses
  const getPageNumbers = () => {
    const pages = []
    const maxVisible = 5

    if (totalPages <= maxVisible + 2) {
      for (let i = 1; i <= totalPages; i++) pages.push(i)
    } else {
      pages.push(1)
      let left = Math.max(2, validCurrentPage - 1)
      let right = Math.min(totalPages - 1, validCurrentPage + 1)

      if (validCurrentPage <= 3) {
        right = 4
      } else if (validCurrentPage >= totalPages - 2) {
        left = totalPages - 3
      }

      if (left > 2) pages.push('ellipsis-left')
      for (let i = left; i <= right; i++) pages.push(i)
      if (right < totalPages - 1) pages.push('ellipsis-right')

      pages.push(totalPages)
    }
    return pages
  }

  const handlePage = (page) => {
    if (loading || page < 1 || page > totalPages || page === validCurrentPage) return
    if (onPageChange) onPageChange(page)
  }

  return (
    <div
      className={`ww-pagination-bar ${className}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '12px',
        padding: '14px 18px',
        background: 'var(--surface, #ffffff)',
        border: '1px solid var(--border, #e2e8f0)',
        borderRadius: '12px',
        marginTop: '16px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
        ...style
      }}
    >
      {/* Ratio Indicator: Showing 1–10 of 900 (10/900) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontSize: '12px',
          color: 'var(--text-muted, #64748b)',
          fontWeight: 500
        }}
      >
        <span>
          Showing <strong style={{ color: 'var(--text, #0f172a)' }}>{startItem}–{endItem}</strong> of{' '}
          <strong style={{ color: 'var(--text, #0f172a)' }}>{totalCount}</strong>
        </span>
        <span
          className="ww-pagination-ratio"
          style={{
            background: 'var(--surface-2, #f1f5f9)',
            border: '1px solid var(--border, #cbd5e1)',
            color: 'var(--accent, #10b981)',
            padding: '2px 8px',
            borderRadius: '999px',
            fontSize: '11px',
            fontWeight: 800,
            letterSpacing: '0.03em'
          }}
          title="Displayed items / Total dataset items"
        >
          {currentBatchCount}/{totalCount}
        </span>
      </div>

      {/* Navigation Controls */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px'
        }}
      >
        {/* First Page */}
        <button
          type="button"
          onClick={() => handlePage(1)}
          disabled={loading || validCurrentPage <= 1}
          title="First page"
          style={{
            width: '32px',
            height: '32px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '8px',
            border: '1px solid var(--border, #e2e8f0)',
            background: 'var(--surface, #ffffff)',
            color: validCurrentPage <= 1 ? 'var(--text-muted, #94a3b8)' : 'var(--text, #0f172a)',
            cursor: validCurrentPage <= 1 || loading ? 'not-allowed' : 'pointer',
            opacity: validCurrentPage <= 1 ? 0.45 : 1,
            transition: 'all 0.15s ease'
          }}
        >
          <ChevronsLeft size={16} />
        </button>

        {/* Previous Page */}
        <button
          type="button"
          onClick={() => handlePage(validCurrentPage - 1)}
          disabled={loading || validCurrentPage <= 1}
          title="Previous page"
          style={{
            width: '32px',
            height: '32px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '8px',
            border: '1px solid var(--border, #e2e8f0)',
            background: 'var(--surface, #ffffff)',
            color: validCurrentPage <= 1 ? 'var(--text-muted, #94a3b8)' : 'var(--text, #0f172a)',
            cursor: validCurrentPage <= 1 || loading ? 'not-allowed' : 'pointer',
            opacity: validCurrentPage <= 1 ? 0.45 : 1,
            transition: 'all 0.15s ease'
          }}
        >
          <ChevronLeft size={16} />
        </button>

        {/* Page numbers */}
        {getPageNumbers().map((p, idx) => {
          if (typeof p === 'string') {
            return (
              <span
                key={`ellipsis-${idx}`}
                style={{
                  width: '28px',
                  textAlign: 'center',
                  color: 'var(--text-muted, #94a3b8)',
                  fontSize: '12px',
                  userSelect: 'none'
                }}
              >
                &hellip;
              </span>
            )
          }

          const isActive = p === validCurrentPage
          return (
            <button
              key={`page-${p}`}
              type="button"
              onClick={() => handlePage(p)}
              disabled={loading}
              style={{
                minWidth: '32px',
                height: '32px',
                padding: '0 6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '8px',
                border: isActive
                  ? '1px solid var(--accent, #10b981)'
                  : '1px solid var(--border, #e2e8f0)',
                background: isActive
                  ? 'var(--accent, #10b981)'
                  : 'var(--surface, #ffffff)',
                color: isActive ? '#ffffff' : 'var(--text, #0f172a)',
                fontSize: '12px',
                fontWeight: isActive ? 700 : 500,
                cursor: loading ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              {p}
            </button>
          )
        })}

        {/* Next Page */}
        <button
          type="button"
          onClick={() => handlePage(validCurrentPage + 1)}
          disabled={loading || validCurrentPage >= totalPages}
          title="Next page"
          style={{
            width: '32px',
            height: '32px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '8px',
            border: '1px solid var(--border, #e2e8f0)',
            background: 'var(--surface, #ffffff)',
            color: validCurrentPage >= totalPages ? 'var(--text-muted, #94a3b8)' : 'var(--text, #0f172a)',
            cursor: validCurrentPage >= totalPages || loading ? 'not-allowed' : 'pointer',
            opacity: validCurrentPage >= totalPages ? 0.45 : 1,
            transition: 'all 0.15s ease'
          }}
        >
          <ChevronRight size={16} />
        </button>

        {/* Last Page */}
        <button
          type="button"
          onClick={() => handlePage(totalPages)}
          disabled={loading || validCurrentPage >= totalPages}
          title="Last page"
          style={{
            width: '32px',
            height: '32px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '8px',
            border: '1px solid var(--border, #e2e8f0)',
            background: 'var(--surface, #ffffff)',
            color: validCurrentPage >= totalPages ? 'var(--text-muted, #94a3b8)' : 'var(--text, #0f172a)',
            cursor: validCurrentPage >= totalPages || loading ? 'not-allowed' : 'pointer',
            opacity: validCurrentPage >= totalPages ? 0.45 : 1,
            transition: 'all 0.15s ease'
          }}
        >
          <ChevronsRight size={16} />
        </button>
      </div>
    </div>
  )
}
