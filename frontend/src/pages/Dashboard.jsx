import { useMemo } from 'react'
import PageHeader from '../components/PageHeader'
import KpiCard from '../components/KpiCard'
import Card from '../components/Card'
import TrendChart from '../components/TrendChart'
import BarList from '../components/BarList'
import AlertList from '../components/AlertList'
import {
  useCameras, useSummariesSince, useViolationCount, useViolationCounts, useViolations, useViolationsSince, useZones,
} from '../api/hooks'
import { complianceByHour, complianceRate, fmtTime } from '../api/adapters'
import { CODES, ppeInfo } from '../data/ppeClasses'
import RecommendationsCard from '../components/RecommendationsCard'
import { buildRecommendations } from '../utils/recommendations'

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString() }
const pct = (n) => (n == null ? '—' : `${n.toFixed(1).replace('.', ',')}%`)

export default function Dashboard() {
  const since = useMemo(startOfToday, [])
  const cams = useCameras()
  const sums = useSummariesSince(since)
  const today = useViolationCount({ date_from: since })
  const pending = useViolationCount({ status: 'new' })
  const recent = useViolations({ status: 'new' })
  const byCode = useViolationCounts(CODES.map((code) => ({ code, date_from: since })))

  const todayViol = useViolationsSince(since)
  const zones = useZones()
  const ready = !!(todayViol.data && zones.data && cams.data && sums.data)
  const recs = useMemo(
    () => (ready
      ? buildRecommendations({ violations: todayViol.data, cameras: cams.data, zones: zones.data, summaries: sums.data })
      : []),
    [ready, todayViol.data, cams.data, zones.data, sums.data],
  )

  const camsById = Object.fromEntries((cams.data ?? []).map((c) => [c.id, c]))
  const online = (cams.data ?? []).filter((c) => c.ml_online).length

  const trend = complianceByHour(sums.data)
  const trendMin = trend.length ? Math.min(85, Math.floor(Math.min(...trend.map((p) => p.v)) / 5) * 5) : 85

  const total = byCode.reduce((a, q) => a + (q.data ?? 0), 0)
  const top = CODES.map((code, i) => ({
    label: ppeInfo(code).ppe,
    percent: total ? Math.round(((byCode[i].data ?? 0) / total) * 100) : 0,
  })).sort((a, b) => b.percent - a.percent)

  const alerts = (recent.data?.results ?? []).slice(0, 5).map((v) => ({
    risk: ppeInfo(v.code).risk,
    title: `${ppeInfo(v.code).label} · ${camsById[v.camera]?.name ?? `Камера ${v.camera}`}`,
    meta: `${fmtTime(v.timestamp)} · ID ${v.track_id ?? '—'}`,
  }))

  return (
    <>
      <PageHeader title="Сводка" />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
        <KpiCard label="Соблюдение СИЗ" value={pct(complianceRate(sums.data))} delta="по сводкам ML за сегодня" />
        <KpiCard label="Нарушений за сегодня" value={today.data ?? '—'} delta="с начала суток" />
        <KpiCard label="Камеры с данными ML" value={cams.data ? `${online} из ${cams.data.length}` : '—'} delta="сводка за последние 3 мин" />
        <KpiCard label="Ждут проверки" value={pending.data ?? '—'} delta="статус «Новая»" tone={pending.data ? 'high' : 'neutral'} />
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-4">
        <Card title="Соблюдение по часам" className="md:col-span-2">
          {trend.length >= 2
            ? <TrendChart data={trend} min={trendMin} />
            : <p className="text-muted">Недостаточно сводок за сегодня для графика</p>}
        </Card>
        <Card title="Нарушения по типу СИЗ, сегодня"><BarList items={top} /></Card>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-4">
        <Card title="Новые нарушения">
          {alerts.length ? <AlertList items={alerts} /> : <p className="text-muted">Нет новых нарушений</p>}
        </Card>
        <RecommendationsCard items={recs} loading={!ready} />
      </div>
    </>
  )
}