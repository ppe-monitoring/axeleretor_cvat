import { SHIFTS, shiftOf } from '../config/shifts'
import { complianceRate } from '../api/adapters'

const LOW_CONFIDENCE = 0.7 // уверенность ниже этого считаем «низкой»

const fmt = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' })
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
const endOfDay = (d) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x }

function mostCommon(values) {
  const counts = new Map()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}
const mean = (list, f) => (list.length ? list.reduce((a, x) => a + f(x), 0) / list.length : null)

/** Последние n дней (включая сегодня): [{ label, from, to }] — границы в ISO для date_from / date_to. */
export function dayBuckets(n = 14) {
  const today = startOfDay(new Date())
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(today)
    d.setDate(d.getDate() - (n - 1 - i))
    return { label: fmt.format(d), from: startOfDay(d).toISOString(), to: endOfDay(d).toISOString() }
  })
}

/** Последние n недель (с понедельника, текущая неделя неполная). Подпись — дата понедельника. */
export function weekBuckets(n = 8) {
  const monday = startOfDay(new Date())
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  return Array.from({ length: n }, (_, i) => {
    const start = new Date(monday)
    start.setDate(start.getDate() - 7 * (n - 1 - i))
    const end = new Date(start)
    end.setDate(end.getDate() + 6)
    return { label: fmt.format(start), from: start.toISOString(), to: endOfDay(end).toISOString() }
  })
}

/** Рейтинг зон по числу нарушений. */
export function zoneRating(violations, zones, cameras, limit = 5) {
  const zoneById = Object.fromEntries(zones.map((z) => [z.id, z]))
  const camById = Object.fromEntries(cameras.map((c) => [c.id, c]))
  const groups = new Map()
  for (const v of violations) {
    const k = v.zone ?? 'none'
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(v)
  }
  return [...groups.entries()]
    .map(([zid, list]) => {
      const z = zoneById[zid]
      const cam = camById[z?.camera ?? list[0].camera]
      return {
        id: zid,
        name: z?.name ?? 'Без зоны',
        camera: cam?.name ?? `Камера ${list[0].camera}`,
        count: list.length,
        share: violations.length ? list.length / violations.length : 0,
        topCode: mostCommon(list.map((v) => v.code)),
      }
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
}

/**
 * Статистика по сменам. Нарушения — за `days` дней, соблюдение — по переданным сводкам
 * (на дашборде это сводки за сегодня, поэтому колонка так и подписана).
 */
export function shiftStats(violations, days, summaries = []) {
  return SHIFTS.map((s) => {
    const list = violations.filter((v) => shiftOf(new Date(v.timestamp).getHours())?.key === s.key)
    const sums = summaries.filter((x) => shiftOf(new Date(x.timestamp).getHours())?.key === s.key)
    return {
      ...s,
      count: list.length,
      share: violations.length ? list.length / violations.length : 0,
      perDay: list.length / days,
      topCode: mostCommon(list.map((v) => v.code)),
      compliance: sums.length ? complianceRate(sums) : null,
    }
  })
}

/**
 * Качество распознавания по данным бэкенда: уверенность модели и результаты проверки.
 * precision = подтверждено / проверено (status: confirmed против false_positive).
 * Пропущенные моделью нарушения измерить нельзя — полнота здесь недоступна.
 */
export function recognitionQuality(violations) {
  if (!violations.length) return null
  const summarize = (list) => {
    const reviewed = list.filter((v) => v.status !== 'new')
    const confirmed = reviewed.filter((v) => v.status === 'confirmed')
    return {
      count: list.length,
      avgConfidence: mean(list, (v) => v.confidence),
      reviewed: reviewed.length,
      precision: reviewed.length ? confirmed.length / reviewed.length : null,
    }
  }
  const groupBy = (keyFn) => {
    const m = new Map()
    for (const v of violations) {
      const k = keyFn(v)
      if (!m.has(k)) m.set(k, [])
      m.get(k).push(v)
    }
    return [...m.entries()].map(([key, list]) => ({ key, ...summarize(list) })).sort((a, b) => b.count - a.count)
  }
  const overall = summarize(violations)
  return {
    ...overall,
    reviewedShare: overall.reviewed / violations.length,
    lowConfidenceShare: violations.filter((v) => v.confidence < LOW_CONFIDENCE).length / violations.length,
    byCode: groupBy((v) => v.code),
    byModel: groupBy((v) => v.model_version || '—'),
  }
}

export const LOW_CONFIDENCE_PCT = Math.round(LOW_CONFIDENCE * 100)
