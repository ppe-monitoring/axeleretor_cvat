// Смены на бэкенде не заданы — границы определены здесь. Подправьте под график предприятия.
// Час берётся по времени браузера; сервер работает в Europe/Moscow.
export const SHIFTS = [
  { key: 'night', label: 'Ночная', range: '00:00–08:00', from: 0, to: 8 },
  { key: 'day', label: 'Дневная', range: '08:00–16:00', from: 8, to: 16 },
  { key: 'evening', label: 'Вечерняя', range: '16:00–24:00', from: 16, to: 24 },
]

export const shiftOf = (hour) => SHIFTS.find((s) => hour >= s.from && hour < s.to)
