// Демо-режим: отдаёт данные в ТОЧНО таком же формате, как Django (пагинация, поля моделей),
// поэтому адаптеры, хуки и страницы работают без изменений. Включается VITE_USE_MOCK=1.

import { ApiError } from './client'

const delay = (ms) => new Promise((r) => setTimeout(r, ms))
const iso = (ms) => new Date(ms).toISOString()
const T0 = Date.now()
let seed = 7
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
const pick = (arr) => arr[Math.floor(rnd() * arr.length)]

const CODES = ['NO_HELMET', 'NO_VEST', 'NO_GLOVES']

// ── камеры, зоны, правила (изменяемое состояние для CRUD) ──────
const CAMERAS = [
  { id: 1, name: 'Камера 01', location: 'Склад Б', source_type: 'rtp', source_uri: 'rtsp://admin:secret@10.0.0.11:554/stream1', is_active: true, online: true },
  { id: 2, name: 'Камера 02', location: 'Погрузка', source_type: 'rtp', source_uri: 'rtsp://10.0.0.12:554/stream1', is_active: true, online: true },
  { id: 3, name: 'Камера 03', location: 'Цех 2', source_type: 'rtp', source_uri: 'rtsp://10.0.0.13:554/stream1', is_active: true, online: true },
  { id: 4, name: 'Камера 04', location: 'Вход', source_type: 'rtp', source_uri: 'rtsp://10.0.0.14:554/stream1', is_active: true, online: false }, // нет данных ML
]
let ZONES = CAMERAS.map((c) => ({ id: c.id, camera: c.id, name: `Зона ${c.id}`, is_active: true }))
// у зоны 4 нет правил — для демонстрации предупреждения
let RULES = ZONES.flatMap((z) => (z.id === 4 ? [] : CODES.map((code, i) => ({ id: z.id * 10 + i, zone: z.id, code, is_active: true }))))
let nextId = 100

const camOut = (c) => ({
  id: c.id, name: c.name, source_type: c.source_type, source_uri: c.source_uri, location: c.location,
  is_active: c.is_active, created_at: iso(T0 - 30 * 864e5),
  ml_last_seen: c.online ? iso(Date.now() - 30_000) : null,
  ml_online: c.online && c.is_active,
})
const camerasOut = () => CAMERAS.map(camOut)
const zonesOut = () => ZONES.map((z) => ({ ...z, rules: RULES.filter((r) => r.zone === z.id) }))

// ── нарушения: история + «идущие сейчас» ───────────────────────
const STATUS_ROLL = ['new', 'new', 'new', 'confirmed', 'confirmed', 'false_positive']
const history = Array.from({ length: 330 }, (_, i) => {
  const cam = 1 + Math.floor(rnd() * 4)
  const start = i < 70
    ? T0 - 600_000 - Math.floor(rnd() * 6 * 36e5)
    : T0 - 6 * 36e5 - Math.floor(rnd() * 29 * 864e5) // более старые — для графиков по дням и неделям
  const dur = 5_000 + Math.floor(rnd() * 120_000)
  const x1 = 100 + rnd() * 700, y1 = 60 + rnd() * 200
  return {
    id: i + 1, camera: cam, zone: cam, video: cam <= 2 ? 5 : null,
    employee: rnd() < 0.2 ? 1 + Math.floor(rnd() * 3) : null,
    code: pick(CODES), track_id: Math.floor(rnd() * 40), status: pick(STATUS_ROLL),
    model_version: i % 4 === 3 ? 'yolov8n-ppe-0.2' : 'yolov8n-ppe-0.3', frame_width: 1280, frame_height: 720,
    frame_number: 100 + i, last_frame_number: 100 + i + Math.round(dur / 200),
    timestamp: iso(start), ended_at: iso(start + dur), frames_count: Math.max(1, Math.round(dur / 200)),
    bbox_x1: x1, bbox_y1: y1, bbox_x2: x1 + 120 + rnd() * 60, bbox_y2: y1 + 300 + rnd() * 80,
    confidence: 0.6 + rnd() * 0.38, external_id: '', created_at: iso(start),
  }
})
const LIVE = [
  { id: 1001, camera: 1, code: 'NO_HELMET', track_id: 7, box: [185, 40, 410, 520] },
  { id: 1002, camera: 1, code: 'NO_VEST', track_id: 7, box: [185, 40, 410, 520] },
  { id: 1003, camera: 2, code: 'NO_VEST', track_id: 12, box: [520, 120, 700, 560] },
]
const statusOverride = {}
const liveOut = () =>
  LIVE.map((l) => ({
    id: l.id, camera: l.camera, zone: l.camera, video: null, employee: null, code: l.code,
    track_id: l.track_id, status: statusOverride[l.id] ?? 'new', model_version: 'yolov8n-ppe-0.3',
    frame_width: 1280, frame_height: 720, frame_number: 900, last_frame_number: 1000,
    timestamp: iso(Date.now() - 90_000), ended_at: iso(Date.now()), // ended_at «сейчас» → isActive
    frames_count: 450, bbox_x1: l.box[0], bbox_y1: l.box[1], bbox_x2: l.box[2], bbox_y2: l.box[3],
    confidence: 0.91, external_id: '', created_at: iso(Date.now() - 90_000),
  }))
