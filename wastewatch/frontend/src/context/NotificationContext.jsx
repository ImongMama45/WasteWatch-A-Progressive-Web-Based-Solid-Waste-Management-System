import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const NotificationContext = createContext(null)

const DEFAULT_DURATION = 45000
const EXIT_MS = 220
const MAX_VISIBLE = 3

function iconForVariant(variant) {
  switch (variant) {
    case 'success':
      return 'check_circle'
    case 'error-soft':
      return 'warning'
    case 'error-dark':
      return 'error'
    default:
      return null
  }
}

function getVariantStyles(variant) {
  switch (variant) {
    case 'success':
      return {
        container: {
          background: '#f4fff7',
          borderLeft: '4px solid #22c55e',
          border: '1px solid rgba(34,197,94,0.18)',
          color: '#10311f',
        },
        iconWrap: {
          background: 'rgba(34,197,94,0.12)',
          color: '#16a34a',
        },
        buttonColor: '#10311f',
      }
    case 'error-soft':
      return {
        container: {
          background: '#ffffff',
          borderLeft: '4px solid #ef4444',
          border: '1px solid rgba(239,68,68,0.16)',
          color: '#1f2937',
        },
        iconWrap: {
          background: 'rgba(239,68,68,0.12)',
          color: '#dc2626',
        },
        buttonColor: '#1f2937',
      }
    case 'error-solid':
      return {
        container: {
          background: '#fc5c5c',
          border: '1px solid rgba(255,255,255,0.14)',
          color: '#fff',
        },
        iconWrap: null,
        buttonColor: '#fff',
      }
    case 'error-outline':
      return {
        container: {
          background: '#ffffff',
          border: '1px solid rgba(17,24,39,0.22)',
          color: '#111827',
        },
        iconWrap: null,
        buttonColor: '#111827',
      }
    case 'error-dark':
    default:
      return {
        container: {
          background: '#0f172a',
          border: '1px solid rgba(255,255,255,0.08)',
          color: '#fff',
        },
        iconWrap: {
          background: 'rgba(255,255,255,0.1)',
          color: '#fff',
        },
        buttonColor: '#fff',
      }
  }
}

function NotificationItem({ item, onDismiss }) {
  const styles = getVariantStyles(item.variant)
  const iconName = item.icon ?? iconForVariant(item.variant)
  const showIcon = item.variant !== 'error-solid' && iconName

  return (
    <div
      className={`ww-notification ww-notification--${item.variant}${item.exiting ? ' ww-notification--exit' : ''}`}
      style={styles.container}
      role="status"
      aria-live={item.variant === 'error-dark' || item.variant === 'error-solid' ? 'assertive' : 'polite'}
    >
      <div className="ww-notification__content">
        {showIcon && (
          <div className="ww-notification__icon" style={styles.iconWrap || undefined}>
            <span className="msi" style={{ fontSize: 18 }}>{iconName}</span>
          </div>
        )}
        <div className="ww-notification__text">
          <div
            className="ww-notification__message"
            style={{
              fontFamily: 'var(--font-body)',
              fontSize: 13.5,
              fontWeight: item.variant === 'error-solid' || item.variant === 'error-dark' ? 800 : 600,
              lineHeight: 1.45,
              color: item.variant === 'error-solid' || item.variant === 'error-dark' ? '#fff' : styles.container.color,
            }}
          >
            {item.message}
          </div>
        </div>
      </div>
      {item.variant === 'error-outline' ? (
        <button
          type="button"
          className="ww-notification__close"
          onClick={() => onDismiss(item.id)}
          aria-label="Dismiss notification"
          style={{ color: styles.buttonColor }}
        >
          ×
        </button>
      ) : (
        <button
          type="button"
          className="ww-notification__close ww-notification__close--ghost"
          onClick={() => onDismiss(item.id)}
          aria-label="Dismiss notification"
          style={{ color: styles.buttonColor }}
        >
          ×
        </button>
      )}
    </div>
  )
}

