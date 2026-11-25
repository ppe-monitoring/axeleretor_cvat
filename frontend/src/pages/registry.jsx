import Dashboard from './Dashboard'
import Cameras from './Cameras'
import Journal from './Journal'
import CameraManagement from './CameraManagement'
import SystemStatus from './SystemStatus'
import ZonesOverview from './ZonesOverview'
import RoleInfo from './RoleInfo'
import Placeholder from './Placeholder'

const soon = (id) => () => <Placeholder id={id} />

/**
 * Единый реестр страниц. perm — право из auth/roles.js (null = доступно всем).
 * Порядок здесь = порядок пунктов меню. Страницы без права в меню не попадают.
 */
export const PAGES = [
  { key: 'dashboard', label: 'Дашборд', perm: 'dashboard.view', component: Dashboard },
  { key: 'cameras', label: 'Камеры', perm: 'cameras.live', component: Cameras },
  { key: 'zones', label: 'Камеры и зоны', perm: 'zones.view', component: ZonesOverview },
  { key: 'journal', label: 'Журнал событий', perm: 'violations.view', component: Journal },
  { key: 'system', label: 'Состояние системы', perm: 'system.view', component: SystemStatus },
  { key: 'manage-cameras', label: 'Управление камерами', perm: 'cameras.manage', component: CameraManagement },

  { key: 'incidents', label: 'Инциденты и задачи', perm: 'incidents.manage', component: soon('incidents'), soon: true },
  { key: 'thresholds', label: 'Пороги оповещений', perm: 'alerts.thresholds', component: soon('thresholds'), soon: true },
  { key: 'reports', label: 'Отчёты', perm: 'reports.view', component: soon('reports'), soon: true },
  { key: 'audit', label: 'Журнал действий', perm: 'audit.view', component: soon('audit'), soon: true },
  { key: 'models', label: 'Модели ИИ', perm: 'models.manage', component: soon('models'), soon: true },
  { key: 'channels', label: 'Каналы оповещений', perm: 'alerts.channels', component: soon('channels'), soon: true },
  { key: 'storage', label: 'Хранилище отчётов', perm: 'storage.manage', component: soon('storage'), soon: true },
  { key: 'departments', label: 'Подразделения', perm: 'departments.manage', component: soon('departments'), soon: true },
  { key: 'policies', label: 'Политики и правила', perm: 'policies.manage', component: soon('policies'), soon: true },
  { key: 'my-notifications', label: 'Мои уведомления', perm: 'me.notifications', component: soon('my-notifications'), soon: true },
  { key: 'my-ppe', label: 'Ввод показаний СИЗ', perm: 'me.ppe', component: soon('my-ppe'), soon: true },
  { key: 'briefing', label: 'Инструктаж', perm: 'me.briefing', component: soon('briefing'), soon: true },
  { key: 'my-access', label: 'Пропуск и доступ', perm: 'me.access', component: soon('my-access'), soon: true },

  { key: 'my-role', label: 'Права роли', perm: null, component: RoleInfo },
]
