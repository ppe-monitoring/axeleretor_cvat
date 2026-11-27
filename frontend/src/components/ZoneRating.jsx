import { ppeInfo } from '../data/ppeClasses'

export default function ZoneRating({ items, loading }) {
  if (loading) return <p className="text-muted">Загрузка…</p>
  if (!items?.length) return <p className="text-muted">За период нарушений нет.</p>
  const max = items[0].count
  return (
    <ol>
      {items.map((z, i) => (
        <li key={z.id} className="grid grid-cols-[28px_1fr_auto] items-center gap-3 border-t border-line py-2.5 first:border-t-0">
          <span className="text-lg font-bold text-muted" aria-hidden="true">{i + 1}</span>
          <div>
            <p className="font-semibold">{z.name} <span className="font-normal text-muted">· {z.camera}</span></p>
            <div className="mt-1 h-2 rounded-full bg-line" role="presentation">
              <div className="h-2 rounded-full border border-ink bg-brand" style={{ width: `${(z.count / max) * 100}%` }} />
            </div>
            <p className="mt-1 text-[13px] text-muted">Чаще всего: {z.topCode ? ppeInfo(z.topCode).ppe : '—'}</p>
          </div>
          <div className="text-right">
            <b>{z.count}</b>
            <p className="text-[13px] text-muted">{Math.round(z.share * 100)}%</p>
          </div>
        </li>
      ))}
    </ol>
  )
}
