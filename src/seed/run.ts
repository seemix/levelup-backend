/**
 * Seed for local development (spec §9). Everything goes through the Local API and the appointments
 * service, so the data passes the same validation as real input.
 *
 * Idempotent: every record has a natural key (user e-mail, location/service name, client phone,
 * promo code, appointment `externalId` = `seed:…`) and is created only if missing; existing records
 * are never overwritten. `reset` removes the CRM data first (see `resetSeed`).
 */
import { createLocalReq, type Payload, type Where } from 'payload'

import {
  changeAppointmentStatus,
  createAppointment,
  type AppointmentInput,
} from '@/crm/appointments'
import { findCertificateByCode, sellCertificate } from '@/crm/certificates.service'
import { createTransaction } from '@/crm/ledger.service'
import { payAppointment } from '@/crm/payments.service'
import { normalizePhone } from '@/crm/phone'
import { addLocalDays, isoWeekday, localToInstant, todayLocal } from '@/crm/time'

import {
  SEED_BARBERS,
  SEED_CASH_REGISTERS,
  SEED_CATEGORIES,
  SEED_CERTIFICATE,
  SEED_CLIENTS,
  SEED_EXPENSE_CATEGORIES,
  SEED_EXTRAS,
  SEED_LEDGER,
  SEED_OPENING_CASH,
  SEED_PROMO_CODE,
  SEED_SERVICES,
  SEED_USERS,
  type L10n,
} from './data'

export const SEED_ID_PREFIX = 'seed:'

export type SeedOptions = {
  /** Password of all seed users. */
  password: string
  /** Remove the CRM data first. */
  reset?: boolean
  /** Clock (tests). */
  now?: Date
  log?: (message: string) => void
}

export type SeedSummary = Record<string, number>

type Doc = { id: string | number } & Record<string, unknown>

/** Deterministic pseudo-random numbers: the same set of appointments on every run. */
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const system = { overrideAccess: true, depth: 0 } as const

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

/**
 * Removes the CRM data. Operational collections are cleared completely; the catalog, the barbers and
 * the users only by the seed keys. Locations, site content (`slides`, `about-us`, `media`) and users
 * that the seed did not create (admins, editors) are never touched.
 */
