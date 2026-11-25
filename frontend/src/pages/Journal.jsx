import { useState } from 'react'
import PageHeader from '../components/PageHeader'
import DataTable from '../components/DataTable'
import RiskChip from '../components/RiskChip'
import Button from '../components/Button'
import Drawer from '../components/Drawer'
import FrameViewer from '../components/FrameViewer'
import { SelectField, TextField } from '../components/Field'
import { useCameras, useSetViolationStatus, useViolations, useZones } from '../api/hooks'
import { STATUS_LABEL, violationToRow } from '../api/adapters'
import { useAuth } from '../auth/AuthContext'
import { CODES, ppeInfo } from '../data/ppeClasses'

const EMPTY = { camera: '', zone: '', code: '', status: '', dateFrom: '', dateTo: '' }
// даты в браузере локальные: «с» — начало дня, «по» — конец дня
const dayStart = (d) => (d ? new Date(`${d}T00:00:00`).toISOString() : '')
const dayEnd = (d) => (d ? new Date(`${d}T23:59:59.999`).toISOString() : '')

export default function Journal() {
  const { can } = useAuth()
  const [filters, setFilters] = useState(EMPTY)
  const [page, setPage] = useState(1)
  const [frameFor, setFrameFor] = useState(null) // нарушение, чей стоп-кадр открыт

  const set = (k) => (e) => {
    const value = e.target.value
    // смена камеры сбрасывает зону: зоны принадлежат камере
    setFilters((f) => ({ ...f, [k]: value, ...(k === 'camera' ? { zone: '' } : {}) }))
    setPage(1)
  }
  const reset = () => { setFilters(EMPTY); setPage(1) }
  const isFiltered = Object.values(filters).some(Boolean)
  const badRange = filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo

  const viol = useViolations({
    page, camera: filters.camera, zone: filters.zone, code: filters.code, status: filters.status,
    date_from: dayStart(filters.dateFrom), date_to: dayEnd(filters.dateTo),
  })
  const cams = useCameras()
  const zones = useZones()
  const setStatus = useSetViolationStatus()

  const camerasById = Object.fromEntries((cams.data ?? []).map((c) => [c.id, c]))
  const zonesById = Object.fromEntries((zones.data ?? []).map((z) => [z.id, z]))
  const zoneOptions = (zones.data ?? []).filter((z) => !filters.camera || String(z.camera) === filters.camera)

  const columns = [
    { key: 'frame', header: 'Кадр', render: (r) => (
        <Button variant="secondary" onClick={() => setFrameFor(r.raw)}>Кадр</Button>) },
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
  ].filter((c) => !(c.key === 'frame' && !can('frames.view')) && !(c.key === 'actions' && !can('violations.review')))

  return (
    <>
      <PageHeader title="Журнал событий" />

      <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] items-start gap-3">
        <TextField label="С даты" type="date" value={filters.dateFrom} max={filters.dateTo || undefined} onChange={set('dateFrom')} />
        <TextField label="По дату" type="date" value={filters.dateTo} min={filters.dateFrom || undefined} onChange={set('dateTo')} />
        <SelectField label="Камера" value={filters.camera} onChange={set('camera')}>
          <option value="">Все камеры</option>
          {(cams.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </SelectField>
        <SelectField label="Зона" value={filters.zone} onChange={set('zone')}>
          <option value="">Все зоны</option>
          {zoneOptions.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
        </SelectField>
        <SelectField label="Тип СИЗ" value={filters.code} onChange={set('code')}>
          <option value="">Все типы</option>
          {CODES.map((c) => <option key={c} value={c}>{ppeInfo(c).ppe}</option>)}
        </SelectField>
        <SelectField label="Статус" value={filters.status} onChange={set('status')}>
          <option value="">Все статусы</option>
          {Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </SelectField>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {isFiltered && <Button variant="secondary" onClick={reset}>Сбросить фильтры</Button>}
        {badRange && <p role="alert" className="text-risk-mid-fg">Дата «С» позже даты «По»: записей не будет.</p>}
      </div>

      {viol.isPending && <p className="text-muted">Загрузка…</p>}
      {viol.isError && <p className="text-risk-high-fg">Не удалось загрузить журнал</p>}
      {setStatus.isError && <p className="text-risk-high-fg">Не удалось сменить статус</p>}
      {viol.data && (
        <>
          <DataTable columns={columns} minWidth={1100}
                     rows={viol.data.results.map((v) => violationToRow(v, camerasById, zonesById))} />
          {viol.data.count === 0 && <p className="text-muted">По выбранным фильтрам нарушений нет.</p>}
          <div className="flex items-center justify-between text-[13px] text-muted">
            <span>Всего: {viol.data.count}</span>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={!viol.data.previous} onClick={() => setPage((p) => p - 1)}>Назад</Button>
              <Button variant="secondary" disabled={!viol.data.next} onClick={() => setPage((p) => p + 1)}>Вперёд</Button>
            </div>
          </div>
        </>
      )}

      {can('frames.view') && (
      <Drawer open={!!frameFor} onClose={() => setFrameFor(null)}
              title={frameFor ? `Стоп-кадр · нарушение #${frameFor.id}` : 'Стоп-кадр'}>
        {frameFor && (
          <FrameViewer violation={frameFor} camera={camerasById[frameFor.camera]} zone={zonesById[frameFor.zone]} />
        )}
      </Drawer>
      )}
    </>
  )
}
// import { useState } from 'react'
// import PageHeader from '../components/PageHeader'
// import DataTable from '../components/DataTable'
// import RiskChip from '../components/RiskChip'
// import Button from '../components/Button'
// import Drawer from '../components/Drawer'
// import FrameViewer from '../components/FrameViewer'
// import { SelectField, TextField } from '../components/Field'
// import { useCameras, useSetViolationStatus, useViolations, useZones } from '../api/hooks'
// import { STATUS_LABEL, violationToRow } from '../api/adapters'
// import { CODES, ppeInfo } from '../data/ppeClasses'

// const EMPTY = { camera: '', zone: '', code: '', status: '', dateFrom: '', dateTo: '' }
// // даты в браузере локальные: «с» — начало дня, «по» — конец дня
// const dayStart = (d) => (d ? new Date(`${d}T00:00:00`).toISOString() : '')
// const dayEnd = (d) => (d ? new Date(`${d}T23:59:59.999`).toISOString() : '')

// export default function Journal() {
//   const [filters, setFilters] = useState(EMPTY)
//   const [page, setPage] = useState(1)
//   const [frameFor, setFrameFor] = useState(null) // нарушение, чей стоп-кадр открыт

//   const set = (k) => (e) => {
//     const value = e.target.value
//     // смена камеры сбрасывает зону: зоны принадлежат камере
//     setFilters((f) => ({ ...f, [k]: value, ...(k === 'camera' ? { zone: '' } : {}) }))
//     setPage(1)
//   }
//   const reset = () => { setFilters(EMPTY); setPage(1) }
//   const isFiltered = Object.values(filters).some(Boolean)
//   const badRange = filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo

//   const viol = useViolations({
//     page, camera: filters.camera, zone: filters.zone, code: filters.code, status: filters.status,
//     date_from: dayStart(filters.dateFrom), date_to: dayEnd(filters.dateTo),
//   })
//   const cams = useCameras()
//   const zones = useZones()
//   const setStatus = useSetViolationStatus()

//   const camerasById = Object.fromEntries((cams.data ?? []).map((c) => [c.id, c]))
//   const zonesById = Object.fromEntries((zones.data ?? []).map((z) => [z.id, z]))
//   const zoneOptions = (zones.data ?? []).filter((z) => !filters.camera || String(z.camera) === filters.camera)

//   const columns = [
//     { key: 'frame', header: 'Кадр', render: (r) => (
//         <Button variant="secondary" onClick={() => setFrameFor(r.raw)}>Кадр</Button>) },
//     { key: 'time', header: 'Начало' },
//     { key: 'duration', header: 'Длительность' },
//     { key: 'trackId', header: 'ID', render: (r) => (r.trackId != null ? `#${r.trackId}` : '—') },
//     { key: 'employee', header: 'Сотрудник' },
//     { key: 'place', header: 'Камера · зона' },
//     { key: 'ppe', header: 'СИЗ' },
//     { key: 'risk', header: 'Риск', render: (r) => <RiskChip risk={r.risk} /> },
//     { key: 'confidence', header: 'Уверенность' },
//     { key: 'status', header: 'Статус', render: (r) => STATUS_LABEL[r.status] ?? r.status },
//     {
//       key: 'actions', header: '',
//       render: (r) => r.status === 'new' && (
//         <div className="flex gap-2">
//           <Button disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: r.id, status: 'confirmed' })}>Подтвердить</Button>
//           <Button variant="secondary" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: r.id, status: 'false_positive' })}>Ложное</Button>
//         </div>
//       ),
//     },
//   ]

//   return (
//     <>
//       <PageHeader title="Журнал событий" />

//       <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] items-start gap-3">
//         <TextField label="С даты" type="date" value={filters.dateFrom} max={filters.dateTo || undefined} onChange={set('dateFrom')} />
//         <TextField label="По дату" type="date" value={filters.dateTo} min={filters.dateFrom || undefined} onChange={set('dateTo')} />
//         <SelectField label="Камера" value={filters.camera} onChange={set('camera')}>
//           <option value="">Все камеры</option>
//           {(cams.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
//         </SelectField>
//         <SelectField label="Зона" value={filters.zone} onChange={set('zone')}>
//           <option value="">Все зоны</option>
//           {zoneOptions.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
//         </SelectField>
//         <SelectField label="Тип СИЗ" value={filters.code} onChange={set('code')}>
//           <option value="">Все типы</option>
//           {CODES.map((c) => <option key={c} value={c}>{ppeInfo(c).ppe}</option>)}
//         </SelectField>
//         <SelectField label="Статус" value={filters.status} onChange={set('status')}>
//           <option value="">Все статусы</option>
//           {Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
//         </SelectField>
//       </div>
//       <div className="flex flex-wrap items-center gap-3">
//         {isFiltered && <Button variant="secondary" onClick={reset}>Сбросить фильтры</Button>}
//         {badRange && <p role="alert" className="text-risk-mid-fg">Дата «С» позже даты «По»: записей не будет.</p>}
//       </div>

//       {viol.isPending && <p className="text-muted">Загрузка…</p>}
//       {viol.isError && <p className="text-risk-high-fg">Не удалось загрузить журнал</p>}
//       {setStatus.isError && <p className="text-risk-high-fg">Не удалось сменить статус</p>}
//       {viol.data && (
//         <>
//           <DataTable columns={columns} minWidth={1100}
//                      rows={viol.data.results.map((v) => violationToRow(v, camerasById, zonesById))} />
//           {viol.data.count === 0 && <p className="text-muted">По выбранным фильтрам нарушений нет.</p>}
//           <div className="flex items-center justify-between text-[13px] text-muted">
//             <span>Всего: {viol.data.count}</span>
//             <div className="flex gap-2">
//               <Button variant="secondary" disabled={!viol.data.previous} onClick={() => setPage((p) => p - 1)}>Назад</Button>
//               <Button variant="secondary" disabled={!viol.data.next} onClick={() => setPage((p) => p + 1)}>Вперёд</Button>
//             </div>
//           </div>
//         </>
//       )}

//       <Drawer open={!!frameFor} onClose={() => setFrameFor(null)}
//               title={frameFor ? `Стоп-кадр · нарушение #${frameFor.id}` : 'Стоп-кадр'}>
//         {frameFor && (
//           <FrameViewer violation={frameFor} camera={camerasById[frameFor.camera]} zone={zonesById[frameFor.zone]} />
//         )}
//       </Drawer>
//     </>
//   )
// }