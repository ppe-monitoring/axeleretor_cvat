// В dev ходим через прокси Vite (см. vite.config.js), в проде — VITE_API_URL.
const BASE = import.meta.env.VITE_API_URL ?? ''

const USE_MOCK = import.meta.env.VITE_USE_MOCK === '1'

export class ApiError extends Error {
  constructor(status, body) {
    super(`API ${status}`)
    this.status = status
    this.body = body
  }
}

/** Сырой ответ DRF. Для списков это { count, next, previous, results }. */
export async function apiGet(path, params = {}) {
  if (USE_MOCK) return (await import('./mockApi')).mockGet(path, params)
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  )
  const res = await fetch(`${BASE}${path}${qs.size ? `?${qs}` : ''}`, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new ApiError(res.status, await res.text().catch(() => ''))
  return res.json()
}

/** POST / PATCH / DELETE. DELETE отвечает 204 без тела. */
export async function apiSend(method, path, body) {
  if (USE_MOCK) return (await import('./mockApi')).mockSend(method, path, body)
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new ApiError(res.status, await res.text().catch(() => ''))
  return res.status === 204 ? null : res.json()
}
export const apiPatch = (path, body) => apiSend('PATCH', path, body)

/** Ошибка DRF { поле: ['текст'] } → { fields, message } для показа в форме. */
export function parseApiError(err) {
  if (!(err instanceof ApiError)) return { fields: {}, message: 'Нет связи с сервером' }
  try {
    const body = JSON.parse(err.body)
    if (body && typeof body === 'object') {
      const fields = {}
      const general = []
      for (const [k, v] of Object.entries(body)) {
        const text = [].concat(v).join(' ')
        if (k === 'detail' || k === 'non_field_errors') general.push(text)
        else fields[k] = text
      }
      return { fields, message: general.join(' ') || (Object.keys(fields).length ? 'Проверьте поля формы' : `Ошибка ${err.status}`) }
    }
  } catch { /* тело не JSON */ }
  return { fields: {}, message: `Ошибка сервера (${err.status})` }
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
  // CRUD камер, зон и правил СИЗ (ModelViewSet на бэкенде)
  saveCamera: (id, data) => (id ? apiSend('PATCH', `/api/cameras/${id}/`, data) : apiSend('POST', '/api/cameras/', data)),
  deleteCamera: (id) => apiSend('DELETE', `/api/cameras/${id}/`),
  saveZone: (id, data) => (id ? apiSend('PATCH', `/api/zones/${id}/`, data) : apiSend('POST', '/api/zones/', data)),
  deleteZone: (id) => apiSend('DELETE', `/api/zones/${id}/`),
  // включить СИЗ: правило есть → PATCH is_active, нет → POST. Выключить: PATCH is_active=false
  setZoneRule: ({ zone, code, enabled, rule }) =>
    rule ? apiSend('PATCH', `/api/ppe-rules/${rule.id}/`, { is_active: enabled })
         : apiSend('POST', '/api/ppe-rules/', { zone, code, is_active: true }),
  setViolationStatus: (id, status) => apiPatch(`/api/violations/${id}/`, { status }),
}
// // В dev ходим через прокси Vite (см. vite.config.js), в проде — VITE_API_URL.
// const BASE = import.meta.env.VITE_API_URL ?? ''

// export class ApiError extends Error {
//   constructor(status, body) {
//     super(`API ${status}`)
//     this.status = status
//     this.body = body
//   }
// }

// /** Сырой ответ DRF. Для списков это { count, next, previous, results }. */
// export async function apiGet(path, params = {}) {
//   const qs = new URLSearchParams(
//     Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''),
//   )
//   const res = await fetch(`${BASE}${path}${qs.size ? `?${qs}` : ''}`, {
//     headers: { Accept: 'application/json' },
//   })
//   if (!res.ok) throw new ApiError(res.status, await res.text().catch(() => ''))
//   return res.json()
// }

// export async function apiPatch(path, body) {
//   const res = await fetch(`${BASE}${path}`, {
//     method: 'PATCH',
//     headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
//     body: JSON.stringify(body),
//   })
//   if (!res.ok) throw new ApiError(res.status, await res.text().catch(() => ''))
//   return res.json()
// }

// /** Все страницы списка (PAGE_SIZE на бэке = 50). Для небольших справочников: камеры, зоны. */
// export async function fetchAll(path, params = {}, maxPages = 20) {
//   const items = []
//   for (let page = 1; page <= maxPages; page++) {
//     const data = await apiGet(path, { ...params, page })
//     if (Array.isArray(data)) return data
//     items.push(...data.results)
//     if (!data.next) break
//   }
//   return items
// }

// export const api = {
//   cameras: () => fetchAll('/api/cameras/'),
//   zones: () => fetchAll('/api/zones/'),
//   // одна страница: { count, next, previous, results }
//   violations: (params) => apiGet('/api/violations/', params),
//   summaries: (camera) => apiGet('/api/summaries/', { camera }),
//   // все сводки с даты (ISO) — для KPI и графика
//   summariesSince: (date_from) => fetchAll('/api/summaries/', { date_from }, 40),
//   // нужен только count: берём первую страницу
//   violationsCount: async (params) => (await apiGet('/api/violations/', { ...params, page: 1 })).count,
//   // PATCH /api/violations/{id}/  { status: 'new' | 'confirmed' | 'false_positive' }
//   setViolationStatus: (id, status) => apiPatch(`/api/violations/${id}/`, { status }),
// }