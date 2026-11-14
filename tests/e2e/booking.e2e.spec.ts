/**
 * Launch scenario (plan stage 23): online booking on the landing → the appointment in the admin calendar
 * → payment in the appointment modal → the cash register balance. Runs on the throw-away database of
 * `scripts/e2e.ts`; the catalog is created here through the Local API.
 */
import { expect, test, type Page } from '@playwright/test'
import { getPayload, type Payload } from 'payload'

import { formatMoney } from '../../src/crm/money'
import { addLocalDays, todayLocal } from '../../src/crm/time'
import config from '../../src/payload.config'
import { login } from '../helpers/login'
import { assertE2EDatabase, FRONTEND_URL } from './env'

const PHONE = '069 555 123'
const PHONE_E164 = '+37369555123'
const ADMIN = { email: 'e2e-admin@levelup.local', password: 'e2e-password-1' }
const BARBER = 'E2E Barber'
const SERVICE = 'E2E Haircut'
const PRICE = 30_000

type Doc = Record<string, unknown> & { id: string }

/** The same label the booking calendar gives a day button (`dateStyle: full`, UTC calendar date). */
const dayLabel = (date: string) => {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number]
  return new Intl.DateTimeFormat('en', { dateStyle: 'full', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, month - 1, day)),
  )
}

test.describe.serial('online booking → calendar → payment', () => {
  let payload: Payload
  const ids: Record<string, string> = {}
  // Tomorrow: always inside the booking horizon and after the minimum lead time.
  const date = addLocalDays(todayLocal(), 1)

  const create = async (collection: string, data: Record<string, unknown>) =>
    (await payload.create({ collection, data, overrideAccess: true } as never)) as unknown as Doc

  const appointment = async () => {
    const client = await payload.find({
      collection: 'clients',
      where: { phone: { equals: PHONE_E164 } },
      overrideAccess: true,
      depth: 0,
    })
    expect(client.docs).toHaveLength(1)
    const { docs } = await payload.find({
      collection: 'appointments',
      where: { client: { equals: client.docs[0]!.id } },
      overrideAccess: true,
      depth: 0,
    })
    expect(docs).toHaveLength(1)
    return docs[0] as unknown as Doc
  }

  test.beforeAll(async () => {
    assertE2EDatabase()
    payload = await getPayload({ config })
    // The location of the data migration (`pnpm migrate` ran in scripts/e2e.ts).
    const { docs } = await payload.find({
      collection: 'locations',
      overrideAccess: true,
      depth: 0,
      limit: 1,
    })
    expect(docs).toHaveLength(1)
    ids.location = String(docs[0]!.id)
    ids.service = (
      await create('services', { name: SERVICE, durationMinutes: 30, price: PRICE })
    ).id
    ids.barber = (
      await create('barbers', {
        name: BARBER,
        order: 1,
        showOnSite: false,
        color: '#2266aa',
        locations: [ids.location],
        services: [ids.service],
        weeklySchedule: ['1', '2', '3', '4', '5', '6', '7'].map((weekday) => ({
          weekday,
          location: ids.location,
          start: '09:00',
          end: '21:00',
        })),
      })
    ).id
    ids.register = (
      await create('cash-registers', { name: 'E2E Cash', type: 'cash', location: ids.location })
    ).id
    await create('users', { ...ADMIN, roles: ['admin'] })
  })

  test('a visitor books online on the landing', async ({ page }) => {
    await page.goto(`${FRONTEND_URL}/en`)
    await page
      .getByRole('button', { name: /book on/i })
      .first()
      .click()
    const booking = page.locator('section#booking')
    // Every step change scrolls the section smoothly: wait for the step before acting on it.
    const step = (title: string) =>
      expect(booking.getByRole('heading', { name: title, exact: true })).toBeVisible()

    // One location: the step is hidden; one barber: no «any barber».
    await step('Choose a barber')
    await booking.getByRole('button', { name: new RegExp(BARBER) }).click()
    await step('Choose a service')
    await booking.getByRole('button', { name: new RegExp(SERVICE) }).click()
    // No extras for this service: the step is skipped.
    await step('Choose date and time')
    await booking.getByRole('button', { name: dayLabel(date), exact: true }).click()
    await booking.getByRole('button', { name: '12:00', exact: true }).click()

    await step('Your phone')
    await booking.getByLabel('Phone number').fill(PHONE)
    await booking.getByRole('button', { name: 'Next', exact: true }).click()
    await step('Your details')
    await booking.getByLabel(/^First name/).fill('Eugen')
    await booking.getByRole('button', { name: 'Next', exact: true }).click()

    await step('Check your booking')
    // The landing formats whole lei without decimals (MDL 300).
    await expect(booking.getByText(/MDL\s?300\b/).first()).toBeVisible()
    await booking.getByRole('button', { name: 'Book', exact: true }).click()
    await expect(booking.getByText('You are booked!')).toBeVisible()

    const booked = await appointment()
    expect(booked).toMatchObject({
      status: 'scheduled',
      source: 'online',
      total: PRICE,
      barber: ids.barber,
      paymentStatus: 'unpaid',
    })
  })

  const openAppointment = async (page: Page) => {
    await login({ page, user: ADMIN })
    await page.goto('/calendar')
    await page.getByRole('button', { name: 'Next day' }).click()
    await page.locator('.calendar-block[role="button"]', { hasText: 'Eugen' }).click()
  }

  test('the admin finds it in the calendar and takes the payment', async ({ page }) => {
    await openAppointment(page)
    await page.getByRole('tab', { name: 'Payment' }).click()
    // The first row is pre-filled: the cash register, the whole amount due.
    await page.getByRole('button', { name: 'Accept payment' }).click()
    await expect(page.getByText('Payment accepted')).toBeVisible()

    const paid = await appointment()
    // A prepayment of a future visit keeps `scheduled` (A34).
    expect(paid).toMatchObject({ status: 'scheduled', paymentStatus: 'paid', paidAmount: PRICE })
    const { docs } = await payload.find({
      collection: 'transactions',
      where: { appointment: { equals: paid.id } },
      overrideAccess: true,
      depth: 0,
    })
    expect(docs).toHaveLength(1)
    expect(docs[0]).toMatchObject({
      type: 'appointment_payment',
      entries: [expect.objectContaining({ cashRegister: ids.register, amount: PRICE })],
    })
  })

  test('the cash register balance shows the payment', async ({ page }) => {
    const register = (await payload.findByID({
      collection: 'cash-registers',
      id: ids.register,
      overrideAccess: true,
      depth: 0,
    })) as unknown as { balance: number }
    expect(register.balance).toBe(PRICE)

    await login({ page, user: ADMIN })
    await page.goto('/cash')
    await expect(
      page.locator('.finance__card', { hasText: 'E2E Cash' }).locator('.finance__balance'),
    ).toHaveText(formatMoney(PRICE, 'en'))
  })
})