function NotificationHost({ items, position, onDismiss }) {
  if (typeof document === 'undefined') return null

  const containerStyle = position === 'top-center'
    ? {
        top: 'calc(12px + env(safe-area-inset-top, 0px))',
        left: '50%',
        transform: 'translateX(-50%)',
      }
    : {
        top: 'calc(12px + env(safe-area-inset-top, 0px))',
        right: 'calc(12px + env(safe-area-inset-right, 0px))',
      }

  return createPortal(
    <>
      <style>{`
        .ww-notification-host {
          position: fixed;
          z-index: 20000;
          display: flex;
          flex-direction: column;
          gap: 10px;
          width: min(100vw - 24px, 390px);
          pointer-events: none;
        }
        .ww-notification-host--top-center {
          align-items: center;
        }
        .ww-notification {
          pointer-events: auto;
          position: relative;
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          padding: 12px 12px 12px 14px;
          border-radius: 14px;
          box-shadow: 0 10px 24px rgba(15, 23, 42, 0.18), 0 2px 8px rgba(15, 23, 42, 0.08);
          overflow: hidden;
          animation: wwNotifyIn .22s ease both;
          max-width: 100%;
          backdrop-filter: blur(8px);
        }
        .ww-notification--exit {
          animation: wwNotifyOut .2s ease both;
        }
        .ww-notification__content {
          display: flex;
          gap: 10px;
          align-items: flex-start;
          min-width: 0;
          flex: 1;
        }
        .ww-notification__icon {
          width: 28px;
          height: 28px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 999px;
        }
        .ww-notification__text {
          min-width: 0;
          flex: 1;
        }
        .ww-notification__close {
          appearance: none;
          border: 0;
          background: transparent;
          width: 24px;
          height: 24px;
          border-radius: 999px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          cursor: pointer;
          font-size: 20px;
          line-height: 1;
          font-weight: 700;
          padding: 0;
        }
        .ww-notification__close:hover {
          background: rgba(0, 0, 0, 0.06);
        }
        .ww-notification__close--ghost:hover {
          background: rgba(255, 255, 255, 0.08);
        }
        @keyframes wwNotifyIn {
          from { opacity: 0; transform: translateY(-10px) scale(0.985); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes wwNotifyOut {
          from { opacity: 1; transform: translateY(0) scale(1); }
          to { opacity: 0; transform: translateY(-8px) scale(0.985); }
        }
        @media (max-width: 640px) {
          .ww-notification-host {
            width: calc(100vw - 16px);
          }
        }
      `}</style>
      <div
        className={`ww-notification-host ww-notification-host--${position}`}
        style={containerStyle}
      >
        {items.map(item => (
          <NotificationItem key={item.id} item={item} onDismiss={onDismiss} />
        ))}
      </div>
    </>,
    document.body
  )
}

export function NotificationProvider({ children, position = 'top-right', maxVisible = MAX_VISIBLE }) {
  const [items, setItems] = useState([])
  const timersRef = useRef(new Map())

  const removeItem = useCallback((id) => {
    const timer = timersRef.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timersRef.current.delete(id)
    }
    setItems(prev => prev.filter(item => item.id !== id))
  }, [])

  const dismiss = useCallback((id) => {
    setItems(prev => prev.map(item => item.id === id ? { ...item, exiting: true } : item))
    const timer = setTimeout(() => removeItem(id), EXIT_MS)
    timersRef.current.set(id, timer)
  }, [removeItem])

  const notify = useCallback((input) => {
    const payload = typeof input === 'string' ? { message: input } : (input || {})
    const variant = payload.variant || 'error-soft'
    const id = payload.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`
    const duration = payload.duration ?? (variant === 'error-outline' ? null : DEFAULT_DURATION)
    const item = {
      id,
      variant,
      message: payload.message || '',
      duration,
      icon: payload.icon || null,
      exiting: false,
    }

    setItems(prev => [item, ...prev].slice(0, maxVisible))
    if (duration != null) {
      const timer = setTimeout(() => dismiss(id), duration)
      timersRef.current.set(id, timer)
    }
    return id
  }, [dismiss, maxVisible])

  useEffect(() => {
    return () => {
      timersRef.current.forEach(timer => clearTimeout(timer))
      timersRef.current.clear()
    }
  }, [])

  const value = useMemo(() => ({ notify, dismiss }), [notify, dismiss])

  return (
    <NotificationContext.Provider value={value}>
      {children}
      <NotificationHost items={items} position={position} onDismiss={dismiss} />
    </NotificationContext.Provider>
  )
}

export function useNotification() {
  const ctx = useContext(NotificationContext)
  if (!ctx) {
    throw new Error('useNotification must be used inside <NotificationProvider>')
  }
  return ctx
}
