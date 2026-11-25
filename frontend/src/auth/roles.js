// Роли и права — по схеме «Архитектура продукта».
// permissions — что открывает интерфейс; spec — тексты для страницы «Права роли».

export const ROLES = {
  manager: {
    label: 'Руководитель',
    demoName: 'Руководитель смены',
    home: 'dashboard',
    permissions: [
      'dashboard.view', 'recommendations.view', 'cameras.live', 'zones.view',
      'violations.view', 'violations.review', 'frames.view',
      'system.view', 'audit.view', 'reports.view', 'reports.schedule',
      'incidents.manage', 'alerts.thresholds',
    ],
    spec: {
      sees: ['Статус серверов, аптайм', 'Камеры по цехам', 'Индикативное видео', 'Карта зон, статус камер', 'Отчёты и аналитика', 'Журнал действий'],
      manages: ['Назначать ответственных', 'Сбросить приоритет задач', 'Проверка выполнения', 'Комментарии к инцидентам', 'Пороги оповещений', 'Расписание отчётов'],
      denied: ['Управление ролями', 'Править журнал', 'Настройки ИИ', 'Настройки камер', 'Личные данные без причины'],
    },
  },
  employee: {
    label: 'Сотрудник',
    demoName: 'Сотрудник цеха',
    home: 'zones',
    permissions: ['zones.view', 'me.notifications', 'me.ppe', 'me.briefing', 'me.access'],
    spec: {
      sees: ['Список пропусков', 'Биометрия и верификация', 'Текущий статус доступа', 'Камеры и зоны'],
      manages: ['Получает уведомления о нарушениях', 'Вводит показания по СИЗ', 'Подтверждает ознакомление', 'Проходит инструктаж', 'Сканирование шаблонов нарушений'],
      denied: ['Изменять записи журнала', 'Кадры и отчёты', 'Настройки системы', 'Настройки камер'],
    },
  },
  sysadmin: {
    label: 'Сисадмин',
    demoName: 'Системный администратор',
    home: 'system',
    permissions: ['system.view', 'audit.view', 'cameras.manage', 'models.manage', 'alerts.channels', 'storage.manage'],
    spec: {
      sees: ['Инфраструктура сервера', 'Журнал ошибок', 'Очередь и ошибки', 'Системный журнал', 'Журнал аудита', 'Диагностика, лица blur'],
      manages: ['Камеры и зоны', 'Модели ИИ, пороги', 'Каналы оповещений', 'Хранилище отчётов'],
      denied: ['Права пользователей', 'Настройки ролей', 'Отчёты по сотрудникам'],
    },
  },
  director: {
    label: 'Директор',
    demoName: 'Директор',
    home: 'dashboard',
    permissions: ['dashboard.view', 'violations.view', 'reports.view', 'departments.manage', 'policies.manage'],
    spec: {
      sees: ['Статус всех отделов', 'Ключевые метрики и ИИ', 'Отчёты по безопасности', 'Оценка эффективности', 'Журнал инцидентов'],
      manages: ['Отдел развития и ИТ', 'Отдел управления системой', 'Отдел безопасности', 'Политики и правила', 'Стратегические настройки'],
      denied: ['Правка журналов без причины', 'Технические настройки серверов'],
    },
  },
}

export const ROLE_ORDER = ['manager', 'employee', 'sysadmin', 'director']

/** perm === null/undefined — доступно любой роли. */
export const hasPermission = (role, perm) => !perm || !!ROLES[role]?.permissions.includes(perm)
