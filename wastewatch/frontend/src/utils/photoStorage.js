/**
 * Convert a File or Blob to a base64 data URL string.
 * Safe to store in IndexedDB across browser restarts.
 */
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = () => resolve(reader.result)  // "data:image/jpeg;base64,..."
    reader.onerror = () => reject(new Error('Failed to convert photo to base64'))
    reader.readAsDataURL(blob)
  })
}

/**
 * Convert a base64 data URL back to a Blob for FormData appending.
 */
export function base64ToBlob(dataUrl, mimeType = 'image/jpeg') {
  const [, base64] = dataUrl.split(',')
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
  return new Blob([bytes], { type: mimeType })
}

const MAX_OFFLINE_PHOTOS_MB = 20

export async function estimateQueueStorageMB(queue) {
  const all = await queue.getAll()
  const bytes = all
    .filter(r => r.status === 'pending')
    .flatMap(r => r.photos || [])
    .reduce((sum, p) => sum + (typeof p === 'string' ? p.length * 0.75 : p.size || 0), 0)
  return bytes / (1024 * 1024)
}

export function isNearStorageLimit(mb) {
  return mb > MAX_OFFLINE_PHOTOS_MB * 0.8
}
