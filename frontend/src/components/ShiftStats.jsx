import { ppeInfo } from '../data/ppeClasses'

const pct = (x) => (x == null ? '—' : `${x.toFixed(1).replace('.', ',')}%`)

export default function ShiftStats({ rows, loading }) {
  if (loading) return <p className="text-muted">Загрузка…</p>
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[460px] border-collapse text-left">
          <thead>
            <tr className="text-[13px] text-muted">
              <th scope="col" className="py-2 pr-3 font-normal">Смена</th>
              <th scope="col" className="py-2 pr-3 font-normal">Нарушений</th>
              <th scope="col" className="py-2 pr-3 font-normal">В день</th>
              <th scope="col" className="py-2 pr-3 font-normal">Чаще всего</th>
              <th scope="col" className="py-2 font-normal">Соблюдение сегодня</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-line">
                <td className="py-2.5 pr-3"><b>{r.label}</b><span className="block text-[13px] text-muted">{r.range}</span></td>
                <td className="py-2.5 pr-3"><b>{r.count}</b><span className="block text-[13px] text-muted">{Math.round(r.share * 100)}%</span></td>
                <td className="py-2.5 pr-3">{r.perDay.toFixed(1).replace('.', ',')}</td>
                <td className="py-2.5 pr-3">{r.topCode ? ppeInfo(r.topCode).ppe : '—'}</td>
                <td className="py-2.5">{pct(r.compliance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[13px] text-muted">
        Границы смен заданы в config/shifts.js. Соблюдение считается по сводкам ML за сегодня.
      </p>
    </>
  )
}
