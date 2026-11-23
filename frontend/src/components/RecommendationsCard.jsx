import Card from './Card'
import AlertList from './AlertList'

export default function RecommendationsCard({ items, loading }) {
  return (
    <Card title="Рекомендации руководителю" accent>
      {loading && <p className="text-muted">Анализ данных…</p>}
      {!loading && items.length === 0 && (
        <p className="text-muted">Заметных отклонений за сегодня не найдено.</p>
      )}
      {!loading && items.length > 0 && <AlertList items={items} />}
      <p className="mt-3 text-[13px] text-muted">
        Подсказки формируются автоматически по данным за сегодня и не заменяют решение руководителя.
      </p>
    </Card>
  )
}