const allViolations = () =>
  [...liveOut(), ...history.map((v) => ({ ...v, status: statusOverride[v.id] ?? v.status }))]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))

// ── сводки ML: раз в 10 минут с начала суток ───────────────────
const day0 = new Date(); day0.setHours(0, 0, 0, 0)
const SUMMARIES = []
for (const c of CAMERAS) {
  for (let t = day0.getTime() + 8 * 36e5; t < T0; t += 600_000) {
    const checked = 8 + Math.floor(rnd() * 13)
    SUMMARIES.push({
      id: SUMMARIES.length + 1, camera: c.id, zone: c.id, timestamp: iso(t),
      people_checked: checked, violators: Math.min(checked, Math.floor(rnd() * 4)), model_version: 'yolov8n-ppe-0.3',
    })
  }
}
SUMMARIES.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))

// ── пагинация как в DRF (PAGE_SIZE = 50) ───────────────────────
function paginate(list, params) {
  const page = Number(params.page ?? 1), size = 50
  return {
    count: list.length,
    next: page * size < list.length ? `?page=${page + 1}` : null,
    previous: page > 1 ? `?page=${page - 1}` : null,
    results: list.slice((page - 1) * size, page * size),
  }
}

export async function mockGet(path, p = {}) {
  await delay(250)
  if (path === '/api/cameras/') return paginate(camerasOut(), p)
  if (path === '/api/zones/') return paginate(zonesOut(), p)
  if (path === '/api/violations/') {
    let list = allViolations()
    for (const [param, field] of [['camera', 'camera'], ['zone', 'zone'], ['code', 'code'], ['status', 'status']]) {
      if (p[param]) list = list.filter((v) => String(v[field]) === String(p[param]))
    }
    if (p.date_from) list = list.filter((v) => new Date(v.timestamp) >= new Date(p.date_from))
    if (p.date_to) list = list.filter((v) => new Date(v.timestamp) <= new Date(p.date_to))
    return paginate(list, p)
  }
  if (path === '/api/summaries/') {
    let list = SUMMARIES
    if (p.camera) list = list.filter((s) => String(s.camera) === String(p.camera))
    if (p.date_from) list = list.filter((s) => new Date(s.timestamp) >= new Date(p.date_from))
    return paginate(list, p)
  }
  const mv = path.match(/^\/api\/videos\/(\d+)\/$/)
  if (mv) {
    return { id: Number(mv[1]), camera: 1, file: 'mock:demo', original_name: 'demo.mp4', size_bytes: 0,
             duration_sec: 120, fps: 25, frame_count: 3000, width: 1280, height: 720, uploaded_at: iso(T0 - 864e5) }
  }
  throw new Error(`mock: нет маршрута ${path}`)
}

const bad = (body) => new ApiError(400, JSON.stringify(body))
const notFound = () => new ApiError(404, JSON.stringify({ detail: 'Не найдено.' }))
const pickFields = (body, keys) => Object.fromEntries(keys.filter((k) => k in body).map((k) => [k, body[k]]))

