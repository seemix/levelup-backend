/**
 * `GET /api/booking/config?locale=` (spec §6.1): everything the booking page needs to render the
 * choice — active locations, barbers who book online, categories, services, extras, prices
 * ("from" before a barber is chosen, decision 22, §5.4 p.8) and public settings.
 * Only public fields are returned (no schedules, commissions, users, colors, settings for staff).
 */
import type { PayloadRequest, Where } from 'payload'

import { relationId, type RelationValue } from '@/crm/schedule'
import { TIME_ZONE } from '@/crm/time'

import { readSettings, SYSTEM_READ } from './context'
import { bookingEndpoint, localeOf, ok, type Locale } from './http'

type Localized = { locale: Locale; fallbackLocale: 'ru' }

type ItemRow = {
  id: string
  name?: string | null
  description?: string | null
  order?: number | null
  price: number
  durationMinutes: number
  category?: RelationValue
  appliesTo?: RelationValue[] | null
}

type BarberRow = {
  id: string
  name?: string | null
  position?: string | null
  description?: string | null
  order?: number | null
  image?: RelationValue
  locations?: RelationValue[] | null
  services?: RelationValue[] | null
}

type PriceRow = {
  barber: RelationValue
  item: { relationTo: 'services' | 'extras'; value: RelationValue }
  price?: number | null
  durationMinutes?: number | null
}

type MediaRow = {
  id: string
  url?: string | null
  alt?: string | null
  blurHash?: string | null
  sizes?: Record<string, { url?: string | null } | undefined> | null
}

const ids = (values: readonly RelationValue[] | null | undefined): string[] =>
  (values ?? []).map(relationId).filter((id): id is string => id !== null)

/** Price and duration of an item for a barber: `barber-prices` value when set, else the base (§4.9). */
const priceFor = (
  prices: readonly PriceRow[],
  barberId: string,
  kind: 'services' | 'extras',
  item: ItemRow,
) => {
  const row = prices.find(
    (price) =>
      relationId(price.barber) === barberId &&
      price.item.relationTo === kind &&
      relationId(price.item.value) === item.id,
  )
  return {
    id: item.id,
    price: typeof row?.price === 'number' ? row.price : item.price,
    durationMinutes:
      typeof row?.durationMinutes === 'number' ? row.durationMinutes : item.durationMinutes,
  }
}

const min = (values: number[]): number | null => (values.length ? Math.min(...values) : null)

