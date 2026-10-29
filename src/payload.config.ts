import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { s3Storage } from '@payloadcms/storage-s3'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'
import path from 'path'
import sharp from 'sharp'

import { Users } from '@/collections/Users'
import { Media } from '@/collections/Media'
import { Barbers } from '@/collections/Barbers'
import { Slides } from '@/collections/Slides'
import { AboutUs } from '@/globals/AboutUs'
import { env } from '@/env'
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
  localization: {
    locales: ['ru', 'ro', 'en'],
    defaultLocale: 'ru',
  },
  defaultDepth: 1,
  collections: [Users, Media, Barbers, Slides],
  globals: [AboutUs],
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
