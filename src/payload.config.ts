import { mongooseAdapter } from '@payloadcms/db-mongodb';
import { lexicalEditor } from '@payloadcms/richtext-lexical';
import path from 'path';
import { buildConfig } from 'payload';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

import { Users } from './collections/Users';
import { Media } from './collections/Media';
import { Barbers } from '@/collections/Barbers';
import { Slides } from '@/collections/Slides';
import { AboutUs } from '@/globals/AboutUs';

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);


export default buildConfig({
    admin: {
        user: Users.slug,
        importMap: {
            baseDir: path.resolve(dirname),
        },
        components: {
            header: ['@/app/(payload)/admin/components/LocaleSwitcher'],
            graphics: {
                Logo: '@/app/(payload)/admin/components/Logo',
                Icon: '@/app/(payload)/admin/components/Logo',
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