export const resetSeed = async (payload: Payload): Promise<SeedSummary> => {
  const removed: SeedSummary = {}
  const wipe = async (collection: string, where: Where, locale?: 'ru') => {
    const result = await payload.delete({
      collection,
      where,
      locale,
      ...system,
    } as never)
    removed[collection] = (result as unknown as { docs: unknown[] }).docs.length
  }
  const all: Where = { id: { exists: true } }

  // The ledger and the registers go together: balances are sums of the operations.
  for (const collection of [
    'transactions',
    'gift-certificates',
    'cash-registers',
    'appointment-logs',
    'appointments',
    'booking-locks',
    'barber-prices',
    'schedule-exceptions',
    'promo-codes',
    'clients',
  ]) {
    await wipe(collection, all)
  }

  const users = await payload.find({
    collection: 'users',
    where: { email: { in: SEED_USERS.map((user) => user.email) } },
    pagination: false,
    select: {},
    ...system,
  })
  const userIds = users.docs.map((user) => user.id)
  if (userIds.length > 0) await wipe('barbers', { user: { in: userIds } })
  await wipe('services', { name: { in: SEED_SERVICES.map((item) => item.name.ru) } }, 'ru')
  await wipe('extras', { name: { in: SEED_EXTRAS.map((item) => item.name.ru) } }, 'ru')
  await wipe(
    'expense-categories',
    { name: { in: SEED_EXPENSE_CATEGORIES.map((item) => item.name.ru) } },
    'ru',
  )
  await wipe(
    'service-categories',
    { name: { in: SEED_CATEGORIES.map((item) => item.name.ru) } },
    'ru',
  )
  if (userIds.length > 0) await wipe('users', { id: { in: userIds } })
  return removed
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const findOne = async (
  payload: Payload,
  collection: string,
  where: Where,
  locale?: 'ru',
): Promise<Doc | null> => {
  const { docs } = await payload.find({
    collection,
    where,
    limit: 1,
    pagination: false,
    locale,
    ...system,
  } as never)
  return (docs[0] as unknown as Doc | undefined) ?? null
}

/** Creates a document in `ru` and fills the other languages; `localized` are the localized fields. */
const createLocalized = async (
  payload: Payload,
  collection: string,
  common: Record<string, unknown>,
  localized: Record<string, L10n>,
): Promise<Doc> => {
  const pick = (locale: 'ru' | 'ro' | 'en') =>
    Object.fromEntries(Object.entries(localized).map(([field, value]) => [field, value[locale]]))
  const doc = (await payload.create({
    collection,
    locale: 'ru',
    data: { ...common, ...pick('ru') },
    ...system,
  } as never)) as unknown as Doc
  for (const locale of ['ro', 'en'] as const) {
    await payload.update({ collection, id: doc.id, locale, data: pick(locale), ...system } as never)
  }
  return doc
}

const id = (doc: Doc): string => String(doc.id)

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

export const runSeed = async (payload: Payload, options: SeedOptions): Promise<SeedSummary> => {
  const log = options.log ?? (() => undefined)
  const now = options.now ?? new Date()
  const created: SeedSummary = {}
  const count = (name: string) => (created[name] = (created[name] ?? 0) + 1)

  if (options.reset) {
    const removed = await resetSeed(payload)
    log(`reset: ${JSON.stringify(removed)}`)
  }

  // 1. Location: the one that the migration created, otherwise a new one (spec §4.2).
  let location = await findOne(payload, 'locations', { id: { exists: true } })
  if (!location) {
    location = await createLocalized(
      payload,
      'locations',
      { active: true, order: 0 },
      {
        name: { ru: 'Бельцы, Дечебал 142', ro: 'Bălți, Decebal 142', en: 'Bălți, Decebal 142' },
        address: {
          ru: 'ул. Дечебал 142, Бельцы',
          ro: 'str. Decebal 142, Bălți',
          en: '142 Decebal St, Bălți',
        },
      },
    )
    count('locations')
  }
  const locationId = id(location)

  // 2. Cash registers (cash + account) in this location; key — name (ru) + location.
  const registerIds = {} as Record<(typeof SEED_CASH_REGISTERS)[number]['key'], string>
  for (const seed of SEED_CASH_REGISTERS) {
    let register = await findOne(
      payload,
      'cash-registers',
      { and: [{ name: { equals: seed.name.ru } }, { location: { equals: locationId } }] },
      'ru',
    )
    if (!register) {
      register = await createLocalized(
        payload,
        'cash-registers',
        { type: seed.type, location: locationId, active: true },
        { name: seed.name },
      )
      count('cash-registers')
    }
    registerIds[seed.key] = id(register)
  }

  // 3. Users.
  const userIds: Record<string, string> = {}
  for (const seedUser of SEED_USERS) {
    let user = await findOne(payload, 'users', { email: { equals: seedUser.email } })
    if (!user) {
      user = (await payload.create({
        collection: 'users',
        data: {
          email: seedUser.email,
          password: options.password,
          roles: [...seedUser.roles],
          // Managers need a location (spec §4.1).
          ...(seedUser.key === 'manager' ? { locations: [locationId] } : {}),
          language: 'ru',
        },
        ...system,
      } as never)) as unknown as Doc
      count('users')
    }
    userIds[seedUser.key] = id(user)
  }

  // 4. Catalog.
  const categoryIds: Record<string, string> = {}
  for (const [index, category] of SEED_CATEGORIES.entries()) {
    let doc = await findOne(
      payload,
      'service-categories',
      { name: { equals: category.name.ru } },
      'ru',
    )
    if (!doc) {
      doc = await createLocalized(
        payload,
        'service-categories',
        { active: true, order: index + 1 },
        { name: category.name },
      )
      count('service-categories')
    }
    categoryIds[category.key] = id(doc)
  }

  const serviceIds: Record<string, string> = {}
  for (const service of SEED_SERVICES) {
    const existing = await findOne(payload, 'services', { name: { equals: service.name.ru } }, 'ru')
    if (existing) {
      serviceIds[service.key] = id(existing)
      continue
    }
    const doc = await createLocalized(
      payload,
      'services',
      {
        category: categoryIds[service.category],
        durationMinutes: service.durationMinutes,
        price: service.price,
        active: true,
        onlineBooking: true,
        order: service.order,
      },
      { name: service.name, description: service.description },
    )
    serviceIds[service.key] = id(doc)
    count('services')
  }

  const extraIds: Record<string, string> = {}
  for (const extra of SEED_EXTRAS) {
    const existing = await findOne(payload, 'extras', { name: { equals: extra.name.ru } }, 'ru')
    if (existing) {
      extraIds[extra.key] = id(existing)
      continue
    }
    const doc = await createLocalized(
      payload,
      'extras',
      {
        durationMinutes: extra.durationMinutes,
        price: extra.price,
        appliesTo: extra.appliesTo.map((key) => serviceIds[key]),
        active: true,
        onlineBooking: true,
        order: extra.order,
      },
      { name: extra.name, description: extra.description },
    )
    extraIds[extra.key] = id(doc)
    count('extras')
  }

  // 5. Barbers: schedule, price overrides, exceptions.
  const barberIds: Record<string, string> = {}
  for (const seed of SEED_BARBERS) {
    let barber = await findOne(payload, 'barbers', { user: { equals: userIds[seed.key] } })
    if (!barber) {
      barber = await createLocalized(
        payload,
        'barbers',
        {
          name: seed.name,
          user: userIds[seed.key],
          color: seed.color,
          order: seed.order,
          active: true,
          // Seed barbers must not show up on the public landing page.
          showOnSite: false,
          onlineBooking: true,
          locations: [locationId],
          services: seed.services.map((key) => serviceIds[key]),
          commissionServicesPercent: seed.commissionServicesPercent,
          commissionExtrasPercent: seed.commissionExtrasPercent,
          weeklySchedule: seed.weekdays.map((weekday) => ({
            weekday: String(weekday),
            location: locationId,
            start: seed.start,
            end: seed.end,
            breaks: seed.breaks,
          })),
        },
        { position: seed.position, description: seed.description },
      )
      count('barbers')
    }
    barberIds[seed.key] = id(barber)

    for (const override of seed.overrides) {
      const itemId =
        override.type === 'services' ? serviceIds[override.item] : extraIds[override.item]
      const exists = await findOne(payload, 'barber-prices', {
        and: [
          { barber: { equals: barberIds[seed.key] } },
          { 'item.relationTo': { equals: override.type } },
          { 'item.value': { equals: itemId } },
        ],
      })
      if (exists) continue
      await payload.create({
        collection: 'barber-prices',
        data: {
          barber: barberIds[seed.key],
          item: { relationTo: override.type, value: itemId },
          price: override.price,
          durationMinutes: override.durationMinutes,
        },
        ...system,
      } as never)
      count('barber-prices')
    }
  }

  // A vacation in the future (outside the ±7 days of the appointments).
  const today = todayLocal(now)
  const vacationFrom = addLocalDays(today, 10)
  if (
    !(await findOne(payload, 'schedule-exceptions', {
      and: [{ barber: { equals: barberIds.barber3 } }, { dateFrom: { equals: vacationFrom } }],
    }))
  ) {
    await payload.create({
      collection: 'schedule-exceptions',
      data: {
        barber: barberIds.barber3,
        kind: 'vacation',
        dateFrom: vacationFrom,
        dateTo: addLocalDays(today, 14),
        comment: 'Seed',
      },
      ...system,
    } as never)
    count('schedule-exceptions')
  }

  // 6. Clients.
  const clientIds: string[] = []
  for (const client of SEED_CLIENTS) {
    const phone = normalizePhone(client.phone)
    let doc = await findOne(payload, 'clients', { phone: { equals: phone } })
    if (!doc) {
      doc = (await payload.create({
        collection: 'clients',
        data: { ...client, phone, source: 'staff' },
        ...system,
      } as never)) as unknown as Doc
      count('clients')
    }
    clientIds.push(id(doc))
  }

  // 7. Promo code.
  let promo = await findOne(payload, 'promo-codes', { code: { equals: SEED_PROMO_CODE } })
  if (!promo) {
    promo = (await payload.create({
      collection: 'promo-codes',
      data: {
        code: SEED_PROMO_CODE,
        description: '-10%',
        discountType: 'percent',
        value: 10,
        validFrom: new Date(now.getTime() - 30 * 86_400_000).toISOString(),
        validTo: new Date(now.getTime() + 180 * 86_400_000).toISOString(),
        onlineAllowed: true,
        active: true,
      },
      ...system,
    } as never)) as unknown as Doc
    count('promo-codes')
  }

  // 7b. Expense categories and a few ledger operations (opening balance, expenses, a transfer),
  // through the ledger service as the seed admin. Operations are added only while the seed registers
  // have none, so a repeated run does not duplicate them.
  const expenseCategoryIds: Record<string, string> = {}
  for (const [order, seed] of SEED_EXPENSE_CATEGORIES.entries()) {
    let category = await findOne(
      payload,
      'expense-categories',
      { name: { equals: seed.name.ru } },
      'ru',
    )
    if (!category) {
      category = await createLocalized(
        payload,
        'expense-categories',
        { order, active: true },
        { name: seed.name },
      )
      count('expense-categories')
    }
    expenseCategoryIds[seed.key] = id(category)
  }
  const { totalDocs: ledgerDocs } = await payload.count({
    collection: 'transactions',
    where: { 'entries.cashRegister': { in: Object.values(registerIds) } },
    overrideAccess: true,
  })
  if (ledgerDocs === 0) {
    const admin = { id: userIds.admin, roles: ['admin'], collection: 'users' }
    const atNoon = (daysAgo: number) =>
      localToInstant(addLocalDays(todayLocal(now), -daysAgo), '12:00').toISOString()
    const post = async (data: Parameters<typeof createTransaction>[1]) => {
      const req = await createLocalReq({ user: admin as never }, payload)
      await createTransaction(req, { location: locationId, ...data }, { now })
      count('transactions')
    }
    await post({
      type: 'adjustment',
      occurredAt: atNoon(7),
      entries: [{ cashRegister: registerIds.cash, amount: SEED_OPENING_CASH }],
      comment: 'Начальный остаток',
    })
    for (const op of SEED_LEDGER) {
      if (op.kind === 'expense')
        await post({
          type: 'expense',
          occurredAt: atNoon(op.daysAgo),
          expenseCategory: expenseCategoryIds[op.category],
          entries: [{ cashRegister: registerIds[op.register], amount: op.amount }],
          comment: op.comment,
        })
      else
        await post({
          type: 'transfer',
          occurredAt: atNoon(op.daysAgo),
          entries: [
            { cashRegister: registerIds[op.from], amount: -op.amount },
            { cashRegister: registerIds[op.to], amount: op.amount },
          ],
          comment: op.comment,
        })
    }
  }

  // 7c. A gift certificate sold a week ago (spec §9), paid by card; used for one payment below.
  let certificate = await findOne(payload, 'gift-certificates', {
    comment: { equals: SEED_CERTIFICATE.comment },
  })
  if (!certificate) {
    const admin = { id: userIds.admin, roles: ['admin'], collection: 'users' }
    const req = await createLocalReq({ user: admin as never }, payload)
    const soldAt = localToInstant(addLocalDays(todayLocal(now), -7), '13:00')
    certificate = (
      await sellCertificate(
        req,
        {
          nominal: SEED_CERTIFICATE.nominal,
          entries: [{ cashRegister: registerIds.card, amount: SEED_CERTIFICATE.nominal }],
          buyerName: SEED_CERTIFICATE.buyerName,
          comment: SEED_CERTIFICATE.comment,
        },
        { now: soldAt },
      )
    ).certificate as Doc
    count('gift-certificates')
    count('transactions')
  }
  let certificateCode = (certificate.code as string | undefined) ?? null

  // 8. Appointments ±7 days through the service (slot, price and status rules apply).
  const known = new Set(
    (
      await payload.find({
        collection: 'appointments',
        where: { externalId: { like: SEED_ID_PREFIX } },
        pagination: false,
        select: { externalId: true },
        ...system,
      })
    ).docs.map((doc) => (doc as unknown as { externalId?: string }).externalId),
  )
  const serviceOptions = { actorType: 'system', mode: 'staff', now, skipEmail: true } as const
  const book = async (externalId: string, data: AppointmentInput): Promise<Doc | null> => {
    if (known.has(externalId)) return null
    try {
      const req = await createLocalReq({}, payload)
      const result = await createAppointment(
        req,
        { ...data, source: 'staff', externalId },
        serviceOptions,
      )
      return result.doc as Doc
    } catch (error) {
      // A taken slot (e.g. a real appointment at that time) just skips this seed record.
      const code = (error as { data?: { code?: string } }).data?.code
      if (code === 'SLOT_TAKEN' || code === 'SLOT_UNAVAILABLE') return null
      throw error
    }
  }

  // A lunch block tomorrow, created first so appointments avoid it.
  const tomorrow = addLocalDays(today, 1)
  if (
    await book(`${SEED_ID_PREFIX}block:${tomorrow}`, {
      kind: 'block',
      location: locationId,
      barber: barberIds.barber1,
      startAt: localToInstant(tomorrow, '14:00'),
      durationMinutes: 60,
      internalNote: 'Seed',
    })
  )
    count('appointments')

  const random = rng(20_261_113)
  const times = ['10:00', '11:15', '14:15', '15:30', '16:45']
  const extrasByService = (serviceKey: string) =>
    SEED_EXTRAS.filter(
      (extra) => extra.appliesTo.length === 0 || extra.appliesTo.includes(serviceKey),
    )
  let manualDiscountUsed = false
  // Payments draw from their own sequence, so the appointments stay the same as before.
  const payRandom = rng(20_261_114)
  let prepaid = false
  /** Pays an appointment through the payment service (system), at the end of the visit. */
  const payFor = async (doc: Doc, amount: number, useCertificate: boolean) => {
    const total = doc.total as number
    payRandom() // the former tip roll: keeps the seeded sequence of the other choices
    const register = payRandom() < 0.5 ? registerIds.cash : registerIds.card
    let certificatePart = 0
    if (useCertificate && certificateCode) {
      const found = await findCertificateByCode(await createLocalReq({}, payload), certificateCode)
      certificatePart = Math.min(found?.balance ?? 0, Math.floor(total / 2))
    }
    const cash = amount - certificatePart
    const paidAt = new Date(Math.min(new Date(doc.endAt as string).getTime(), now.getTime()))
    await payAppointment(
      await createLocalReq({}, payload),
      id(doc),
      {
        entries: cash > 0 ? [{ cashRegister: register, amount: cash }] : [],
        ...(certificatePart > 0
          ? { certificateCode: certificateCode!, certificateAmount: certificatePart }
          : {}),
      },
      { now: paidAt },
    )
    // The certificate pays for one visit only (the rest of its balance stays for the demo).
    if (useCertificate) certificateCode = null
    count('transactions')
  }

  for (let offset = -7; offset <= 7; offset++) {
    const date = addLocalDays(today, offset)
    const weekday = isoWeekday(date)
    for (const barber of SEED_BARBERS) {
      if (!barber.weekdays.includes(weekday)) continue
      const slots = [...times].sort(() => random() - 0.5).slice(0, 1 + Math.floor(random() * 3))
      for (const time of slots) {
        const startAt = localToInstant(date, time)
        // Draw everything first: the random sequence must not depend on what already exists.
        const serviceKey = barber.services[Math.floor(random() * barber.services.length)]
        const extraChoices = extrasByService(serviceKey)
        const extra =
          random() < 0.3 ? extraChoices[Math.floor(random() * extraChoices.length)] : null
        const clientId = clientIds[Math.floor(random() * (clientIds.length - 1))] // not the blocked one
        const usePromo = random() < 0.12
        const outcome = random()

        const doc = await book(`${SEED_ID_PREFIX}${date}:${barber.key}:${time}`, {
          location: locationId,
          barber: barberIds[barber.key],
          client: clientId,
          service: serviceIds[serviceKey],
          extras: extra ? [extraIds[extra.key]] : [],
          startAt,
          promoCode: usePromo ? id(promo) : null,
          ...(!manualDiscountUsed && !usePromo && startAt < now
            ? {
                manualDiscountType: 'amount' as const,
                manualDiscountValue: 2_000,
                manualDiscountReason: 'Seed',
              }
            : {}),
        })
        if (!doc) continue
        count('appointments')
        if (doc.manualDiscount) manualDiscountUsed = true

        const past = startAt < now
        const status = past
          ? outcome < 0.12
            ? 'no_show'
            : outcome < 0.22
              ? 'cancelled_by_client'
              : outcome < 0.27
                ? 'cancelled_by_salon'
                : 'completed'
          : outcome < 0.1
            ? 'cancelled_by_client'
            : outcome < 0.14
              ? 'cancelled_by_salon'
              : null
        if (status) {
          const req = await createLocalReq({}, payload)
          await changeAppointmentStatus(req, id(doc), status, {
            ...serviceOptions,
            cancelReason: status === 'cancelled_by_salon' ? 'Seed' : undefined,
          })
        }
        // Most finished visits are paid (→ `paid`), one with the certificate; one future visit is
        // half prepaid (stays `scheduled`, payment status `partial`).
        const total = doc.total as number
        if (status === 'completed' && total > 0 && payRandom() < 0.8)
          await payFor(doc, total, Boolean(certificateCode))
        else if (!status && !past && !prepaid && total > 0) {
          await payFor(doc, Math.floor(total / 2), false)
          prepaid = true
        }
      }
    }
  }

  return created
}