export const loadBookingConfig = async (req: PayloadRequest) => {
  const { payload } = req
  const locale = localeOf(req)
  const localized: Localized = { locale, fallbackLocale: 'ru' }
  const settings = await readSettings(req)

  const { docs: locationDocs } = await payload.find({
    collection: 'locations',
    ...SYSTEM_READ,
    ...localized,
    req,
    where: { active: { equals: true } },
    sort: 'order',
    limit: 0,
    select: { name: true, address: true, phone: true, mapUrl: true, order: true },
  })
  const locations = locationDocs as unknown as {
    id: string
    name?: string | null
    address?: string | null
    phone?: string | null
    mapUrl?: string | null
  }[]
  const locationIds = locations.map((location) => String(location.id))

  const { docs: categoryDocs } = await payload.find({
    collection: 'service-categories',
    ...SYSTEM_READ,
    ...localized,
    req,
    where: { active: { equals: true } },
    sort: 'order',
    limit: 0,
    select: { name: true, order: true },
  })

  const online: Where = { and: [{ active: { equals: true } }, { onlineBooking: { equals: true } }] }
  const services = (
    await payload.find({
      collection: 'services',
      ...SYSTEM_READ,
      ...localized,
      req,
      where: online,
      sort: 'order',
      limit: 0,
      select: {
        name: true,
        description: true,
        category: true,
        durationMinutes: true,
        price: true,
        order: true,
      },
    })
  ).docs as unknown as ItemRow[]
  const extras = (
    await payload.find({
      collection: 'extras',
      ...SYSTEM_READ,
      ...localized,
      req,
      where: online,
      sort: 'order',
      limit: 0,
      select: {
        name: true,
        description: true,
        durationMinutes: true,
        price: true,
        appliesTo: true,
        order: true,
      },
    })
  ).docs as unknown as ItemRow[]

  const barberRows = (
    await payload.find({
      collection: 'barbers',
      ...SYSTEM_READ,
      ...localized,
      req,
      where: {
        and: [
          { active: { equals: true } },
          { onlineBooking: { equals: true } },
          { locations: { in: locationIds } },
        ],
      },
      sort: 'order',
      limit: 0,
      select: {
        name: true,
        position: true,
        description: true,
        order: true,
        image: true,
        locations: true,
        services: true,
      },
    })
  ).docs as unknown as BarberRow[]
  const barberIds = barberRows.map((barber) => String(barber.id))

  const prices =
    barberIds.length === 0
      ? []
      : ((
          await payload.find({
            collection: 'barber-prices',
            ...SYSTEM_READ,
            req,
            where: { barber: { in: barberIds } },
            limit: 0,
            select: { barber: true, item: true, price: true, durationMinutes: true },
          })
        ).docs as unknown as PriceRow[])

  const imageIds = barberRows.map((barber) => relationId(barber.image)).filter(Boolean) as string[]
  const media =
    imageIds.length === 0
      ? []
      : ((
          await payload.find({
            collection: 'media',
            ...SYSTEM_READ,
            ...localized,
            req,
            where: { id: { in: imageIds } },
            limit: imageIds.length,
          })
        ).docs as unknown as MediaRow[])

  const serviceIds = new Set(services.map((service) => service.id))
  const barbers = barberRows.map((barber) => {
    const id = String(barber.id)
    const provided = ids(barber.services).filter((serviceId) => serviceIds.has(serviceId))
    const image = media.find((item) => String(item.id) === relationId(barber.image))
    return {
      id,
      name: barber.name ?? '',
      position: barber.position ?? null,
      description: barber.description ?? null,
      image: image
        ? {
            url: image.sizes?.card?.url || image.url || null,
            alt: image.alt ?? null,
            blurHash: image.blurHash ?? null,
          }
        : null,
      locations: ids(barber.locations).filter((locationId) => locationIds.includes(locationId)),
      services: services
        .filter((service) => provided.includes(service.id))
        .map((service) => priceFor(prices, id, 'services', service)),
      extras: extras.map((extra) => priceFor(prices, id, 'extras', extra)),
    }
  })

  const bookableServices = services
    .map((service) => {
      const offers = barbers.flatMap((barber) =>
        barber.services.filter((item) => item.id === service.id),
      )
      return {
        id: service.id,
        name: service.name ?? '',
        description: service.description ?? null,
        category: relationId(service.category),
        price: service.price,
        durationMinutes: service.durationMinutes,
        priceFrom: min(offers.map((offer) => offer.price)),
        barbers: barbers
          .filter((barber) => barber.services.some((item) => item.id === service.id))
          .map((barber) => barber.id),
      }
    })
    // A service nobody provides online cannot be booked.
    .filter((service) => service.barbers.length > 0)
  const bookableIds = bookableServices.map((service) => service.id)

  return {
    locale,
    settings: {
      timeZone: TIME_ZONE,
      currency: 'MDL',
      slotStepMinutes: settings.slotStepMinutes,
      minLeadMinutes: settings.minLeadMinutes,
      horizonDays: settings.horizonDays,
      clientCancelMinHours: settings.clientCancelMinHours,
      onlineBookingEnabled: settings.onlineBookingEnabled,
    },
    locations: locations.map((location) => ({
      id: String(location.id),
      name: location.name ?? '',
      address: location.address ?? null,
      phone: location.phone ?? null,
      mapUrl: location.mapUrl ?? null,
    })),
    categories: (categoryDocs as unknown as { id: string; name?: string | null }[]).map(
      (category) => ({ id: String(category.id), name: category.name ?? '' }),
    ),
    services: bookableServices,
    extras: extras
      .map((extra) => {
        const appliesTo = ids(extra.appliesTo)
        return {
          id: extra.id,
          name: extra.name ?? '',
          description: extra.description ?? null,
          price: extra.price,
          durationMinutes: extra.durationMinutes,
          priceFrom: min(
            barbers.flatMap((barber) =>
              barber.extras.filter((item) => item.id === extra.id).map((item) => item.price),
            ),
          ),
          /** Empty = offered with every service (decision 15). */
          appliesTo: appliesTo.filter((serviceId) => bookableIds.includes(serviceId)),
          appliesToAll: appliesTo.length === 0,
        }
      })
      .filter((extra) => extra.appliesToAll || extra.appliesTo.length > 0),
    barbers: barbers.filter((barber) => barber.locations.length > 0 && barber.services.length > 0),
  }
}

export const configEndpoint = bookingEndpoint('get', '/booking/config', async (req) =>
  ok(await loadBookingConfig(req), { 'Cache-Control': 'public, max-age=60' }),
)
