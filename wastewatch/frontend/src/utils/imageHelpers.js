/**
 * utils/imageHelpers.js
 * ---------------------
 * Robust resolver and validator for photo evidence across WasteWatch.
 * Handles:
 *  - Full HTTPS/HTTP URLs (Cloudinary, S3, external)
 *  - Protocol-relative URLs ("//res.cloudinary.com/...")
 *  - Cloudinary relative paths ("image/upload/v.../xxx.jpg")
 *  - Raw Cloudinary public IDs ("reports/...", "ka9ssgxos29a8q4os9dd")
 *  - Local backend media paths ("/media/...")
 *  - Base64 data URLs ("data:image/...")
 */

const CLOUDINARY_CLOUD_NAME = 'dr5ba1lmn'

export function resolveImageUrl(url) {
  if (!url || typeof url !== 'string') return null
  const clean = url.trim()
  if (!clean || clean === 'null' || clean === 'undefined') return null

  // Data URLs (base64)
  if (clean.startsWith('data:')) {
    return clean
  }

  // Already a full HTTPS/HTTP URL
  if (clean.startsWith('https://')) {
    return clean
  }
  if (clean.startsWith('http://')) {
    // Upgrade insecure Cloudinary or same-site HTTP
    if (clean.includes('res.cloudinary.com')) {
      return clean.replace('http://', 'https://')
    }
    return clean
  }

  // Protocol relative
  if (clean.startsWith('//')) {
    return `https:${clean}`
  }

  // Relative Cloudinary upload path (e.g., "image/upload/v179.../abc.jpg")
  if (clean.startsWith('image/upload/')) {
    return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/${clean}`
  }

  // Local media uploads (proxied to Django backend)
  if (clean.startsWith('/media/')) {
    return clean
  }

  // Raw Cloudinary public ID or nested folder (e.g. "reports/...", "fkxiuundulqp7frp7fbf")
  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/${clean}`
}

/**
 * Extracts and resolves all valid photos from a report object.
 * Checks `images` array as well as legacy `image`, `image_2`, `image_3`, `image_4`.
 */
export function getReportImages(report) {
  if (!report) return []
  const candidates = []

  if (Array.isArray(report.images) && report.images.length > 0) {
    for (const img of report.images) {
      if (img && !candidates.includes(img)) candidates.push(img)
    }
  }

  for (const key of ['image', 'image_2', 'image_3', 'image_4']) {
    const val = report[key]
    if (val && !candidates.includes(val)) {
      candidates.push(val)
    }
  }

  return candidates.map(resolveImageUrl).filter(Boolean)
}

