import { useState } from 'react'
import PageHeader from '../components/PageHeader'
import DataTable from '../components/DataTable'
import RiskChip from '../components/RiskChip'
import Button from '../components/Button'
import Drawer from '../components/Drawer'
import CameraForm from '../components/CameraForm'
import ZonePanel from '../components/ZonePanel'
import { useCameras, useZones } from '../api/hooks'
import { SOURCE_TYPES, maskUri, relativeTime } from '../utils/camera'

function ConnectionStatus({ cam }) {
  if (!cam.is_active) return <RiskChip risk="none">Отключена</RiskChip>
  if (cam.ml_online) return <RiskChip risk="low">ML онлайн</RiskChip>
  return (
    <>
      <RiskChip risk="none">Нет данных</RiskChip>
      <span className="mt-0.5 block text-[13px] text-muted">
        {cam.ml_last_seen ? `ML был ${relativeTime(cam.ml_last_seen)}` : 'ML ещё не подключался'}
      </span>
    </>
  )
}

export default function CameraManagement() {
  const cams = useCameras()
  const zones = useZones()
  const [panel, setPanel] = useState(null) // { type: 'camera', camera|null } | { type: 'zones', id }
  const close = () => setPanel(null)

  const zonesOf = (id) => (zones.data ?? []).filter((z) => z.camera === id)
  const zoneCamera = panel?.type === 'zones' ? cams.data?.find((c) => c.id === panel.id) : null

  const columns = [
    { key: 'name', header: 'Камера', render: (c) => <><b>{c.name}</b><span className="block text-[13px] text-muted">{c.location || '—'}</span></> },
    { key: 'source', header: 'Источник', render: (c) => (
        <>
          <span className="block text-[13px] text-muted">{SOURCE_TYPES.find((t) => t.value === c.source_type)?.label}</span>
          <span className="break-all font-mono text-[13px]">{maskUri(c.source_uri) || '—'}</span>
        </>) },
    { key: 'status', header: 'Подключение', render: (c) => <ConnectionStatus cam={c} /> },
    { key: 'zones', header: 'Зоны', render: (c) => {
        const list = zonesOf(c.id)
        if (!zones.data) return '…'
        return list.some((z) => z.is_active)
          ? `${list.length}`
          : <RiskChip risk="mid">Нет активных зон</RiskChip>
      } },
    { key: 'actions', header: '', render: (c) => (
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setPanel({ type: 'camera', camera: c })}>Изменить</Button>
          <Button variant="secondary" onClick={() => setPanel({ type: 'zones', id: c.id })}>Зоны и СИЗ</Button>
        </div>) },
  ]

  return (
    <>
      <PageHeader title="Управление камерами" actionLabel="Добавить камеру"
                  onAction={() => setPanel({ type: 'camera', camera: null })} />
      {cams.isPending && <p className="text-muted">Загрузка…</p>}
      {cams.isError && <p className="text-risk-high-fg">Не удалось загрузить камеры. Проверьте, что бэкенд запущен.</p>}
      {cams.data && <DataTable columns={columns} rows={cams.data} minWidth={900} />}
      <p className="text-[13px] text-muted">
        «ML онлайн» значит, что ML присылал сводку за последние 3 минуты. Прямую проверку RTSP-соединения бэкенд пока не выполняет.
      </p>

      <Drawer open={panel?.type === 'camera'} onClose={close}
              title={panel?.camera ? 'Изменить камеру' : 'Новая камера'}>
        {panel?.type === 'camera' && <CameraForm camera={panel.camera} onDone={close} />}
      </Drawer>
      <Drawer open={!!zoneCamera} onClose={close} title="Зоны и обязательные СИЗ">
        {zoneCamera && <ZonePanel camera={zoneCamera} />}
      </Drawer>
    </>
  )
}
