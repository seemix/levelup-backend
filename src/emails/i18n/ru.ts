import type { EmailTranslations } from './types'

export const ru: EmailTranslations = {
  common: {
    greeting: 'Здравствуйте, {name}!',
    greetingNoName: 'Здравствуйте!',
    service: 'Услуга',
    extras: 'Дополнительно',
    barber: 'Барбер',
    location: 'Адрес',
    dateTime: 'Дата и время',
    total: 'Итого',
    phone: 'Телефон',
    signature: 'LevelUp Barbershop',
  },
  confirmation: {
    subject: 'Запись подтверждена: {dateTime}',
    intro: 'Ваша запись подтверждена. Ждём вас!',
    cancelHint: 'Если планы изменились, вы можете отменить запись онлайн:',
    cancelButton: 'Отменить запись',
  },
  moved: {
    subject: 'Запись перенесена: {dateTime}',
    intro: 'Ваша запись перенесена.',
    previous: 'Прежнее время',
    cancelHint: 'Если новое время вам не подходит, позвоните нам.',
  },
  cancelled: {
    subject: 'Запись отменена: {dateTime}',
    introByClient: 'Ваша запись отменена по вашей просьбе.',
    introBySalon:
      'К сожалению, нам пришлось отменить вашу запись. Приносим извинения за неудобства.',
    rebook: 'Вы можете записаться на другое время на нашем сайте.',
  },
  reminder: {
    subject: 'Напоминание: запись завтра, {dateTime}',
    intro: 'Напоминаем о вашей записи через 24 часа.',
    cancelHint: 'Если не сможете прийти, пожалуйста, позвоните нам заранее.',
  },
}
