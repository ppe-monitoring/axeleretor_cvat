import { useState } from 'react'
import Button from './Button'
import Card from './Card'
import { CheckboxField, TextField } from './Field'
import { useDeleteZone, useSaveZone, useSetZoneRule, useZones } from '../api/hooks'
import { parseApiError } from '../api/client'
import { CODES, ppeInfo } from '../data/ppeClasses'

function ZoneCard({ zone }) {
  const [name, setName] = useState(zone.name)
  const save = useSaveZone()
  const del = useDeleteZone()
  const rule = useSetZoneRule()
  const error = [save, del, rule].map((m) => m.error).find(Boolean)
  const hasRules = zone.rules.some((r) => r.is_active)

  return (
    <Card>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1">
          <TextField label="Название зоны" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <Button variant="secondary" disabled={!name.trim() || name.trim() === zone.name || save.isPending}
                onClick={() => save.mutate({ id: zone.id, data: { name: name.trim() } })}>Сохранить</Button>
      </div>

      <CheckboxField label="Зона активна" checked={zone.is_active} disabled={save.isPending}
                     onChange={(e) => save.mutate({ id: zone.id, data: { is_active: e.target.checked } })} />

      <fieldset className="mt-2 border-t border-line pt-3">
        <legend className="mb-1 text-[13px] font-semibold">Обязательные СИЗ</legend>
        {CODES.map((code) => {
          const r = zone.rules.find((x) => x.code === code)
          const checked = !!r?.is_active
          return (
            <CheckboxField key={code} label={ppeInfo(code).ppe} checked={checked} disabled={rule.isPending}
                           onChange={() => rule.mutate({ zone: zone.id, code, enabled: !checked, rule: r })} />
          )
        })}
      </fieldset>

      {zone.is_active && !hasRules && (
        <p className="mt-2 rounded-lg bg-risk-mid-bg p-3 text-risk-mid-fg">
          Не выбрано ни одного обязательного СИЗ: ML не сможет присылать нарушения для этой зоны.
        </p>
      )}
      {error && <p role="alert" className="mt-2 text-risk-high-fg">{parseApiError(error).message}</p>}

      <div className="mt-2">
        <Button variant="secondary" disabled={del.isPending}
                onClick={() => window.confirm(`Удалить зону «${zone.name}»? Нарушения сохранятся, но потеряют привязку к зоне.`) && del.mutate(zone.id)}>
          Удалить зону
        </Button>
      </div>
    </Card>
  )
}

export default function ZonePanel({ camera }) {
  const zones = useZones()
  const create = useSaveZone()
  const [name, setName] = useState('')
  const mine = (zones.data ?? []).filter((z) => z.camera === camera.id)

  function add(e) {
    e.preventDefault()
    if (!name.trim()) return
    create.mutate({ data: { camera: camera.id, name: name.trim(), is_active: true } }, { onSuccess: () => setName('') })
  }

  return (
    <>
      <p className="text-muted">Камера «{camera.name}». ML принимает нарушения только для активной зоны камеры и только по СИЗ, отмеченным ниже.</p>
      {zones.isPending && <p className="text-muted">Загрузка зон…</p>}
      {zones.isError && <p className="text-risk-high-fg">Не удалось загрузить зоны</p>}
      {zones.data && !mine.some((z) => z.is_active) && (
        <p className="rounded-lg bg-risk-mid-bg p-3 text-risk-mid-fg">У камеры нет активной зоны: события от ML будут отклонены.</p>
      )}
      {mine.map((z) => <ZoneCard key={z.id} zone={z} />)}

      <Card title="Новая зона">
        <form onSubmit={add} className="flex flex-wrap items-end gap-2" noValidate>
          <div className="min-w-48 flex-1"><TextField label="Название" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <Button type="submit" disabled={!name.trim() || create.isPending}>Добавить зону</Button>
        </form>
        {create.isError && <p role="alert" className="mt-2 text-risk-high-fg">{parseApiError(create.error).message}</p>}
      </Card>
    </>
  )
}
