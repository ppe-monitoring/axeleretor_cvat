// Коды = PPERule.Code на бэкенде (NO_HELMET, NO_VEST, NO_GLOVES).
// Риск на бэкенде не хранится, поэтому задан здесь — подправьте под вашу политику.
const RULES = {
  'no-helmet': { label: 'Нет каски', ppe: 'Каска', risk: 'high' },
  'no-vest': { label: 'Нет жилета', ppe: 'Жилет', risk: 'mid' },
  'no-gloves': { label: 'Нет перчаток', ppe: 'Перчатки', risk: 'low' },
}
export const CODES = ['NO_HELMET', 'NO_VEST', 'NO_GLOVES']

const norm = (code = '') => code.trim().toLowerCase().replace(/[\s_]+/g, '-')

export function ppeInfo(code) {
  return RULES[norm(code)] ?? { label: code || 'Неизвестно', ppe: code || '—', risk: 'mid' }
}
