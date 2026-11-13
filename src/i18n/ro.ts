import type { CrmTranslations } from './types'

export const ro: CrmTranslations = {
  groups: {
    content: 'Conținut',
    settings: 'CRM / Setări',
  },
  fields: {
    orderDescription: 'Mai întâi sunt afișate numerele mai mici',
    imageLandscape: '1920x1080',
    imagePortrait: '1080x2400',
    order: 'Ordine',
    phoneDescription: 'În orice format; se salvează ca +373…',
  },
  roles: {
    admin: 'Administrator',
    manager: 'Manager',
    barber: 'Frizer',
    editor: 'Editor site',
  },
  languages: {
    ru: 'Русский',
    ro: 'Română',
    en: 'English',
  },
  users: {
    singular: 'Utilizator',
    plural: 'Utilizatori',
    roles: 'Roluri',
    locations: 'Locații',
    locationsDescription: 'Locațiile cu care lucrează managerul (obligatoriu pentru manager)',
    language: 'Limbă',
    languageDescription: 'Limba implicită a interfeței',
  },
  locations: {
    singular: 'Locație',
    plural: 'Locații',
    name: 'Denumire',
    address: 'Adresă',
    phone: 'Telefon',
    mapUrl: 'Link pe hartă',
    active: 'Activă',
  },
  bookingSettings: {
    label: 'Setări programări',
    onlineBookingEnabled: 'Programare online activată',
    slotStepMinutes: 'Pasul sloturilor, min',
    minLeadMinutes: 'Timp minim până la programare, min',
    horizonDays: 'Orizont de programare, zile',
    clientCancelMinHours: 'Clientul poate anula cu cel puțin, ore',
    reminderHoursBefore: 'Memento cu, ore înainte',
    bufferMinutes: 'Pauză între programări, min',
    senderName: 'Numele expeditorului',
    replyTo: 'Email pentru răspuns',
  },
  errors: {
    phoneInvalid: 'Număr de telefon invalid',
    urlInvalid: 'Introduceți un link care începe cu http:// sau https://',
    integerRequired: 'Introduceți un număr întreg',
    outOfRange: 'Valoarea trebuie să fie între {{min}} și {{max}}',
    managerLocationsRequired: 'Managerul trebuie să aibă cel puțin o locație',
  },
}
