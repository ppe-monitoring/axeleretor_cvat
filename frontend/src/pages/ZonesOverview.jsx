import PageHeader from '../components/PageHeader'
import Card from '../components/Card'
import RiskChip from '../components/RiskChip'
import { useCameras, useZones } from '../api/hooks'
import { ppeInfo } from '../data/ppeClasses'

/** Только чтение: камеры, зоны и обязательные СИЗ в каждой зоне. */
export default function ZonesOverview() {
  const cams = useCameras()
  const zones = useZones()
  if (cams.isPending || zones.isPending) return <p className="text-muted">Загрузка…</p>
  if (cams.isError || zones.isError) return <p className="text-risk-high-fg">Не удалось загрузить данные</p>

  return (
    <>
      <PageHeader title="Камеры и зоны" />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-4">
        {cams.data.filter((c) => c.is_active).map((c) => {
          const mine = zones.data.filter((z) => z.camera === c.id)
          return (
            <Card key={c.id} title={c.name}>
              <p className="mb-2 text-[13px] text-muted">{c.location || 'Расположение не указано'}</p>
              {mine.length === 0 && <p className="text-muted">Зоны не заданы</p>}
              {mine.map((z) => {
                const required = z.rules.filter((r) => r.is_active)
                return (
                  <div key={z.id} className="border-t border-line py-2.5 first:border-t-0">
                    <p className="font-semibold">{z.name}{!z.is_active && <span className="ml-2 font-normal text-muted">(не активна)</span>}</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {required.length
                        ? required.map((r) => <RiskChip key={r.id} risk="low">{ppeInfo(r.code).ppe}</RiskChip>)
                        : <span className="text-[13px] text-muted">Обязательные СИЗ не заданы</span>}
                    </div>
                  </div>
                )
              })}
            </Card>
          )
        })}
      </div>
    </>
  )
}