/** Имитация POST / PATCH / DELETE для violations, cameras, zones, ppe-rules. */
export async function mockSend(method, path, body = {}) {
  await delay(200)
  const m = path.match(/^\/api\/([a-z-]+)\/(?:(\d+)\/)?$/)
  if (!m) throw new Error(`mock: нет маршрута ${method} ${path}`)
  const res = m[1]
  const id = m[2] ? Number(m[2]) : null

  if (res === 'violations') {
    if (!id || !['new', 'confirmed', 'false_positive'].includes(body.status)) throw bad({ status: ['Недопустимое значение.'] })
    statusOverride[id] = body.status
    return { status: body.status }
  }

  if (res === 'cameras') {
    if (method === 'POST') {
      if (!body.name?.trim()) throw bad({ name: ['Это поле не может быть пустым.'] })
      const c = { id: nextId++, location: '', source_type: 'file', source_uri: '', is_active: true, online: false,
                  ...pickFields(body, ['name', 'location', 'source_type', 'source_uri', 'is_active']) }
      CAMERAS.push(c)
      return camOut(c)
    }
    const c = CAMERAS.find((x) => x.id === id)
    if (!c) throw notFound()
    if (method === 'DELETE') {
      CAMERAS.splice(CAMERAS.indexOf(c), 1)
      const gone = ZONES.filter((z) => z.camera === id).map((z) => z.id)
      ZONES = ZONES.filter((z) => z.camera !== id)
      RULES = RULES.filter((r) => !gone.includes(r.zone))
      return null
    }
    if ('name' in body && !body.name.trim()) throw bad({ name: ['Это поле не может быть пустым.'] })
    Object.assign(c, pickFields(body, ['name', 'location', 'source_type', 'source_uri', 'is_active']))
    return camOut(c)
  }

  if (res === 'zones') {
    if (method === 'POST') {
      if (!body.name?.trim()) throw bad({ name: ['Это поле не может быть пустым.'] })
      if (!CAMERAS.some((c) => c.id === body.camera)) throw bad({ camera: ['Недопустимый первичный ключ.'] })
      const z = { id: nextId++, camera: body.camera, name: body.name, is_active: body.is_active ?? true }
      ZONES.push(z)
      return { ...z, rules: [] }
    }
    const z = ZONES.find((x) => x.id === id)
    if (!z) throw notFound()
    if (method === 'DELETE') {
      ZONES = ZONES.filter((x) => x.id !== id)
      RULES = RULES.filter((r) => r.zone !== id)
      return null
    }
    Object.assign(z, pickFields(body, ['name', 'is_active']))
    return { ...z, rules: RULES.filter((r) => r.zone === z.id) }
  }

  if (res === 'ppe-rules') {
    if (method === 'POST') {
      if (!CODES.includes(body.code)) throw bad({ code: ['Недопустимое значение.'] })
      if (RULES.some((r) => r.zone === body.zone && r.code === body.code))
        throw bad({ non_field_errors: ['Поля zone, code должны производить уникальный набор.'] })
      const r = { id: nextId++, zone: body.zone, code: body.code, is_active: body.is_active ?? true }
      RULES.push(r)
      return r
    }
    const r = RULES.find((x) => x.id === id)
    if (!r) throw notFound()
    if (method === 'DELETE') { RULES = RULES.filter((x) => x.id !== id); return null }
    Object.assign(r, pickFields(body, ['is_active']))
    return r
  }
  throw new Error(`mock: нет ресурса ${res}`)
}

// // Демо-режим: отдаёт данные в ТОЧНО таком же формате, как Django (пагинация, поля моделей),
// // поэтому адаптеры, хуки и страницы работают без изменений. Включается VITE_USE_MOCK=1.

// import { ApiError } from './client'

// const delay = (ms) => new Promise((r) => setTimeout(r, ms))
// const iso = (ms) => new Date(ms).toISOString()
// const T0 = Date.now()
// let seed = 7
// const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
// const pick = (arr) => arr[Math.floor(rnd() * arr.length)]

// const CODES = ['NO_HELMET', 'NO_VEST', 'NO_GLOVES']

// // ── камеры, зоны, правила (изменяемое состояние для CRUD) ──────
// const CAMERAS = [
//   { id: 1, name: 'Камера 01', location: 'Склад Б', source_type: 'rtp', source_uri: 'rtsp://admin:secret@10.0.0.11:554/stream1', is_active: true, online: true },
//   { id: 2, name: 'Камера 02', location: 'Погрузка', source_type: 'rtp', source_uri: 'rtsp://10.0.0.12:554/stream1', is_active: true, online: true },
//   { id: 3, name: 'Камера 03', location: 'Цех 2', source_type: 'rtp', source_uri: 'rtsp://10.0.0.13:554/stream1', is_active: true, online: true },
//   { id: 4, name: 'Камера 04', location: 'Вход', source_type: 'rtp', source_uri: 'rtsp://10.0.0.14:554/stream1', is_active: true, online: false }, // нет данных ML
// ]
// let ZONES = CAMERAS.map((c) => ({ id: c.id, camera: c.id, name: `Зона ${c.id}`, is_active: true }))
// // у зоны 4 нет правил — для демонстрации предупреждения
// let RULES = ZONES.flatMap((z) => (z.id === 4 ? [] : CODES.map((code, i) => ({ id: z.id * 10 + i, zone: z.id, code, is_active: true }))))
// let nextId = 100

