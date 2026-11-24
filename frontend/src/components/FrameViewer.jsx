import { useEffect, useRef, useState } from 'react'
import Button from './Button'
import { useVideo } from '../api/hooks'
import { bboxToPercent, fmtDateTime } from '../api/adapters'
import { ppeInfo } from '../data/ppeClasses'

function paintBox(ctx, v, sx, sy, canvasW) {
  const x = v.bbox_x1 * sx, y = v.bbox_y1 * sy
  const w = (v.bbox_x2 - v.bbox_x1) * sx, h = (v.bbox_y2 - v.bbox_y1) * sy
  const lw = Math.max(3, canvasW / 300)
  ctx.lineWidth = lw
  ctx.strokeStyle = '#D92D20'
  ctx.strokeRect(x, y, w, h)
  const label = `ID ${v.track_id ?? '—'} · ${ppeInfo(v.code).label}`
  const fs = Math.max(14, canvasW / 60)
  ctx.font = `600 ${fs}px sans-serif`
  const tw = ctx.measureText(label).width + 12
  const ly = Math.max(0, y - fs - 8)
  ctx.fillStyle = '#B42318'
  ctx.fillRect(x - lw / 2, ly, tw, fs + 8)
  ctx.fillStyle = '#fff'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, x + 6 - lw / 2, ly + (fs + 8) / 2)
}

/** Достаёт кадр из исходного видео (video.currentTime = кадр / fps) и рисует его на canvas. */
function VideoFrame({ video, violation, which }) {
  const ref = useRef(null)
  const [state, setState] = useState('loading')

  useEffect(() => {
    const canvas = ref.current
    const frame = which === 'last' ? violation.last_frame_number : violation.frame_number
    if (!canvas || frame == null) { setState('error'); return }
    setState('loading')
    const ctx = canvas.getContext('2d')
    const withBox = which === 'first' // bbox на бэке хранится только для первого кадра
    const sw = violation.frame_width, sh = violation.frame_height

    if (video.file?.startsWith('mock:')) { // демо-режим: рисуем условный кадр
      canvas.width = 1280; canvas.height = 720
      const g = ctx.createLinearGradient(0, 0, 1280, 720)
      g.addColorStop(0, '#2B2B2B'); g.addColorStop(1, '#4A4A4A')
      ctx.fillStyle = g; ctx.fillRect(0, 0, 1280, 720)
      ctx.fillStyle = '#C9C9C9'; ctx.font = '28px sans-serif'; ctx.textBaseline = 'top'
      ctx.fillText(`Демо-кадр №${frame}`, 24, 20)
      if (withBox && sw && sh) paintBox(ctx, violation, 1280 / sw, 720 / sh, 1280)
      setState('ready')
      return
    }

    const el = document.createElement('video')
    el.muted = true
    el.preload = 'auto'
    el.playsInline = true
    const fail = () => setState('error')
    el.addEventListener('error', fail)
    el.addEventListener('loadedmetadata', () => {
      const t = frame / (video.fps || 25)
      el.currentTime = Math.min(t, Math.max(0, (el.duration || t) - 0.05))
    })
    el.addEventListener('seeked', () => {
      canvas.width = el.videoWidth
      canvas.height = el.videoHeight
      ctx.drawImage(el, 0, 0)
      if (withBox) paintBox(ctx, violation, el.videoWidth / (sw ?? el.videoWidth), el.videoHeight / (sh ?? el.videoHeight), el.videoWidth)
      setState('ready')
    }, { once: true })
    el.src = video.file
    return () => { el.removeEventListener('error', fail); el.removeAttribute('src'); el.load() }
  }, [video.file, video.fps, violation, which])

  return (
    <div>
      <canvas ref={ref} className="min-h-40 w-full rounded-lg bg-ink-800" />
      {state === 'loading' && <p className="mt-2 text-muted">Загрузка кадра…</p>}
      {state === 'error' && (
        <p role="alert" className="mt-2 text-risk-high-fg">
          Не удалось получить кадр: видеофайл недоступен по адресу /media или не поддерживает перемотку.
        </p>
      )}
    </div>
  )
}

export default function FrameViewer({ violation: v, camera, zone }) {
  const video = useVideo(v.video)
  const [which, setWhich] = useState('first')
  const box = bboxToPercent(v)
  const rows = [
    ['Нарушение', ppeInfo(v.code).label],
    ['Камера', camera?.name ?? `#${v.camera}`],
    ['Зона', zone?.name ?? '—'],
    ['Начало', fmtDateTime(v.timestamp)],
    ['Конец', fmtDateTime(v.ended_at)],
    ['ID трека', v.track_id ?? '—'],
    ['Уверенность', v.confidence != null ? `${Math.round(v.confidence * 100)}%` : '—'],
    ['Кадры', `${v.frame_number ?? '—'} – ${v.last_frame_number ?? '—'}`],
  ]

  return (
    <>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        {rows.map(([k, val]) => (
          <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd>{val}</dd></div>
        ))}
      </dl>

      {v.video != null ? (
        <>
          {video.isPending && <p className="text-muted">Загрузка данных видео…</p>}
          {video.isError && <p role="alert" className="text-risk-high-fg">Не удалось загрузить сведения о видео.</p>}
          {video.data && (
            <>
              <div className="flex flex-wrap gap-2">
                <Button variant={which === 'first' ? 'primary' : 'secondary'} onClick={() => setWhich('first')}>
                  Начало (кадр {v.frame_number ?? '—'})
                </Button>
                <Button variant={which === 'last' ? 'primary' : 'secondary'} onClick={() => setWhich('last')}>
                  Конец (кадр {v.last_frame_number ?? '—'})
                </Button>
              </div>
              <VideoFrame video={video.data} violation={v} which={which} />
              <p className="text-[13px] text-muted">
                Рамка показана только на первом кадре: бэкенд хранит положение человека в момент начала нарушения.
              </p>
            </>
          )}
        </>
      ) : (
        <>
          <p className="rounded-lg bg-risk-mid-bg p-3 text-risk-mid-fg">
            Стоп-кадра нет: нарушение пришло с потока, а бэкенд не сохраняет кадры. Ниже схема положения человека в кадре.
          </p>
          {box ? (
            <div className="relative w-full rounded-lg bg-ink-800"
                 style={{ aspectRatio: `${v.frame_width} / ${v.frame_height}` }}>
              <div className="absolute border-2 border-risk-high-fg"
                   style={{ left: `${box.x}%`, top: `${box.y}%`, width: `${box.w}%`, height: `${box.h}%` }} />
            </div>
          ) : <p className="text-muted">Нет данных о размере кадра и рамке.</p>}
        </>
      )}
    </>
  )
}
