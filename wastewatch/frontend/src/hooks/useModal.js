/**
 * hooks/useModal.js
 * -----------------
 * Reusable modal hook providing:
 *  - Keyboard accessibility (Escape key to close)
 *  - Body scroll locking while open, safely restored on close or unmount
 */

import { useEffect, useRef } from 'react'

export function useModal(isOpen, onClose) {
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    if (!isOpen) return

    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        onCloseRef.current?.()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = prevOverflow
    }
  }, [isOpen])
}