// const camOut = (c) => ({
//   id: c.id, name: c.name, source_type: c.source_type, source_uri: c.source_uri, location: c.location,
//   is_active: c.is_active, created_at: iso(T0 - 30 * 864e5),
//   ml_last_seen: c.online ? iso(Date.now() - 30_000) : null,
//   ml_online: c.online && c.is_active,
// })
// const camerasOut = () => CAMERAS.map(camOut)
// const zonesOut = () => ZONES.map((z) => ({ ...z, rules: RULES.filter((r) => r.zone === z.id) }))

// // ── нарушения: история + «идущие сейчас» ───────────────────────
// const STATUS_ROLL = ['new', 'new', 'new', 'confirmed', 'confirmed', 'false_positive']
// const history = Array.from({ length: 70 }, (_, i) => {
//   const cam = 1 + Math.floor(rnd() * 4)
//   const start = T0 - 600_000 - Math.floor(rnd() * 6 * 36e5)
//   const dur = 5_000 + Math.floor(rnd() * 120_000)
//   const x1 = 100 + rnd() * 700, y1 = 60 + rnd() * 200
//   return {
//     id: i + 1, camera: cam, zone: cam, video: cam <= 2 ? 5 : null,
//     employee: rnd() < 0.2 ? 1 + Math.floor(rnd() * 3) : null,
//     code: pick(CODES), track_id: Math.floor(rnd() * 40), status: pick(STATUS_ROLL),
//     model_version: 'yolov8n-ppe-0.3', frame_width: 1280, frame_height: 720,
//     frame_number: 100 + i, last_frame_number: 100 + i + Math.round(dur / 200),
//     timestamp: iso(start), ended_at: iso(start + dur), frames_count: Math.max(1, Math.round(dur / 200)),
//     bbox_x1: x1, bbox_y1: y1, bbox_x2: x1 + 120 + rnd() * 60, bbox_y2: y1 + 300 + rnd() * 80,
//     confidence: 0.6 + rnd() * 0.38, external_id: '', created_at: iso(start),
//   }
// })
// const LIVE = [
//   { id: 1001, camera: 1, code: 'NO_HELMET', track_id: 7, box: [185, 40, 410, 520] },
//   { id: 1002, camera: 1, code: 'NO_VEST', track_id: 7, box: [185, 40, 410, 520] },
//   { id: 1003, camera: 2, code: 'NO_VEST', track_id: 12, box: [520, 120, 700, 560] },
// ]
// const statusOverride = {}
// const liveOut = () =>
//   LIVE.map((l) => ({
//     id: l.id, camera: l.camera, zone: l.camera, video: null, employee: null, code: l.code,
//     track_id: l.track_id, status: statusOverride[l.id] ?? 'new', model_version: 'yolov8n-ppe-0.3',
//     frame_width: 1280, frame_height: 720, frame_number: 900, last_frame_number: 1000,
//     timestamp: iso(Date.now() - 90_000), ended_at: iso(Date.now()), // ended_at «сейчас» → isActive
//     frames_count: 450, bbox_x1: l.box[0], bbox_y1: l.box[1], bbox_x2: l.box[2], bbox_y2: l.box[3],
//     confidence: 0.91, external_id: '', created_at: iso(Date.now() - 90_000),
//   }))
// const allViolations = () =>
//   [...liveOut(), ...history.map((v) => ({ ...v, status: statusOverride[v.id] ?? v.status }))]
//     .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))

// // ── сводки ML: раз в 10 минут с начала суток ───────────────────
// const day0 = new Date(); day0.setHours(0, 0, 0, 0)
// const SUMMARIES = []
// for (const c of CAMERAS) {
//   for (let t = day0.getTime() + 8 * 36e5; t < T0; t += 600_000) {
//     const checked = 8 + Math.floor(rnd() * 13)
//     SUMMARIES.push({
//       id: SUMMARIES.length + 1, camera: c.id, zone: c.id, timestamp: iso(t),
//       people_checked: checked, violators: Math.min(checked, Math.floor(rnd() * 4)), model_version: 'yolov8n-ppe-0.3',
//     })
//   }
// }
// SUMMARIES.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))

