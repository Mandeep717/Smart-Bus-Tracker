const BASE = import.meta.env.VITE_API_URL || '/api'

export async function api(path, options = {}) {
  const token = localStorage.getItem('smartbus.token')
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.message || 'Something went wrong. Please try again.')
  return result.data
}

export const post = (path, data) => api(path, { method: 'POST', body: JSON.stringify(data) })
export const put = (path, data) => api(path, { method: 'PUT', body: JSON.stringify(data) })
export const remove = (path) => api(path, { method: 'DELETE' })
