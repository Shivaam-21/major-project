const API_BASE = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000/api/v1'

// The backend authenticates the live feed with the same JWT the REST API
// uses, passed as a query parameter because browsers cannot set headers on
// WebSocket connections.
export const getLiveFeedUrl = () => {
  const token = localStorage.getItem('token')
  if (!token) return null
  const wsBase = API_BASE.replace(/^http/, 'ws')
  return `${wsBase}/ws/live?token=${encodeURIComponent(token)}`
}
