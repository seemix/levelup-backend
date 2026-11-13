/** Email dictionary (spec §7). `en.ts` is the source of truth; ru/ro must have exactly the same keys. */
export const en = {
  common: {
    greeting: 'Hello, {name}!',
    greetingNoName: 'Hello!',
    service: 'Service',
    extras: 'Extras',
    barber: 'Barber',
    location: 'Location',
    dateTime: 'Date and time',
    total: 'Total',
    phone: 'Phone',
    signature: 'LevelUp Barbershop',
  },
  confirmation: {
    subject: 'Booking confirmed: {dateTime}',
    intro: 'Your booking is confirmed. We are waiting for you!',
    cancelHint: 'If your plans change, you can cancel the booking online:',
    cancelButton: 'Cancel booking',
  },
  moved: {
    subject: 'Booking rescheduled: {dateTime}',
    intro: 'Your booking has been rescheduled.',
    previous: 'Previous time',
    cancelHint: 'If the new time does not suit you, please call us.',
  },
  cancelled: {
    subject: 'Booking cancelled: {dateTime}',
    introByClient: 'Your booking has been cancelled as requested.',
    introBySalon:
      'Unfortunately, we had to cancel your booking. We apologise for the inconvenience.',
    rebook: 'You can book a new time on our website.',
  },
  reminder: {
    subject: 'Reminder: appointment tomorrow, {dateTime}',
    intro: 'We remind you about your appointment in 24 hours.',
    cancelHint: 'If you cannot come, please call us in advance.',
  },
}
