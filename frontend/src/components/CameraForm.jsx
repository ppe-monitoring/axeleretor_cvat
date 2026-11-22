import { useState } from 'react'
import Button from './Button'
import { CheckboxField, SelectField, TextField } from './Field'
import { useDeleteCamera, useSaveCamera } from '../api/hooks'
import { parseApiError } from '../api/client'
import { SOURCE_TYPES, validateCamera } from '../utils/camera'

const EMPTY = { name: '', location: '', source_type: 'rtp', source_uri: '', is_active: true }

export default function CameraForm({ camera, onDone }) {
  const [form, setForm] = useState(
    camera
      ? { name: camera.name, location: camera.location ?? '', source_type: camera.source_type,
          source_uri: camera.source_uri ?? '', is_active: camera.is_active }
      : EMPTY,
  )
  const [errors, setErrors] = useState({})
  const [message, setMessage] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const save = useSaveCamera()
  const del = useDeleteCamera()
  const isRtp = form.source_type === 'rtp'

  const set = (k) => (e) =>
    setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  function submit(e) {
    e.preventDefault()
    const v = validateCamera(form)
    setErrors(v)
    setMessage('')
    if (Object.keys(v).length) return
    save.mutate(
      { id: camera?.id, data: { ...form, name: form.name.trim(), source_uri: form.source_uri.trim() } },
      { onSuccess: onDone, onError: (err) => { const p = parseApiError(err); setErrors(p.fields); setMessage(p.message) } },
    )
  }

  function remove() {
    del.mutate(camera.id, { onSuccess: onDone, onError: (err) => setMessage(parseApiError(err).message) })
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <TextField label="Название" value={form.name} onChange={set('name')} error={errors.name} autoFocus />
      <TextField label="Расположение" value={form.location} onChange={set('location')} error={errors.location}
                 hint="Например: Склад Б, Погрузка" />
      <SelectField label="Источник" value={form.source_type} onChange={set('source_type')} error={errors.source_type}>
        {SOURCE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
      </SelectField>
      <TextField
        label={isRtp ? 'RTSP-адрес' : 'Путь к файлу'}
        value={form.source_uri} onChange={set('source_uri')} error={errors.source_uri}
        placeholder={isRtp ? 'rtsp://192.168.1.10:554/stream1' : '/data/video/cam1.mp4'}
        hint={isRtp ? 'Логин и пароль в адресе хранятся на сервере открытым текстом.' : undefined}
        spellCheck={false} autoComplete="off"
      />
      <CheckboxField label="Камера включена" checked={form.is_active} onChange={set('is_active')} />

      {message && <p role="alert" className="rounded-lg bg-risk-high-bg p-3 text-risk-high-fg">{message}</p>}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Сохранение…' : 'Сохранить'}</Button>
        <Button type="button" variant="secondary" onClick={onDone}>Отмена</Button>
      </div>

      {camera && (
        <div className="border-t border-line pt-4">
          {!confirmDelete ? (
            <Button type="button" variant="secondary" onClick={() => setConfirmDelete(true)}>Удалить камеру…</Button>
          ) : (
            <div className="rounded-lg border border-risk-high-fg bg-risk-high-bg p-3">
              <p className="mb-3 text-risk-high-fg">
                Будут удалены камера, её зоны, правила СИЗ и <b>все нарушения этой камеры</b>. Отменить нельзя.
                Если камера просто не нужна сейчас, снимите галочку «Камера включена».
              </p>
              <div className="flex gap-2">
                <Button type="button" onClick={remove} disabled={del.isPending}>Да, удалить всё</Button>
                <Button type="button" variant="secondary" onClick={() => setConfirmDelete(false)}>Отмена</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </form>
  )
}
