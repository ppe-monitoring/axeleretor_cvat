import { ppeInfo } from '../data/ppeClasses'

const timeFmt = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' })
const dateTimeFmt = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
export const fmtTime = (iso) => (iso ? timeFmt.format(new Date(iso)) : '—')
export const fmtDateTime = (iso) => (iso ? dateTimeFmt.format(new Date(iso)) : '—')

export function fmtDuration(start, end) {
  if (!start || !end) return '—'
  const s = Math.max(0, Math.round((new Date(end) - new Date(start)) / 1000))
  const m = Math.floor(s / 60)
  return m ? `${m} мин ${s % 60} с` : `${s} с`
}

export const STATUS_LABEL = { new: 'Новая', confirmed: 'Подтверждена', false_positive: 'Ложное срабатывание' }

// На бэке GAP_SECONDS = 5: пауза дольше — новое нарушение. Берём запас на интервал опроса.
const ACTIVE_WINDOW_MS = 8_000
/** ended_at обновляется с каждым кадром: свежий ended_at = нарушение идёт сейчас. */
export const isActive = (v) => !!v.ended_at && Date.now() - new Date(v.ended_at).getTime() < ACTIVE_WINDOW_MS

/** bbox_x1..y2 (пиксели кадра) → проценты кадра для CameraTile. */
export function bboxToPercent(v) {
  const { frame_width: fw, frame_height: fh, bbox_x1: x1, bbox_y1: y1, bbox_x2: x2, bbox_y2: y2 } = v
  if (!fw || !fh || [x1, y1, x2, y2].some((n) => n == null)) return null
  return { x: (x1 / fw) * 100, y: (y1 / fh) * 100, w: ((x2 - x1) / fw) * 100, h: ((y2 - y1) / fh) * 100 }
}

/** Строка журнала. camerasById / zonesById — словари по id. */
export function violationToRow(v, camerasById = {}, zonesById = {}) {
  const info = ppeInfo(v.code)
  const cam = camerasById[v.camera]
  const zone = zonesById[v.zone]
  return {
    id: v.id,
    time: fmtDateTime(v.timestamp),
    duration: fmtDuration(v.timestamp, v.ended_at),
    trackId: v.track_id,
    // в API приходит только id сотрудника; имя появится, когда бэкенд отдаст его
    employee: v.employee ? `Сотрудник #${v.employee}` : 'Не опознан',
    place: [cam?.name ?? `Камера ${v.camera}`, zone?.name].filter(Boolean).join(' · '),
    ppe: info.ppe,
    risk: info.risk,
    confidence: v.confidence != null ? `${Math.round(v.confidence * 100)}%` : '—',
    status: v.status,
  }
}

/** Активные нарушения → рамки (по одной на человека, подпись со всеми нарушениями). */
export function violationsToPeople(violations) {
  const byPerson = new Map()
  for (const v of violations.filter(isActive)) {
    const key = v.track_id ?? `v${v.id}`
    const box = bboxToPercent(v)
    if (!box) continue
    const entry = byPerson.get(key) ?? { ...box, ok: false, track: v.track_id, ppe: [] }
    entry.ppe.push(ppeInfo(v.code).ppe)
    byPerson.set(key, entry)
  }
  return [...byPerson.values()].map(({ ppe, track, ...box }) => ({
    ...box,
    label: `ID ${track ?? '—'} · нет: ${ppe.join(', ')}`,
  }))
}

/** Камера → пропсы CameraTile. Нет данных от ML — «Нет данных», а не «Норма». */
export function cameraToTile(cam, violations) {
  const base = { id: cam.id, zone: cam.location ?? '', people: [], lastSeen: cam.ml_last_seen }
  if (!cam.is_active) return { ...base, risk: 'none', status: 'Отключена' }
  if (!cam.ml_online) return { ...base, risk: 'none', status: 'Нет данных' }
  const active = violations.filter((v) => v.camera === cam.id && isActive(v))
  const risks = active.map((v) => ppeInfo(v.code).risk)
  const risk = risks.includes('high') ? 'high' : risks.includes('mid') ? 'mid' : risks.length ? 'low' : 'ok'
  return {
    ...base,
    people: violationsToPeople(active),
    risk: risk === 'ok' ? 'low' : risk,
    status: active.length ? 'Нарушение' : 'Норма',
  }
}

/** Соблюдение СИЗ, %: 1 − нарушители / проверенные. null, если сводок нет. */
export function complianceRate(summaries = []) {
  const checked = summaries.reduce((a, s) => a + s.people_checked, 0)
  const bad = summaries.reduce((a, s) => a + s.violators, 0)
  return checked ? (1 - bad / checked) * 100 : null
}

/** Сводки → [{ t: '09:00', v: % }] по часам. */
export function complianceByHour(summaries = []) {
  const hours = new Map()
  for (const s of summaries) {
    const h = new Date(s.timestamp).getHours()
    const acc = hours.get(h) ?? []
    acc.push(s)
    hours.set(h, acc)
  }
  return [...hours.entries()]
    .sort(([a], [b]) => a - b)
    .map(([h, list]) => ({ t: `${String(h).padStart(2, '0')}:00`, v: Math.round(complianceRate(list) * 10) / 10 }))
    .filter((p) => !Number.isNaN(p.v))
}
