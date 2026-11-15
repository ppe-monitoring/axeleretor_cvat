import PageHeader from '../components/PageHeader'
import CameraTile from '../components/CameraTile'
import { useCameras, useViolations } from '../api/hooks'
import { cameraToTile } from '../api/adapters'

export default function Cameras() {
  const cams = useCameras()
  const viol = useViolations() // первая страница, новые первыми (по timestamp)

  if (cams.isPending) return <p className="text-muted">Загрузка камер…</p>
  if (cams.isError) return <p className="text-risk-high-fg">Не удалось загрузить камеры</p>

  return (
    <>
      <PageHeader title="Камеры в реальном времени" filters={['Сетка 2×2', 'Все зоны']} actionLabel="Добавить камеру" />
      {viol.isError && (
        <p className="text-risk-mid-fg">Нарушения не загрузились — рамки на кадрах не показаны.</p>
      )}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4">
        {cams.data.map((c) => (
          <CameraTile key={c.id} {...cameraToTile(c, viol.data?.results ?? [])} />
        ))}
      </div>
    </>
  )
}