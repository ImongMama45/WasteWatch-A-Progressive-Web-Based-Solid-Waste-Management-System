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
      if (key === 'non_field_errors') {
        parts.push(typeof extracted === 'object' ? JSON.stringify(extracted) : extracted)
      } else {
        const formattedKey = key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ')
        parts.push(typeof extracted === 'object' ? JSON.stringify(extracted) : `${formattedKey}: ${extracted}`)
      }
    }
    if (parts.length) return parts.join('\n')
  }

  if (error?.response?.status === 400) return fallback
  return error?.message || fallback
}
