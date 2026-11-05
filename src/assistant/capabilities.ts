export type CapabilityState = 'available' | 'not_configured' | 'not_implemented';
export type Capability = { id: string; label: string; state: CapabilityState; description: string };

/** States describe implemented features and local configuration, not live model availability. */
export function assistantCapabilities(database: boolean, modelConfigured: boolean): Capability[] {
  return [
    { id: 'text', label: 'Общение', state: database && modelConfigured ? 'available' : 'not_configured', description: 'Текстовый чат и потоковые ответы; для работы нужны база и настроенная модель.' },
    { id: 'reasoning', label: 'Логика', state: modelConfigured ? 'available' : 'not_configured', description: 'Рассуждение выполняет выбранная внешняя модель; доступ к ней проверяется отдельно.' },
    { id: 'memory', label: 'Память и развитие', state: database ? 'available' : 'not_configured', description: 'Записи и связи сохраняются в PostgreSQL; новые поддерживаемые факты обрабатываются в фоне.' },
    { id: 'sight', label: 'Зрение', state: 'not_implemented', description: 'Изображения, камера и распознавание документов пока не подключены.' },
    { id: 'hearing', label: 'Слух и голос', state: 'not_implemented', description: 'Микрофон, распознавание речи и синтез голоса пока не подключены.' },
    { id: 'actions', label: 'Действия', state: 'not_implemented', description: 'Самостоятельное управление файлами, приложениями и устройствами не подключено.' },
  ];
}
