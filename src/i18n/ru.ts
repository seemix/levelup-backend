import type { CrmTranslations } from './types'

export const ru: CrmTranslations = {
  groups: {
    content: 'Контент',
    settings: 'CRM / Настройки',
  },
  fields: {
    orderDescription: 'Сначала показываются меньшие числа',
    imageLandscape: '1920x1080',
    imagePortrait: '1080x2400',
    order: 'Порядок',
    phoneDescription: 'В любом формате; сохраняется как +373…',
  },
  roles: {
    admin: 'Администратор',
    manager: 'Менеджер',
    barber: 'Барбер',
    editor: 'Редактор сайта',
  },
  languages: {
    ru: 'Русский',
    ro: 'Română',
    en: 'English',
  },
  users: {
    singular: 'Пользователь',
    plural: 'Пользователи',
    roles: 'Роли',
    locations: 'Локации',
    locationsDescription: 'Локации, с которыми работает менеджер (обязательно для менеджера)',
    language: 'Язык',
    languageDescription: 'Язык интерфейса по умолчанию',
  },
  locations: {
    singular: 'Локация',
    plural: 'Локации',
    name: 'Название',
    address: 'Адрес',
    phone: 'Телефон',
    mapUrl: 'Ссылка на карту',
    active: 'Активна',
  },
  bookingSettings: {
    label: 'Настройки записи',
    onlineBookingEnabled: 'Онлайн-запись включена',
    slotStepMinutes: 'Шаг слотов, мин',
    minLeadMinutes: 'Минимум до записи, мин',
    horizonDays: 'Горизонт записи, дней',
    clientCancelMinHours: 'Отмена клиентом не позже чем за, ч',
    reminderHoursBefore: 'Напоминание за, ч',
    bufferMinutes: 'Буфер между записями, мин',
    senderName: 'Имя отправителя писем',
    replyTo: 'Email для ответов',
  },
  errors: {
    phoneInvalid: 'Некорректный номер телефона',
    urlInvalid: 'Укажите ссылку, начинающуюся с http:// или https://',
    integerRequired: 'Введите целое число',
    outOfRange: 'Значение должно быть от {{min}} до {{max}}',
    managerLocationsRequired: 'У менеджера должна быть хотя бы одна локация',
  },
}
