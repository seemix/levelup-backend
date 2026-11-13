/** Static seed content (spec §9). Money is in bani (MDL × 100), time in `Europe/Chisinau`. */

export type L10n = { ru: string; ro: string; en: string }

export const SEED_EMAIL_DOMAIN = '@levelup.local'

export const SEED_USERS = [
  { key: 'admin', email: `admin${SEED_EMAIL_DOMAIN}`, roles: ['admin'] },
  { key: 'manager', email: `manager${SEED_EMAIL_DOMAIN}`, roles: ['manager'] },
  { key: 'barber1', email: `barber1${SEED_EMAIL_DOMAIN}`, roles: ['barber'] },
  { key: 'barber2', email: `barber2${SEED_EMAIL_DOMAIN}`, roles: ['barber'] },
  { key: 'barber3', email: `barber3${SEED_EMAIL_DOMAIN}`, roles: ['barber'] },
] as const

export const SEED_CATEGORIES: { key: string; name: L10n }[] = [
  { key: 'haircuts', name: { ru: 'Стрижки', ro: 'Tunsori', en: 'Haircuts' } },
  { key: 'beard', name: { ru: 'Борода и уход', ro: 'Barbă și îngrijire', en: 'Beard & care' } },
]

export type SeedService = {
  key: string
  category: string
  name: L10n
  description: L10n
  durationMinutes: number
  price: number
  order: number
}

export const SEED_SERVICES: SeedService[] = [
  {
    key: 'haircut',
    category: 'haircuts',
    name: { ru: 'Мужская стрижка', ro: 'Tunsoare bărbătească', en: "Men's haircut" },
    description: {
      ru: 'Стрижка ножницами и машинкой, мытьё головы.',
      ro: 'Tunsoare cu foarfeca și mașina, spălat pe cap.',
      en: 'Scissor and clipper cut with a hair wash.',
    },
    durationMinutes: 45,
    price: 15_000,
    order: 1,
  },
  {
    key: 'clipper',
    category: 'haircuts',
    name: { ru: 'Стрижка машинкой', ro: 'Tuns cu mașina', en: 'Clipper cut' },
    description: {
      ru: 'Быстрая стрижка под одну насадку.',
      ro: 'Tuns rapid cu o singură pieptene.',
      en: 'A quick one-guard clipper cut.',
    },
    durationMinutes: 30,
    price: 10_000,
    order: 2,
  },
  {
    key: 'kids',
    category: 'haircuts',
    name: { ru: 'Детская стрижка', ro: 'Tunsoare pentru copii', en: 'Kids haircut' },
    description: {
      ru: 'Для детей до 12 лет.',
      ro: 'Pentru copii sub 12 ani.',
      en: 'For children under 12.',
    },
    durationMinutes: 30,
    price: 10_000,
    order: 3,
  },
  {
    key: 'beard',
    category: 'beard',
    name: { ru: 'Оформление бороды', ro: 'Aranjarea bărbii', en: 'Beard trim' },
    description: {
      ru: 'Моделирование бороды и усов, горячее полотенце.',
      ro: 'Modelarea bărbii și a mustății, prosop cald.',
      en: 'Beard and moustache shaping with a hot towel.',
    },
    durationMinutes: 30,
    price: 10_000,
    order: 4,
  },
  {
    key: 'combo',
    category: 'beard',
    name: { ru: 'Стрижка + борода', ro: 'Tunsoare + barbă', en: 'Haircut + beard' },
    description: {
      ru: 'Комплекс: стрижка и оформление бороды.',
      ro: 'Complex: tunsoare și aranjarea bărbii.',
      en: 'A haircut and a beard trim together.',
    },
    durationMinutes: 75,
    price: 23_000,
    order: 5,
  },
  {
    key: 'shave',
    category: 'beard',
    name: { ru: 'Королевское бритьё', ro: 'Bărbierit regal', en: 'Royal shave' },
    description: {
      ru: 'Бритьё опасной бритвой с горячим полотенцем.',
      ro: 'Bărbierit cu briciul, cu prosop cald.',
      en: 'A straight-razor shave with a hot towel.',
    },
    durationMinutes: 40,
    price: 14_000,
    order: 6,
  },
]

export type SeedExtra = {
  key: string
  name: L10n
  description: L10n
  durationMinutes: number
  price: number
  /** Service keys; empty = offered with every service. */
  appliesTo: string[]
  order: number
}

export const SEED_EXTRAS: SeedExtra[] = [
  {
    key: 'styling',
    name: { ru: 'Укладка', ro: 'Aranjare', en: 'Styling' },
    description: {
      ru: 'Укладка воском или глиной.',
      ro: 'Aranjare cu ceară sau lut.',
      en: 'Styling with wax or clay.',
    },
    durationMinutes: 10,
    price: 3_000,
    appliesTo: [],
    order: 1,
  },
  {
    key: 'wash',
    name: { ru: 'Мытьё головы', ro: 'Spălat pe cap', en: 'Hair wash' },
    description: {
      ru: 'Мытьё и массаж головы.',
      ro: 'Spălat și masaj al capului.',
      en: 'A hair wash with a scalp massage.',
    },
    durationMinutes: 10,
    price: 3_000,
    appliesTo: ['clipper', 'beard', 'shave'],
    order: 2,
  },
  {
    key: 'mask',
    name: { ru: 'Чёрная маска', ro: 'Mască neagră', en: 'Black mask' },
    description: {
      ru: 'Очищающая маска для лица.',
      ro: 'Mască de curățare pentru față.',
      en: 'A cleansing face mask.',
    },
    durationMinutes: 15,
    price: 5_000,
    appliesTo: ['beard', 'combo', 'shave'],
    order: 3,
  },
]

