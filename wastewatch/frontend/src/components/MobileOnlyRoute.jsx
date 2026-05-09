import { Navigate } from 'react-router-dom'

function isMobile() {
  const ua = navigator.userAgent

  return (
    /Android|iPhone|iPad|iPod|Mobile/i.test(ua) ||
    navigator.maxTouchPoints > 1
  )
}

export default function MobileOnlyRoute({ children }) {
  if (!isMobile()) {
    return <Navigate to="/dashboard" replace />
  }

  return children
}