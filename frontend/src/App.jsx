import { useState } from 'react'
import Sidebar from './components/Sidebar'
import RoleSwitcher from './auth/RoleSwitcher'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { PAGES } from './pages/registry'

function Shell() {
  const { role, roleInfo, can, canSwitchRole } = useAuth()
  const [page, setPage] = useState(null)

  // Только страницы, разрешённые роли. «Права роли» доступны всем, поэтому список не пуст.
  const items = PAGES.filter((p) => can(p.perm))
  // Если выбранной страницы у роли нет (после смены роли) — открываем стартовую страницу роли.
  const current =
    items.find((p) => p.key === page) ?? items.find((p) => p.key === roleInfo.home) ?? items[0]
  const Page = current.component

  return (
    <div className="flex min-h-screen">
      <Sidebar
        active={current.key}
        items={items}
        onNavigate={setPage}
        roleLabel={roleInfo.label}
        footer={canSwitchRole ? <RoleSwitcher /> : null}
      />
      <main className="flex min-w-0 flex-1 flex-col gap-5 px-7 py-6">
        {import.meta.env.VITE_USE_MOCK === '1' && (
          <div className="self-start rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-ink">Демо-данные (mock)</div>
        )}
        <Page key={`${role}-${current.key}`} />
      </main>
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  )
}

// import { useState } from 'react'
// import Sidebar from './components/Sidebar'
// import Dashboard from './pages/Dashboard'
// import Cameras from './pages/Cameras'
// import Journal from './pages/Journal'
// import CameraManagement from './pages/CameraManagement'

// const PAGES = { dashboard: Dashboard, cameras: Cameras, journal: Journal, 'manage-cameras': CameraManagement }

// export default function App() {
//   const [page, setPage] = useState('dashboard')
//   const Page = PAGES[page] ?? Dashboard // остальные разделы пока ведут на дашборд

//   return (
//     <div className="flex min-h-screen">
//       <Sidebar active={page} onNavigate={setPage} />
//       <main className="flex min-w-0 flex-1 flex-col gap-5 px-7 py-6">
//         {import.meta.env.VITE_USE_MOCK === '1' && (
//           <div className="self-start rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-ink">Демо-данные (mock)</div>
//         )}
//         <Page />
//       </main>
//     </div>
//   )
// }


