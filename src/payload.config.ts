import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { s3Storage } from '@payloadcms/storage-s3'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { en } from '@payloadcms/translations/languages/en'
import { ro } from '@payloadcms/translations/languages/ro'
import { ru } from '@payloadcms/translations/languages/ru'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'
import path from 'path'
import sharp from 'sharp'

import { Users } from '@/collections/Users'
import { Media } from '@/collections/Media'
import { Barbers } from '@/collections/Barbers'
import { Slides } from '@/collections/Slides'
import { Locations } from '@/collections/Locations'
import { ServiceCategories } from '@/collections/ServiceCategories'
import { Services } from '@/collections/Services'
import { Extras } from '@/collections/Extras'
import { AboutUs } from '@/globals/AboutUs'
import { BookingSettings } from '@/globals/BookingSettings'
import { env } from '@/env'
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
    importMap: {
      baseDir: path.resolve(dirname),
    },
    components: {
      graphics: {
        Logo: '@/app/(payload)/components/Logo',
        Icon: '@/app/(payload)/components/Logo',
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
  collections: [Users, Media, Barbers, Slides, Locations, ServiceCategories, Services, Extras],
  globals: [AboutUs, BookingSettings],
  editor: lexicalEditor(),
  secret: env.secret,
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: mongooseAdapter({
    url: env.databaseUrl,
    prodMigrations: migrations,
  }),
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
