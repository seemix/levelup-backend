import { mongooseAdapter } from '@payloadcms/db-mongodb';
import { lexicalEditor } from '@payloadcms/richtext-lexical';
import { buildConfig } from 'payload';
import { fileURLToPath } from 'url';
import path from 'path';
import sharp from 'sharp';

import { Users } from '@/collections/Users';
import { Media } from '@/collections/Media';
import { Barbers } from '@/collections/Barbers';
import { Slides } from '@/collections/Slides';
import { AboutUs } from '@/globals/AboutUs';
import { env } from '@/env';
import { migrations } from '@/migrations';

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

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
    plugins: [],
});
