import { useId } from 'react'
import { useAuth } from './AuthContext'
import { ROLES, ROLE_ORDER } from './roles'

export default function RoleSwitcher() {
  const id = useId()
  const { role, setRole } = useAuth()
  return (
    <div className="px-2">
      <label htmlFor={id} className="block text-[12px]">Роль (демо)</label>
      <select id={id} value={role} onChange={(e) => setRole(e.target.value)}
              className="mt-1 min-h-11 w-full rounded-lg border border-ink-700 bg-ink-800 px-2 text-white focus-visible:outline-2 focus-visible:outline-brand">
        {ROLE_ORDER.map((r) => <option key={r} value={r}>{ROLES[r].label}</option>)}
      </select>
    </div>
  )
}
