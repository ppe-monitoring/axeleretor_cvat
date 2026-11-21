export const SOURCE_TYPES = [
  { value: 'rtp', label: 'RTSP/RTP-поток' },
  { value: 'file', label: 'Видеофайл' },
]

/** rtsp://user:pass@host → rtsp://user:***@host (в таблице пароль не показываем). */
export const maskUri = (uri = '') => uri.replace(/(\/\/[^:/@\s]+):[^@\s]*@/, '$1:***@')

export function relativeTime(iso) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'только что'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} мин назад`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h} ч назад` : `${Math.floor(h / 24)} дн. назад`
}

/** Возвращает { поле: 'текст ошибки' }. Пустой объект — всё в порядке. */
export function validateCamera(f) {
  const e = {}
  if (!f.name.trim()) e.name = 'Укажите название'
  else if (f.name.length > 100) e.name = 'Не длиннее 100 символов'
  if (f.location.length > 200) e.location = 'Не длиннее 200 символов'
  const uri = f.source_uri.trim()
  if (f.source_type === 'rtp') {
    if (!uri) e.source_uri = 'Укажите адрес потока'
    else if (!/^(rtsp|rtsps|rtp):\/\/\S+$/i.test(uri))
      e.source_uri = 'Адрес должен начинаться с rtsp:// (или rtsps://, rtp://) и не содержать пробелов'
  }
  if (uri.length > 500) e.source_uri = 'Не длиннее 500 символов'
  return e
}