// // ── пагинация как в DRF (PAGE_SIZE = 50) ───────────────────────
// function paginate(list, params) {
//   const page = Number(params.page ?? 1), size = 50
//   return {
//     count: list.length,
//     next: page * size < list.length ? `?page=${page + 1}` : null,
//     previous: page > 1 ? `?page=${page - 1}` : null,
//     results: list.slice((page - 1) * size, page * size),
//   }
// }

// export async function mockGet(path, p = {}) {
//   await delay(250)
//   if (path === '/api/cameras/') return paginate(camerasOut(), p)
//   if (path === '/api/zones/') return paginate(zonesOut(), p)
//   if (path === '/api/violations/') {
//     let list = allViolations()
//     for (const [param, field] of [['camera', 'camera'], ['zone', 'zone'], ['code', 'code'], ['status', 'status']]) {
//       if (p[param]) list = list.filter((v) => String(v[field]) === String(p[param]))
//     }
//     if (p.date_from) list = list.filter((v) => new Date(v.timestamp) >= new Date(p.date_from))
//     if (p.date_to) list = list.filter((v) => new Date(v.timestamp) <= new Date(p.date_to))
//     return paginate(list, p)
//   }
//   if (path === '/api/summaries/') {
//     let list = SUMMARIES
//     if (p.camera) list = list.filter((s) => String(s.camera) === String(p.camera))
//     if (p.date_from) list = list.filter((s) => new Date(s.timestamp) >= new Date(p.date_from))
//     return paginate(list, p)
//   }
//   const mv = path.match(/^\/api\/videos\/(\d+)\/$/)
//   if (mv) {
//     return { id: Number(mv[1]), camera: 1, file: 'mock:demo', original_name: 'demo.mp4', size_bytes: 0,
//              duration_sec: 120, fps: 25, frame_count: 3000, width: 1280, height: 720, uploaded_at: iso(T0 - 864e5) }
//   }
//   throw new Error(`mock: нет маршрута ${path}`)
// }

// const bad = (body) => new ApiError(400, JSON.stringify(body))
// const notFound = () => new ApiError(404, JSON.stringify({ detail: 'Не найдено.' }))
// const pickFields = (body, keys) => Object.fromEntries(keys.filter((k) => k in body).map((k) => [k, body[k]]))

// /** Имитация POST / PATCH / DELETE для violations, cameras, zones, ppe-rules. */
// export async function mockSend(method, path, body = {}) {
//   await delay(200)
//   const m = path.match(/^\/api\/([a-z-]+)\/(?:(\d+)\/)?$/)
//   if (!m) throw new Error(`mock: нет маршрута ${method} ${path}`)
//   const res = m[1]
//   const id = m[2] ? Number(m[2]) : null

//   if (res === 'violations') {
//     if (!id || !['new', 'confirmed', 'false_positive'].includes(body.status)) throw bad({ status: ['Недопустимое значение.'] })
//     statusOverride[id] = body.status
//     return { status: body.status }
//   }

//   if (res === 'cameras') {
//     if (method === 'POST') {
//       if (!body.name?.trim()) throw bad({ name: ['Это поле не может быть пустым.'] })
//       const c = { id: nextId++, location: '', source_type: 'file', source_uri: '', is_active: true, online: false,
//                   ...pickFields(body, ['name', 'location', 'source_type', 'source_uri', 'is_active']) }
//       CAMERAS.push(c)
//       return camOut(c)
//     }
//     const c = CAMERAS.find((x) => x.id === id)
//     if (!c) throw notFound()
//     if (method === 'DELETE') {
//       CAMERAS.splice(CAMERAS.indexOf(c), 1)
//       const gone = ZONES.filter((z) => z.camera === id).map((z) => z.id)
//       ZONES = ZONES.filter((z) => z.camera !== id)
//       RULES = RULES.filter((r) => !gone.includes(r.zone))
//       return null
//     }
//     if ('name' in body && !body.name.trim()) throw bad({ name: ['Это поле не может быть пустым.'] })
//     Object.assign(c, pickFields(body, ['name', 'location', 'source_type', 'source_uri', 'is_active']))
//     return camOut(c)
//   }

