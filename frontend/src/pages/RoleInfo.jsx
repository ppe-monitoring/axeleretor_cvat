import PageHeader from '../components/PageHeader'
import Card from '../components/Card'
import { useAuth } from '../auth/AuthContext'

const BLOCKS = [
  { key: 'sees', title: 'Видит', mark: '✓' },
  { key: 'manages', title: 'Управляет', mark: '✓' },
  { key: 'denied', title: 'Недоступно', mark: '✕' },
]

export default function RoleInfo() {
  const { roleInfo } = useAuth()
  return (
    <>
      <PageHeader title={`Права роли «${roleInfo.label}»`} />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-4">
        {BLOCKS.map((b) => (
          <Card key={b.key} title={b.title} className={b.key === 'denied' ? 'border-dashed' : ''}>
            <ul>
              {roleInfo.spec[b.key].map((item) => (
                <li key={item} className="flex gap-2 py-1.5">
                  <span aria-hidden="true" className={b.key === 'denied' ? 'text-risk-high-fg' : 'text-risk-ok-fg'}>{b.mark}</span>
                  {item}
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </>
  )
}
