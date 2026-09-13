export function getApiErrorMessage(error, fallback = 'Oops! Something went wrong. Please try again.') {
  const data = error?.response?.data

  if (typeof data === 'string' && data.trim()) return data.trim()
  if (Array.isArray(data) && data.length) {
    return data.map(v => (typeof v === 'string' ? v : JSON.stringify(v))).join('\n')
  }

  if (data && typeof data === 'object') {
    const parts = []
    for (const [key, value] of Object.entries(data)) {
      const extracted = Array.isArray(value) ? value[0] : value
      if (extracted == null || extracted === '') continue
      if (key === 'detail' && typeof extracted === 'string') return extracted
      parts.push(typeof extracted === 'object' ? JSON.stringify(extracted) : `${key}: ${extracted}`)
    }
    if (parts.length) return parts.join('\n')
  }

  if (error?.response?.status === 400) return fallback
  return error?.message || fallback
}