//   if (res === 'zones') {
//     if (method === 'POST') {
//       if (!body.name?.trim()) throw bad({ name: ['Это поле не может быть пустым.'] })
//       if (!CAMERAS.some((c) => c.id === body.camera)) throw bad({ camera: ['Недопустимый первичный ключ.'] })
//       const z = { id: nextId++, camera: body.camera, name: body.name, is_active: body.is_active ?? true }
//       ZONES.push(z)
//       return { ...z, rules: [] }
//     }
//     const z = ZONES.find((x) => x.id === id)
//     if (!z) throw notFound()
//     if (method === 'DELETE') {
//       ZONES = ZONES.filter((x) => x.id !== id)
//       RULES = RULES.filter((r) => r.zone !== id)
//       return null
//     }
//     Object.assign(z, pickFields(body, ['name', 'is_active']))
//     return { ...z, rules: RULES.filter((r) => r.zone === z.id) }
//   }

//   if (res === 'ppe-rules') {
//     if (method === 'POST') {
//       if (!CODES.includes(body.code)) throw bad({ code: ['Недопустимое значение.'] })
//       if (RULES.some((r) => r.zone === body.zone && r.code === body.code))
//         throw bad({ non_field_errors: ['Поля zone, code должны производить уникальный набор.'] })
//       const r = { id: nextId++, zone: body.zone, code: body.code, is_active: body.is_active ?? true }
//       RULES.push(r)
//       return r
//     }
//     const r = RULES.find((x) => x.id === id)
//     if (!r) throw notFound()
//     if (method === 'DELETE') { RULES = RULES.filter((x) => x.id !== id); return null }
//     Object.assign(r, pickFields(body, ['is_active']))
//     return r
//   }
//   throw new Error(`mock: нет ресурса ${res}`)
// }

// // Демо-режим: отдаёт данные в ТОЧНО таком же формате, как Django (пагинация, поля моделей),
// // поэтому адаптеры, хуки и страницы работают без изменений. Включается VITE_USE_MOCK=1.

// import { ApiError } from './client'

// const delay = (ms) => new Promise((r) => setTimeout(r, ms))
// const iso = (ms) => new Date(ms).toISOString()
// const T0 = Date.now()
// let seed = 7
// const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
// const pick = (arr) => arr[Math.floor(rnd() * arr.length)]

// const CODES = ['NO_HELMET', 'NO_VEST', 'NO_GLOVES']

// // ── камеры, зоны, правила (изменяемое состояние для CRUD) ──────
// const CAMERAS = [
//   { id: 1, name: 'Камера 01', location: 'Склад Б', source_type: 'rtp', source_uri: 'rtsp://admin:secret@10.0.0.11:554/stream1', is_active: true, online: true },
//   { id: 2, name: 'Камера 02', location: 'Погрузка', source_type: 'rtp', source_uri: 'rtsp://10.0.0.12:554/stream1', is_active: true, online: true },
//   { id: 3, name: 'Камера 03', location: 'Цех 2', source_type: 'rtp', source_uri: 'rtsp://10.0.0.13:554/stream1', is_active: true, online: true },
//   { id: 4, name: 'Камера 04', location: 'Вход', source_type: 'rtp', source_uri: 'rtsp://10.0.0.14:554/stream1', is_active: true, online: false }, // нет данных ML
// ]
// let ZONES = CAMERAS.map((c) => ({ id: c.id, camera: c.id, name: `Зона ${c.id}`, is_active: true }))
// // у зоны 4 нет правил — для демонстрации предупреждения
// let RULES = ZONES.flatMap((z) => (z.id === 4 ? [] : CODES.map((code, i) => ({ id: z.id * 10 + i, zone: z.id, code, is_active: true }))))
// let nextId = 100

// const camOut = (c) => ({
//   id: c.id, name: c.name, source_type: c.source_type, source_uri: c.source_uri, location: c.location,
//   is_active: c.is_active, created_at: iso(T0 - 30 * 864e5),
//   ml_last_seen: c.online ? iso(Date.now() - 30_000) : null,
//   ml_online: c.online && c.is_active,
// })
// const camerasOut = () => CAMERAS.map(camOut)
// const zonesOut = () => ZONES.map((z) => ({ ...z, rules: RULES.filter((r) => r.zone === z.id) }))

