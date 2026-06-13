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

// baseURL is intentionally empty — all requests go through the Vite dev proxy
// (see vite.config.js). This avoids CORS entirely: the browser only ever talks
// to localhost:3000, and Vite forwards /api/* to Django at localhost:8000.
const api = axios.create({
  baseURL: '',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'ngrok-skip-browser-warning': 'true',
  },
})

api.interceptors.request.use((config) => {
  const csrfToken = getCsrfToken()
  if (csrfToken && ['post', 'put', 'patch', 'delete'].includes(config.method)) {
    config.headers['X-CSRFToken'] = csrfToken
  }
  return config
})

// ← NO response interceptor at all — let each page handle errors itself

export default api