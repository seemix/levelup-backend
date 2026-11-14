import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { s3Storage } from '@payloadcms/storage-s3'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { en } from '@payloadcms/translations/languages/en'
import { ro } from '@payloadcms/translations/languages/ro'
import { ru } from '@payloadcms/translations/languages/ru'
import { resendAdapter } from '@payloadcms/email-resend'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'
import path from 'path'
import sharp from 'sharp'

import { isAdmin } from '@/access/policy'
import { Users } from '@/collections/Users'
import { Media } from '@/collections/Media'
import { Barbers } from '@/collections/Barbers'
import { Slides } from '@/collections/Slides'
import { Locations } from '@/collections/Locations'
import { ServiceCategories } from '@/collections/ServiceCategories'
import { Services } from '@/collections/Services'
import { Extras } from '@/collections/Extras'
import { ScheduleExceptions } from '@/collections/ScheduleExceptions'
import { BarberPrices } from '@/collections/BarberPrices'
import { Clients } from '@/collections/Clients'
import { PromoCodes } from '@/collections/PromoCodes'
import { Appointments } from '@/collections/Appointments'
import { AppointmentLogs } from '@/collections/AppointmentLogs'
import { BookingLocks } from '@/collections/BookingLocks'
import { CashRegisters } from '@/collections/CashRegisters'
import { ExpenseCategories } from '@/collections/ExpenseCategories'
import { Transactions } from '@/collections/Transactions'
import { GiftCertificates } from '@/collections/GiftCertificates'
import { AboutUs } from '@/globals/AboutUs'
import { BookingSettings } from '@/globals/BookingSettings'
import { consoleEmailAdapter } from '@/emails/adapter'
import { bookingEndpoints } from '@/endpoints/booking'
import { crmEndpoints } from '@/endpoints/crm'
import { env } from '@/env'
import { jobTasks } from '@/jobs/tasks'
import { crmTranslations } from '@/i18n'
import { migrations } from '@/migrations'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({
  routes: {
    admin: '/',
  },
  auth: {
    jwtOrder: ['cookie', 'Bearer'],
  },
  cors: env.allowedOrigins,
  csrf: env.allowedOrigins,
  upload: {
    // 5 MB per file; larger uploads are rejected instead of being truncated.
    limits: { fileSize: 5 * 1024 * 1024 },
    abortOnLimit: true,
  },
  graphQL: {
    disablePlaygroundInProduction: true,
  },
  admin: {
    user: Users.slug,
    // Browser-tab metadata of the admin panel. The favicon is the one used by the landing page
    // (copied from levelup-front into /public); the admin is not for search engines.
    meta: {
      titleSuffix: ' | LevelUp',
      defaultOGImageType: 'off',
      description: 'LevelUp Barbershop CRM',
      robots: 'noindex, nofollow',
      icons: [
        { rel: 'icon', type: 'image/x-icon', url: '/favicon.ico', sizes: '32x32' },
        { rel: 'shortcut icon', type: 'image/x-icon', url: '/favicon.ico' },
      ],
    },
    importMap: {
      baseDir: path.resolve(dirname),
    },
    components: {
      graphics: {
        Logo: '@/app/(payload)/components/Logo',
        Icon: '@/app/(payload)/components/Logo',
      },
      // The calendar is the main screen: its link goes first, above the collection groups.
      beforeNavLinks: [
        '@/components/calendar/CalendarNavLink#CalendarNavLink',
        '@/components/schedule/ScheduleNavLink#ScheduleNavLink',
      ],
      afterNavLinks: [
        '@/components/notifications/NewAppointmentNotifier#NewAppointmentNotifier',
        '@/components/finance/FinanceNavLink#FinanceNavLink',
        '@/components/reports/ReportsNavLink#ReportsNavLink',
      ],
      views: {
        // Home page: calendar for staff, default dashboard for editors.
        dashboard: {
          Component: '@/components/dashboard/Dashboard#Dashboard',
        },
        calendar: {
          Component: '@/components/calendar/CalendarPage#CalendarPage',
          path: '/calendar',
          exact: true,
        },
        schedule: {
          Component: '@/components/schedule/SchedulePage#SchedulePage',
          path: '/schedule',
          exact: true,
        },
        reportsClients: {
          Component: '@/components/reports/ClientsReportPage#ClientsReportPage',
          path: '/reports/clients',
          exact: true,
        },
        reportsFinance: {
          Component: '@/components/reports/FinanceReportPage#FinanceReportPage',
          path: '/reports/finance',
          exact: true,
        },
        reportsSalary: {
          Component: '@/components/reports/SalaryReportPage#SalaryReportPage',
          path: '/reports/salary',
          exact: true,
        },
        cash: {
          Component: '@/components/finance/FinancePage#FinancePage',
          path: '/cash',
          exact: true,
        },
      },
    },
  },
  i18n: {
    supportedLanguages: { ru, ro, en },
    fallbackLanguage: 'ru',
    translations: crmTranslations,
  },
  localization: {
    locales: ['ru', 'ro', 'en'],
    defaultLocale: 'ru',
  },
  defaultDepth: 1,
  collections: [
    Users,
    Media,
    Barbers,
    Slides,
    Locations,
    ServiceCategories,
    Services,
    Extras,
    ScheduleExceptions,
    BarberPrices,
    Clients,
    PromoCodes,
    Appointments,
    AppointmentLogs,
    BookingLocks,
    CashRegisters,
    ExpenseCategories,
    Transactions,
    GiftCertificates,
  ],
  globals: [AboutUs, BookingSettings],
  endpoints: [...bookingEndpoints, ...crmEndpoints],
  editor: lexicalEditor(),
  secret: env.secret,
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: mongooseAdapter({
    url: env.databaseUrl,
    // Indexes are built on connect and awaited before the migrations (A39): Mongoose's background
    // `autoIndex` races with the migration transactions on a replica set (WriteConflict, "catalog changes").
    ensureIndexes: true,
    connectOptions: { autoIndex: false },
    prodMigrations: migrations,
  }),
  email: env.email.apiKey
    ? resendAdapter({
        apiKey: env.email.apiKey,
        defaultFromAddress: env.email.fromAddress,
        defaultFromName: env.email.fromName,
      })
    : consoleEmailAdapter({
        defaultFromAddress: env.email.fromAddress,
        defaultFromName: env.email.fromName,
      }),
  jobs: {
    tasks: jobTasks,
    // Running / queueing / cancelling jobs over HTTP (`/api/payload-jobs/run`, `handle-schedules`):
    // admin only (A40). Payload's default lets any logged-in user (editor, barber) trigger them.
    access: {
      run: ({ req }) => isAdmin(req.user),
      queue: ({ req }) => isAdmin(req.user),
      cancel: ({ req }) => isAdmin(req.user),
    },
    // Runs inside the server process (not for serverless); emails need a minute at most.
    autoRun: env.jobsAutoRun ? [{ cron: '* * * * *', queue: 'default', limit: 20 }] : undefined,
  },
  sharp,
  plugins: [
    // Media goes to S3-compatible storage (S3, R2, MinIO...) only when S3_BUCKET is configured.
    ...(env.s3
      ? [
          s3Storage({
            collections: { media: { prefix: 'media' } },
            bucket: env.s3.bucket,
            config: {
              region: env.s3.region,
              endpoint: env.s3.endpoint,
              forcePathStyle: Boolean(env.s3.endpoint),
              credentials: {
                accessKeyId: env.s3.accessKeyId,
                secretAccessKey: env.s3.secretAccessKey,
              },
            },
          }),
        ]
      : []),
  ],
})
