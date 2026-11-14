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
  /** Barbers of the location (week-view selector). */
  barbers: { id: string; name: string; own: boolean }[]
  slotStepMinutes: number
  columns: CalendarColumn[]
}

export type CalendarAppointment = CalendarColumn['appointments'][number]
