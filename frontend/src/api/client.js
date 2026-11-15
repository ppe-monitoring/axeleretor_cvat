// В dev ходим через прокси Vite (см. vite.config.js), в проде — VITE_API_URL.
const BASE = import.meta.env.VITE_API_URL ?? ''

export class ApiError extends Error {
  constructor(status, body) {
    super(`API ${status}`)
    this.status = status
    this.body = body
  }
}

/** Сырой ответ DRF. Для списков это { count, next, previous, results }. */
export async function apiGet(path, params = {}) {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  )
  const res = await fetch(`${BASE}${path}${qs.size ? `?${qs}` : ''}`, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new ApiError(res.status, await res.text().catch(() => ''))
  return res.json()
}

export async function apiPatch(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new ApiError(res.status, await res.text().catch(() => ''))
  return res.json()
}

/** Все страницы списка (PAGE_SIZE на бэке = 50). Для небольших справочников: камеры, зоны. */
export async function fetchAll(path, params = {}, maxPages = 20) {
  const items = []
  for (let page = 1; page <= maxPages; page++) {
    const data = await apiGet(path, { ...params, page })
    if (Array.isArray(data)) return data
    items.push(...data.results)
    if (!data.next) break
  }
  return items
}

export const api = {
  cameras: () => fetchAll('/api/cameras/'),
  zones: () => fetchAll('/api/zones/'),
  // одна страница: { count, next, previous, results }
  violations: (params) => apiGet('/api/violations/', params),
  summaries: (camera) => apiGet('/api/summaries/', { camera }),
  // все сводки с даты (ISO) — для KPI и графика
  summariesSince: (date_from) => fetchAll('/api/summaries/', { date_from }, 40),
  // нужен только count: берём первую страницу
  violationsCount: async (params) => (await apiGet('/api/violations/', { ...params, page: 1 })).count,
  // PATCH /api/violations/{id}/  { status: 'new' | 'confirmed' | 'false_positive' }
  setViolationStatus: (id, status) => apiPatch(`/api/violations/${id}/`, { status }),
}
