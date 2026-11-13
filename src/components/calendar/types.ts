import type { CalendarColumn } from '@/endpoints/crm/calendar'

export type { CalendarColumn }

/** Response of `GET /api/crm/calendar` (day view). */
export type CalendarData = {
  view: 'day' | 'week'
  date: string
  from: string
  to: string
  location: string
  locations: { id: string; name: string }[]
  slotStepMinutes: number
  columns: CalendarColumn[]
}

export type CalendarAppointment = CalendarColumn['appointments'][number]
