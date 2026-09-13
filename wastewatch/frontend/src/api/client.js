import axios from 'axios'

function getCsrfToken() {
  const name = 'csrftoken'
  const cookies = document.cookie.split(';')
  for (let cookie of cookies) {
    const [key, value] = cookie.trim().split('=')
    if (key === name) return decodeURIComponent(value)
  }
  return null
}

// baseURL is intentionally empty in dev — all requests go through the Vite dev proxy
// In production (Vercel), it uses VITE_API_URL to point to the Render backend.
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
  withCredentials: true,
  headers: {
    'Accept': 'application/json',
    'ngrok-skip-browser-warning': 'true',
  },
})

api.interceptors.request.use((config) => {
  // Append timestamp to all GET requests to prevent aggressive browser caching
  if (config.method === 'get') {
    config.params = config.params || {}
    config.params._t = Date.now()
  }

  const csrfToken = getCsrfToken()
  if (csrfToken && ['post', 'put', 'patch', 'delete'].includes(config.method)) {
    config.headers['X-CSRFToken'] = csrfToken
  }
  return config
})

// ← NO response interceptor at all — let each page handle errors itself

export default api