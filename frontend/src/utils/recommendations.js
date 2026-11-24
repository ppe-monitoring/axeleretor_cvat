import { ppeInfo } from '../data/ppeClasses'
import { complianceByHour } from '../api/adapters'

// Пороги эвристик — подберите под своё производство.
const T = {
  zoneMin: 5, zoneShare: 0.4,   // зона даёт ≥ 40% нарушений (и их не меньше 5)
  lowHour: 90,                  // соблюдение по часу ниже 90%
  pendingMin: 10,               // не разобрано ≥ 10 нарушений
  fpMin: 5, fpShare: 0.3,       // ≥ 30% ложных среди проверенных (проверено не меньше 5)
  repeat: 3,                    // сотрудник с ≥ 3 нарушениями за период
}
const RANK = { high: 0, mid: 1, low: 2 }

function group(list, keyFn) {
  const m = new Map()
  for (const x of list) {
    const k = keyFn(x)
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(x)
  }
  return m
}
function mostCommon(values) {
  const counts = group(values, (v) => v)
  return [...counts.entries()].sort((a, b) => b[1].length - a[1].length)[0][0]
}

/**
 * Правила → подсказки руководителю. Вызывайте, когда все данные загружены:
 * иначе «нет зоны» или «нет данных» сработают ложно.
 * Возвращает [{ risk, title, meta }], самые важные первыми (не больше 6).
 */
export function buildRecommendations({ violations = [], cameras = [], zones = [], summaries = [] }) {
  const out = []
  const camById = Object.fromEntries(cameras.map((c) => [c.id, c]))
  const zoneById = Object.fromEntries(zones.map((z) => [z.id, z]))
  const zoneLabel = (id) => {
    const z = zoneById[id]
    if (!z) return 'Без зоны'
    const c = camById[z.camera]
    return c ? `${z.name} · ${c.name}` : z.name
  }

  // 1. Концентрация нарушений в одной зоне
  if (violations.length) {
    for (const [zid, list] of group(violations, (v) => v.zone ?? 'none')) {
      const share = list.length / violations.length
      if (list.length >= T.zoneMin && share >= T.zoneShare) {
        const top = mostCommon(list.map((v) => v.code))
        out.push({
          risk: share >= 0.6 ? 'high' : 'mid',
          title: `${zoneLabel(zid)}: ${Math.round(share * 100)}% нарушений — ${ppeInfo(top).label.toLowerCase()}`,
          meta: 'Проверьте выдачу СИЗ и проведите инструктаж в этой зоне.',
        })
      }
    }
  }

  // 2. Час с самым низким соблюдением
  const hours = complianceByHour(summaries)
  if (hours.length >= 3) {
    const low = hours.reduce((a, b) => (b.v < a.v ? b : a))
    if (low.v < T.lowHour) {
      out.push({
        risk: low.v < 80 ? 'high' : 'mid',
        title: `Минимум соблюдения в ${low.t}: ${String(low.v).replace('.', ',')}%`,
        meta: 'Сопоставьте с расписанием смен и загрузкой зон в это время.',
      })
    }
  }

  // 3. Накопились неразобранные нарушения
  const fresh = violations.filter((v) => v.status === 'new')
  if (fresh.length >= T.pendingMin) {
    const oldest = Math.min(...fresh.map((v) => new Date(v.timestamp).getTime()))
    const hrs = Math.floor((Date.now() - oldest) / 36e5)
    out.push({
      risk: hrs >= 4 ? 'high' : 'mid',
      title: `Не разобрано нарушений: ${fresh.length}`,
      meta: hrs >= 1 ? `Самое старое ждёт проверки около ${hrs} ч.` : 'Подтвердите или отклоните их в журнале.',
    })
  }

  // 4. Много ложных срабатываний по типу СИЗ
  for (const [code, list] of group(violations, (v) => v.code)) {
    const reviewed = list.filter((v) => v.status !== 'new')
    const fp = reviewed.filter((v) => v.status === 'false_positive')
    if (reviewed.length >= T.fpMin && fp.length / reviewed.length >= T.fpShare) {
      out.push({
        risk: 'mid',
        title: `${ppeInfo(code).ppe}: ${Math.round((fp.length / reviewed.length) * 100)}% ложных срабатываний`,
        meta: 'Попросите администратора проверить порог уверенности и версию модели.',
      })
    }
  }

  // 5. Камеры без данных и зоны без правил
  for (const c of cameras.filter((x) => x.is_active)) {
    if (!c.ml_online) {
      out.push({ risk: 'high', title: `Нет данных от камеры «${c.name}»`,
                 meta: 'ML не присылал сводки более 3 минут: проверьте поток и модуль ML.' })
    }
    if (!zones.some((z) => z.camera === c.id && z.is_active)) {
      out.push({ risk: 'high', title: `У камеры «${c.name}» нет активной зоны`,
                 meta: 'События от ML отклоняются, нарушения не фиксируются.' })
    }
  }
  for (const z of zones.filter((x) => x.is_active && !x.rules.some((r) => r.is_active))) {
    out.push({ risk: 'mid', title: `Зона «${zoneLabel(z.id)}» без обязательных СИЗ`,
               meta: 'Отметьте обязательные СИЗ, иначе нарушения по зоне не принимаются.' })
  }

  // 6. Повторные нарушения одного сотрудника (если ML/СКУД привязали сотрудника)
  for (const [emp, list] of group(violations.filter((v) => v.employee), (v) => v.employee)) {
    if (list.length >= T.repeat) {
      out.push({ risk: 'mid', title: `Повторные нарушения: сотрудник #${emp} (${list.length})`,
                 meta: 'Рассмотрите внеплановый инструктаж.' })
    }
  }

  return out.sort((a, b) => RANK[a.risk] - RANK[b.risk]).slice(0, 6)
}
