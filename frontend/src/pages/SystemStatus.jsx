import PageHeader from '../components/PageHeader'
import KpiCard from '../components/KpiCard'
import Card from '../components/Card'
import AlertList from '../components/AlertList'
import { useCameras } from '../api/hooks'
import { relativeTime } from '../utils/camera'

export default function SystemStatus() {
  const cams = useCameras()
  if (cams.isPending) return <p className="text-muted">Загрузка…</p>
  if (cams.isError) return <p className="text-risk-high-fg">Не удалось загрузить данные. Проверьте, что бэкенд запущен.</p>

  const active = cams.data.filter((c) => c.is_active)
  const online = active.filter((c) => c.ml_online)
  const silent = active.filter((c) => !c.ml_online)

  return (
    <>
      <PageHeader title="Состояние системы" />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
        <KpiCard label="Камер всего" value={cams.data.length} delta={`активных: ${active.length}`} />
        <KpiCard label="ML онлайн" value={`${online.length} из ${active.length}`} delta="сводка за последние 3 мин" tone={silent.length ? 'neutral' : 'ok'} />
        <KpiCard label="Без данных ML" value={silent.length} delta={silent.length ? 'нужна проверка' : 'всё в порядке'} tone={silent.length ? 'high' : 'ok'} />
        <KpiCard label="Отключены" value={cams.data.length - active.length} delta="выключены вручную" />
      </div>
      <Card title="Камеры без данных ML">
        {silent.length ? (
          <AlertList items={silent.map((c) => ({
            risk: 'high',
            title: c.location ? `${c.name} · ${c.location}` : c.name,
            meta: c.ml_last_seen ? `Последняя сводка ${relativeTime(c.ml_last_seen)}` : 'ML ещё не подключался',
          }))} />
        ) : <p className="text-muted">Все активные камеры присылают данные.</p>}
      </Card>
      <p className="text-[13px] text-muted">
        Загрузка серверов (CPU, GPU, диск), очередь обработки и журнал ошибок пока не отдаются бэкендом.
      </p>
    </>
  )
}