// // ── нарушения: история + «идущие сейчас» ───────────────────────
// const STATUS_ROLL = ['new', 'new', 'new', 'confirmed', 'confirmed', 'false_positive']
// const history = Array.from({ length: 70 }, (_, i) => {
//   const cam = 1 + Math.floor(rnd() * 4)
//   const start = T0 - 600_000 - Math.floor(rnd() * 6 * 36e5)
//   const dur = 5_000 + Math.floor(rnd() * 120_000)
//   const x1 = 100 + rnd() * 700, y1 = 60 + rnd() * 200
//   return {
//     id: i + 1, camera: cam, zone: cam, video: null,
//     employee: rnd() < 0.2 ? 1 + Math.floor(rnd() * 3) : null,
//     code: pick(CODES), track_id: Math.floor(rnd() * 40), status: pick(STATUS_ROLL),
//     model_version: 'yolov8n-ppe-0.3', frame_width: 1280, frame_height: 720,
//     frame_number: 100 + i, last_frame_number: 100 + i + Math.round(dur / 200),
//     timestamp: iso(start), ended_at: iso(start + dur), frames_count: Math.max(1, Math.round(dur / 200)),
//     bbox_x1: x1, bbox_y1: y1, bbox_x2: x1 + 120 + rnd() * 60, bbox_y2: y1 + 300 + rnd() * 80,
//     confidence: 0.6 + rnd() * 0.38, external_id: '', created_at: iso(start),
//   }
// })
// const LIVE = [
//   { id: 1001, camera: 1, code: 'NO_HELMET', track_id: 7, box: [185, 40, 410, 520] },
//   { id: 1002, camera: 1, code: 'NO_VEST', track_id: 7, box: [185, 40, 410, 520] },
//   { id: 1003, camera: 2, code: 'NO_VEST', track_id: 12, box: [520, 120, 700, 560] },
// ]
// const statusOverride = {}
// const liveOut = () =>
//   LIVE.map((l) => ({
//     id: l.id, camera: l.camera, zone: l.camera, video: null, employee: null, code: l.code,
//     track_id: l.track_id, status: statusOverride[l.id] ?? 'new', model_version: 'yolov8n-ppe-0.3',
//     frame_width: 1280, frame_height: 720, frame_number: 900, last_frame_number: 1000,
//     timestamp: iso(Date.now() - 90_000), ended_at: iso(Date.now()), // ended_at «сейчас» → isActive
//     frames_count: 450, bbox_x1: l.box[0], bbox_y1: l.box[1], bbox_x2: l.box[2], bbox_y2: l.box[3],
//     confidence: 0.91, external_id: '', created_at: iso(Date.now() - 90_000),
//   }))
// const allViolations = () =>
//   [...liveOut(), ...history.map((v) => ({ ...v, status: statusOverride[v.id] ?? v.status }))]
//     .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))

// // ── сводки ML: раз в 10 минут с начала суток ───────────────────
// const day0 = new Date(); day0.setHours(0, 0, 0, 0)
// const SUMMARIES = []
// for (const c of CAMERAS) {
//   for (let t = day0.getTime() + 8 * 36e5; t < T0; t += 600_000) {
//     const checked = 8 + Math.floor(rnd() * 13)
//     SUMMARIES.push({
//       id: SUMMARIES.length + 1, camera: c.id, zone: c.id, timestamp: iso(t),
//       people_checked: checked, violators: Math.min(checked, Math.floor(rnd() * 4)), model_version: 'yolov8n-ppe-0.3',
//     })
//   }
// }
// SUMMARIES.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))

// // ── пагинация как в DRF (PAGE_SIZE = 50) ───────────────────────
// function paginate(list, params) {
//   const page = Number(params.page ?? 1), size = 50
//   return {
//     count: list.length,
//     next: page * size < list.length ? `?page=${page + 1}` : null,
//     previous: page > 1 ? `?page=${page - 1}` : null,
//     results: list.slice((page - 1) * size, page * size),
//   }
// }

// export async function mockGet(path, p = {}) {
//   await delay(250)
//   if (path === '/api/cameras/') return paginate(camerasOut(), p)
//   if (path === '/api/zones/') return paginate(zonesOut(), p)
//   if (path === '/api/violations/') {
//     let list = allViolations()
//     for (const [param, field] of [['camera', 'camera'], ['zone', 'zone'], ['code', 'code'], ['status', 'status']]) {
//       if (p[param]) list = list.filter((v) => String(v[field]) === String(p[param]))
//     }
//     if (p.date_from) list = list.filter((v) => new Date(v.timestamp) >= new Date(p.date_from))
//     if (p.date_to) list = list.filter((v) => new Date(v.timestamp) <= new Date(p.date_to))
//     return paginate(list, p)
//   }
//   if (path === '/api/summaries/') {
//     let list = SUMMARIES
//     if (p.camera) list = list.filter((s) => String(s.camera) === String(p.camera))
//     if (p.date_from) list = list.filter((s) => new Date(s.timestamp) >= new Date(p.date_from))
//     return paginate(list, p)
//   }
//   throw new Error(`mock: нет маршрута ${path}`)
// }

