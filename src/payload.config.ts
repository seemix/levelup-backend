import { mongooseAdapter } from '@payloadcms/db-mongodb';
import { lexicalEditor } from '@payloadcms/richtext-lexical';
import { buildConfig } from 'payload';
import { fileURLToPath } from 'url';
import path from 'path';
import sharp from 'sharp';

import { Users } from './collections/Users';
import { Media } from './collections/Media';
import { Barbers } from '@/collections/Barbers';
import { Slides } from '@/collections/Slides';
import { AboutUs } from '@/globals/AboutUs';

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);


export default buildConfig({
    routes: {
        admin: '/',
    },
    cors: [
        process.env.FRONTEND_URL || 'https://levelupbalti.com',
        process.env.BACKEND_URL || 'https://admin.levelupbalti.com',
    ],
    csrf: [
        process.env.FRONTEND_URL || 'https://levelupbalti.com',
        process.env.BACKEND_URL || 'https://admin.levelupbalti.com',
    ],
    admin: {
        user: Users.slug,
        importMap: {
            baseDir: path.resolve(dirname),
        },
        components: {
          //  header: ['@/app/(payload)/admin/components/LocaleSwitcher'],
            graphics: {
                Logo: '@/app/(payload)/components/Logo',
                Icon: '@/app/(payload)/components/Logo',
            },
        },
    },
    localization: {
        locales: ['ru', 'ro', 'en'],
        defaultLocale: 'ru',
        //  fallbackLocale: true,
    },
    collections: [Users, Media, Barbers, Slides],
    globals: [AboutUs],
    editor: lexicalEditor(),
    secret: process.env.PAYLOAD_SECRET || '',
    typescript: {
        outputFile: path.resolve(dirname, 'payload-types.ts'),
    },
    db: mongooseAdapter({
        url: process.env.DATABASE_URL || '',
    }),
    sharp,
    plugins: [],
});
