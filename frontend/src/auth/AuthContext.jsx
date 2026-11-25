import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { ROLES, hasPermission } from './roles'

// ВРЕМЕННО: на бэкенде нет авторизации, поэтому роль выбирается переключателем
// и хранится в localStorage. Это только интерфейс: защиты данных он не даёт.
// В боевой версии роль должна приходить с бэкенда (например GET /api/me/ → { role }),
// переключатель убирается, а DEMO_SWITCH становится false.
const DEMO_SWITCH = import.meta.env.DEV || import.meta.env.VITE_USE_MOCK === '1'
const KEY = 'siz.demoRole'

function loadRole() {
  try {
    const r = localStorage.getItem(KEY)
    return ROLES[r] ? r : 'manager'
  } catch {
    return 'manager'
  }
}

const Ctx = createContext(null)

export function AuthProvider({ children }) {
  const [role, setRoleState] = useState(loadRole)

  const setRole = useCallback((r) => {
    if (!ROLES[r]) return
    setRoleState(r)
    try { localStorage.setItem(KEY, r) } catch { /* хранилище недоступно */ }
  }, [])

  const value = useMemo(
    () => ({
      role,
      roleInfo: ROLES[role],
      setRole,
      can: (perm) => hasPermission(role, perm),
      canSwitchRole: DEMO_SWITCH,
    }),
    [role, setRole],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth нужно вызывать внутри <AuthProvider>')
  return v
}

/** <Can perm="violations.review">…</Can> — показывает детей только при наличии права. */
export function Can({ perm, children, fallback = null }) {
  return useAuth().can(perm) ? children : fallback
}
