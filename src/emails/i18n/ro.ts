import type { EmailTranslations } from './types'

export const ro: EmailTranslations = {
  common: {
    greeting: 'Bună ziua, {name}!',
    greetingNoName: 'Bună ziua!',
    service: 'Serviciu',
    extras: 'Suplimentar',
    barber: 'Frizer',
    location: 'Adresă',
    dateTime: 'Data și ora',
    total: 'Total',
    phone: 'Telefon',
    signature: 'LevelUp Barbershop',
  },
  confirmation: {
    subject: 'Programare confirmată: {dateTime}',
    intro: 'Programarea dumneavoastră este confirmată. Vă așteptăm!',
    cancelHint: 'Dacă planurile s-au schimbat, puteți anula programarea online:',
    cancelButton: 'Anulează programarea',
  },
  moved: {
    subject: 'Programare mutată: {dateTime}',
    intro: 'Programarea dumneavoastră a fost mutată.',
    previous: 'Ora anterioară',
    cancelHint: 'Dacă noua oră nu vă convine, vă rugăm să ne sunați.',
  },
  cancelled: {
    subject: 'Programare anulată: {dateTime}',
    introByClient: 'Programarea dumneavoastră a fost anulată la cererea dumneavoastră.',
    introBySalon:
      'Din păcate, a trebuit să anulăm programarea dumneavoastră. Ne cerem scuze pentru neplăcere.',
    rebook: 'Puteți face o nouă programare pe site-ul nostru.',
  },
  reminder: {
    subject: 'Memento: programare mâine, {dateTime}',
    intro: 'Vă reamintim despre programarea dumneavoastră peste 24 de ore.',
    cancelHint: 'Dacă nu puteți ajunge, vă rugăm să ne sunați din timp.',
  },
}
