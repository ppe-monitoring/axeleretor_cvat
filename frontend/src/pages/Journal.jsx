
import { useState } from 'react'
import PageHeader from '../components/PageHeader'
import DataTable from '../components/DataTable'
import RiskChip from '../components/RiskChip'
import Button from '../components/Button'
import { useCameras, useSetViolationStatus, useViolations, useZones } from '../api/hooks'
import { STATUS_LABEL, violationToRow } from '../api/adapters'
import { CODES, ppeInfo } from '../data/ppeClasses'

const selectCls =
  'min-h-11 rounded-lg border border-line bg-white px-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink'

export default function Journal() {
  const [filters, setFilters] = useState({ camera: '', code: '', status: '' })
  const [page, setPage] = useState(1)
  const set = (k) => (e) => { setFilters((f) => ({ ...f, [k]: e.target.value })); setPage(1) }

  const viol = useViolations({ page, ...filters })
  const cams = useCameras()
  const zones = useZones()
  const setStatus = useSetViolationStatus()

  const camerasById = Object.fromEntries((cams.data ?? []).map((c) => [c.id, c]))
  const zonesById = Object.fromEntries((zones.data ?? []).map((z) => [z.id, z]))

  const columns = [
    { key: 'frame', header: 'Кадр', render: () => <div className="h-10 w-16 rounded-md bg-ink-800" aria-hidden="true" /> },
    { key: 'time', header: 'Начало' },
    { key: 'duration', header: 'Длительность' },
    { key: 'trackId', header: 'ID', render: (r) => (r.trackId != null ? `#${r.trackId}` : '—') },
    { key: 'employee', header: 'Сотрудник' },
    { key: 'place', header: 'Камера · зона' },
    { key: 'ppe', header: 'СИЗ' },
    { key: 'risk', header: 'Риск', render: (r) => <RiskChip risk={r.risk} /> },
    { key: 'confidence', header: 'Уверенность' },
    { key: 'status', header: 'Статус', render: (r) => STATUS_LABEL[r.status] ?? r.status },
    {
      key: 'actions', header: '',
      render: (r) => r.status === 'new' && (
        <div className="flex gap-2">
          <Button disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: r.id, status: 'confirmed' })}>Подтвердить</Button>
          <Button variant="secondary" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: r.id, status: 'false_positive' })}>Ложное</Button>
        </div>
      ),
    },
  ]

  return (
    <>
      <PageHeader title="Журнал событий" />
      <div className="flex flex-wrap gap-2">
        <select className={selectCls} value={filters.camera} onChange={set('camera')} aria-label="Камера">
          <option value="">Все камеры</option>
          {(cams.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className={selectCls} value={filters.code} onChange={set('code')} aria-label="Тип СИЗ">
          <option value="">Все типы СИЗ</option>
          {CODES.map((c) => <option key={c} value={c}>{ppeInfo(c).ppe}</option>)}
        </select>
        <select className={selectCls} value={filters.status} onChange={set('status')} aria-label="Статус">
          <option value="">Все статусы</option>
          {Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
      {viol.isPending && <p className="text-muted">Загрузка…</p>}
      {viol.isError && <p className="text-risk-high-fg">Не удалось загрузить журнал</p>}
      {setStatus.isError && <p className="text-risk-high-fg">Не удалось сменить статус</p>}
      {viol.data && (
        <>
          <DataTable columns={columns} minWidth={1100}
                     rows={viol.data.results.map((v) => violationToRow(v, camerasById, zonesById))} />
          <div className="flex items-center justify-between text-[13px] text-muted">
            <span>Всего: {viol.data.count}</span>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={!viol.data.previous} onClick={() => setPage((p) => p - 1)}>Назад</Button>
              <Button variant="secondary" disabled={!viol.data.next} onClick={() => setPage((p) => p + 1)}>Вперёд</Button>
            </div>
          </div>
        </>
      )}
    </>
  )
}