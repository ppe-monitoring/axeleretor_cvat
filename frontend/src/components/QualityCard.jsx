import { ppeInfo } from '../data/ppeClasses'
import { LOW_CONFIDENCE_PCT } from '../utils/analytics'

const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`)

function Stat({ label, value, hint }) {
  return (
    <div>
      <p className="text-[13px] text-muted">{label}</p>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-[13px] text-muted">{hint}</p>
    </div>
  )
}

function Table({ title, rows, label }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[380px] border-collapse text-left">
        <thead>
          <tr className="text-[13px] text-muted">
            <th scope="col" className="py-2 pr-3 font-normal">{title}</th>
            <th scope="col" className="py-2 pr-3 font-normal">Нарушений</th>
            <th scope="col" className="py-2 pr-3 font-normal">Уверенность</th>
            <th scope="col" className="py-2 font-normal">Подтверждено</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-line">
              <td className="py-2 pr-3">{label(r.key)}</td>
              <td className="py-2 pr-3">{r.count}</td>
              <td className="py-2 pr-3">{pct(r.avgConfidence)}</td>
              <td className="py-2">{pct(r.precision)}<span className="text-[13px] text-muted"> из {r.reviewed}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function QualityCard({ quality, loading }) {
  if (loading) return <p className="text-muted">Загрузка…</p>
  if (!quality) return <p className="text-muted">За период нет данных для оценки.</p>
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4">
        <Stat label="Подтверждено при проверке" value={pct(quality.precision)} hint={`из ${quality.reviewed} проверенных`} />
        <Stat label="Средняя уверенность" value={pct(quality.avgConfidence)} hint="уверенность модели" />
        <Stat label="Проверено вручную" value={pct(quality.reviewedShare)} hint="доля записей не «Новая»" />
        <Stat label={`Уверенность ниже ${LOW_CONFIDENCE_PCT}%`} value={pct(quality.lowConfidenceShare)} hint="кандидаты на проверку" />
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(340px,1fr))] gap-5">
        <Table title="Тип СИЗ" rows={quality.byCode} label={(k) => ppeInfo(k).ppe} />
        {quality.byModel.length > 1 && <Table title="Версия модели" rows={quality.byModel} label={(k) => k} />}
      </div>
      <p className="text-[13px] text-muted">
        «Подтверждено» — доля подтверждённых среди проверенных (точность). Нарушения, которые модель пропустила,
        здесь не видны. Уверенность хранится как максимум за нарушение, поэтому слегка завышена.
      </p>
    </div>
  )
}
