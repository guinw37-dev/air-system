import axios from 'axios'
import { useAuthStore } from '../store/auth'
import { useTenantStore } from '../store/tenant'

// VITE_BACKEND_URL = https://your-backend.example.com (no trailing slash)
// In dev: proxied via vite.config.js → localhost:3001
const BACKEND = import.meta.env.VITE_BACKEND_URL || ''

export const uploadsBase = BACKEND // photo URLs: `${uploadsBase}/uploads/photos/...`

const api = axios.create({
  baseURL: BACKEND ? `${BACKEND}/api` : '/api',
})

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token
  if (token) config.headers.Authorization = `Bearer ${token}`
  // On a branch subdomain, scope every request to that client automatically:
  // client_id param (primary) + X-Branch header (backend enforcement, since the
  // backend host is a separate origin and can't see the branch subdomain).
  const { isBranch, clientId, slug } = useTenantStore.getState()
  if (isBranch && clientId) {
    // Branch wins — override any page-supplied client_id.
    config.params = { ...(config.params || {}), client_id: clientId }
    if (slug) config.headers['X-Branch'] = slug
  }
  return config
})

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      useAuthStore.getState().logout()
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export default api
