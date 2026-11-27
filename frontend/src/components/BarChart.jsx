/** Столбчатая диаграмма на SVG без зависимостей. data: [{ label, value }]. */
export default function BarChart({ data, ariaLabel, width = 640, height = 220 }) {
  const pad = { l: 34, r: 8, t: 16, b: 28 }
  const max = Math.max(1, ...data.map((d) => d.value))
  const step = Math.max(1, Math.ceil(max / 4))
  const yMax = step * 4
  const ticks = [0, 1, 2, 3, 4].map((i) => i * step)
  const slot = (width - pad.l - pad.r) / data.length
  const bw = slot * 0.62
  const y = (v) => pad.t + (1 - v / yMax) * (height - pad.t - pad.b)

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label={ariaLabel}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} className="stroke-line" />
          <text x={0} y={y(t) + 4} className="fill-muted text-[11px]">{t}</text>
        </g>
      ))}
      {data.map((d, i) => {
        const x = pad.l + i * slot + (slot - bw) / 2
        return (
          <g key={`${d.label}-${i}`}>
            <title>{`${d.label}: ${d.value}`}</title>
            {d.value > 0 && (
              <rect x={x} y={y(d.value)} width={bw} height={y(0) - y(d.value)} rx="3"
                    className="fill-brand stroke-ink" strokeWidth="1" />
            )}
            {data.length <= 14 && d.value > 0 && (
              <text x={x + bw / 2} y={y(d.value) - 4} textAnchor="middle" className="fill-ink text-[11px] font-semibold">{d.value}</text>
            )}
            <text x={x + bw / 2} y={height - 8} textAnchor="middle" className="fill-muted text-[11px]">{d.label}</text>
          </g>
        )
      })}
    </svg>
  )
}
