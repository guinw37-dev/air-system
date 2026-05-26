import axios from 'axios'
import { useAuthStore } from '../store/auth'

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