// const bad = (body) => new ApiError(400, JSON.stringify(body))
// const notFound = () => new ApiError(404, JSON.stringify({ detail: 'Не найдено.' }))
// const pickFields = (body, keys) => Object.fromEntries(keys.filter((k) => k in body).map((k) => [k, body[k]]))

// /** Имитация POST / PATCH / DELETE для violations, cameras, zones, ppe-rules. */
// export async function mockSend(method, path, body = {}) {
//   await delay(200)
//   const m = path.match(/^\/api\/([a-z-]+)\/(?:(\d+)\/)?$/)
//   if (!m) throw new Error(`mock: нет маршрута ${method} ${path}`)
//   const res = m[1]
//   const id = m[2] ? Number(m[2]) : null

//   if (res === 'violations') {
//     if (!id || !['new', 'confirmed', 'false_positive'].includes(body.status)) throw bad({ status: ['Недопустимое значение.'] })
//     statusOverride[id] = body.status
//     return { status: body.status }
//   }

//   if (res === 'cameras') {
//     if (method === 'POST') {
//       if (!body.name?.trim()) throw bad({ name: ['Это поле не может быть пустым.'] })
//       const c = { id: nextId++, location: '', source_type: 'file', source_uri: '', is_active: true, online: false,
//                   ...pickFields(body, ['name', 'location', 'source_type', 'source_uri', 'is_active']) }
//       CAMERAS.push(c)
//       return camOut(c)
//     }
//     const c = CAMERAS.find((x) => x.id === id)
//     if (!c) throw notFound()
//     if (method === 'DELETE') {
//       CAMERAS.splice(CAMERAS.indexOf(c), 1)
//       const gone = ZONES.filter((z) => z.camera === id).map((z) => z.id)
//       ZONES = ZONES.filter((z) => z.camera !== id)
//       RULES = RULES.filter((r) => !gone.includes(r.zone))
//       return null
//     }
//     if ('name' in body && !body.name.trim()) throw bad({ name: ['Это поле не может быть пустым.'] })
//     Object.assign(c, pickFields(body, ['name', 'location', 'source_type', 'source_uri', 'is_active']))
//     return camOut(c)
//   }

//   if (res === 'zones') {
//     if (method === 'POST') {
//       if (!body.name?.trim()) throw bad({ name: ['Это поле не может быть пустым.'] })
//       if (!CAMERAS.some((c) => c.id === body.camera)) throw bad({ camera: ['Недопустимый первичный ключ.'] })
//       const z = { id: nextId++, camera: body.camera, name: body.name, is_active: body.is_active ?? true }
//       ZONES.push(z)
//       return { ...z, rules: [] }
//     }
//     const z = ZONES.find((x) => x.id === id)
//     if (!z) throw notFound()
//     if (method === 'DELETE') {
//       ZONES = ZONES.filter((x) => x.id !== id)
//       RULES = RULES.filter((r) => r.zone !== id)
//       return null
//     }
//     Object.assign(z, pickFields(body, ['name', 'is_active']))
//     return { ...z, rules: RULES.filter((r) => r.zone === z.id) }
//   }

//   if (res === 'ppe-rules') {
//     if (method === 'POST') {
//       if (!CODES.includes(body.code)) throw bad({ code: ['Недопустимое значение.'] })
//       if (RULES.some((r) => r.zone === body.zone && r.code === body.code))
//         throw bad({ non_field_errors: ['Поля zone, code должны производить уникальный набор.'] })
//       const r = { id: nextId++, zone: body.zone, code: body.code, is_active: body.is_active ?? true }
//       RULES.push(r)
//       return r
//     }
//     const r = RULES.find((x) => x.id === id)
//     if (!r) throw notFound()
//     if (method === 'DELETE') { RULES = RULES.filter((x) => x.id !== id); return null }
//     Object.assign(r, pickFields(body, ['is_active']))
//     return r
//   }
//   throw new Error(`mock: нет ресурса ${res}`)
// }