export type SeedBarber = {
  key: string
  name: string
  position: L10n
  description: L10n
  color: string
  order: number
  commissionServicesPercent: number
  commissionExtrasPercent: number
  /** Service keys the barber provides. */
  services: string[]
  /** ISO weekdays (Mon = 1) the barber works. */
  weekdays: number[]
  start: string
  end: string
  breaks: { start: string; end: string }[]
  /** Price/duration overrides (service or extra key). */
  overrides: {
    item: string
    type: 'services' | 'extras'
    price?: number
    durationMinutes?: number
  }[]
}

const LUNCH = [{ start: '13:00', end: '14:00' }]

/** The barber `key` is also the key of the seed user (`SEED_USERS`). */
export const SEED_BARBERS: SeedBarber[] = [
  {
    key: 'barber1',
    name: 'Andrei Rusu',
    position: { ru: 'Топ-барбер', ro: 'Top barber', en: 'Top barber' },
    description: {
      ru: 'Классические и современные стрижки.',
      ro: 'Tunsori clasice și moderne.',
      en: 'Classic and modern cuts.',
    },
    color: '#3B82F6',
    order: 101,
    commissionServicesPercent: 50,
    commissionExtrasPercent: 50,
    services: ['haircut', 'clipper', 'kids', 'beard', 'combo', 'shave'],
    weekdays: [1, 2, 3, 4, 5, 6],
    start: '10:00',
    end: '19:00',
    breaks: LUNCH,
    overrides: [
      { item: 'haircut', type: 'services', price: 20_000, durationMinutes: 50 },
      { item: 'combo', type: 'services', price: 30_000 },
      { item: 'styling', type: 'extras', price: 4_000 },
    ],
  },
  {
    key: 'barber2',
    name: 'Vlad Munteanu',
    position: { ru: 'Барбер', ro: 'Barber', en: 'Barber' },
    description: {
      ru: 'Стрижки и уход за бородой.',
      ro: 'Tunsori și îngrijirea bărbii.',
      en: 'Haircuts and beard care.',
    },
    color: '#10B981',
    order: 102,
    commissionServicesPercent: 40,
    commissionExtrasPercent: 40,
    services: ['haircut', 'clipper', 'kids', 'beard', 'combo'],
    weekdays: [2, 3, 4, 5, 6, 7],
    start: '10:00',
    end: '19:00',
    breaks: LUNCH,
    overrides: [],
  },
  {
    key: 'barber3',
    name: 'Dmitri Volkov',
    position: { ru: 'Барбер', ro: 'Barber', en: 'Barber' },
    description: {
      ru: 'Бритьё и работа с бородой.',
      ro: 'Bărbierit și lucrul cu barba.',
      en: 'Shaves and beard work.',
    },
    color: '#F59E0B',
    order: 103,
    commissionServicesPercent: 40,
    commissionExtrasPercent: 30,
    services: ['haircut', 'clipper', 'beard', 'combo', 'shave'],
    weekdays: [1, 2, 3, 4, 5],
    start: '10:00',
    end: '19:00',
    breaks: LUNCH,
    overrides: [{ item: 'beard', type: 'services', price: 12_000 }],
  },
]

export type SeedClient = {
  firstName: string
  lastName: string
  phone: string
  language: 'ru' | 'ro' | 'en'
  email?: string
  blocked?: boolean
  notes?: string
}

export const SEED_CLIENTS: SeedClient[] = [
  { firstName: 'Александр', lastName: 'Ковалёв', phone: '+37369100001', language: 'ru' },
  { firstName: 'Ion', lastName: 'Popescu', phone: '+37369100002', language: 'ro' },
  {
    firstName: 'Максим',
    lastName: 'Орлов',
    phone: '+37369100003',
    language: 'ru',
    notes: 'Любит короткие стрижки',
  },
  { firstName: 'Mihai', lastName: 'Ciobanu', phone: '+37369100004', language: 'ro' },
  {
    firstName: 'Daniel',
    lastName: 'Smith',
    phone: '+37369100005',
    language: 'en',
    email: 'daniel.smith@example.com',
  },
  { firstName: 'Сергей', lastName: 'Иванов', phone: '+37369100006', language: 'ru' },
  { firstName: 'Vasile', lastName: 'Rotaru', phone: '+37369100007', language: 'ro' },
  {
    firstName: 'Артём',
    lastName: 'Лебедев',
    phone: '+37369100008',
    language: 'ru',
    email: 'artem.lebedev@example.com',
  },
  { firstName: 'Nicolae', lastName: 'Gheorghiu', phone: '+37369100009', language: 'ro' },
  { firstName: 'Eugen', lastName: 'Lungu', phone: '+37369100010', language: 'ro' },
  { firstName: 'Павел', lastName: 'Морозов', phone: '+37369100011', language: 'ru' },
  { firstName: 'Oleg', lastName: 'Marian', phone: '+37369100012', language: 'ro' },
  { firstName: 'Tom', lastName: 'Wilson', phone: '+37369100013', language: 'en' },
  { firstName: 'Кирилл', lastName: 'Белов', phone: '+37369100014', language: 'ru' },
  {
    firstName: 'Ruslan',
    lastName: 'Cebotari',
    phone: '+37369100015',
    language: 'ro',
    blocked: true,
    notes: 'No-show',
  },
]

export const SEED_PROMO_CODE = 'LEVELUP10'
