# План рефакторингу та оптимізації LevelUp Backend

> Дата аналізу: 2026-10-29
> Стек: Payload CMS 3.78 + Next.js 16.1 + React 19.2 + MongoDB (mongoose), локалізація `ru / ro / en`.
> Призначення: headless-CMS (адмінка + REST/GraphQL API) для сайту levelupbalti.com.
> Вміст: колекції `users`, `media`, `barbers`, `slides`; глобал `about-us`.

Позначки: `[ ]` — не виконано, `[x]` — виконано. Після кожного етапу — окремий коміт/PR і прогін контрольного списку з розділу «Критерії завершення етапу».

---

## Стан виконання (оновлено 2026-10-29)

Виконано у гілці `chore/refactoring`: етапи 0–2 і 9 майже повністю, етап 3 (залежності), більша частина 4, 6, 7, 8 та частково 5.
Перевірено автоматично: `pnpm typecheck`, `pnpm lint`, `pnpm build` (standalone), `pnpm test:int` (8/8).

**Потребує ваших дій (не виконано, бо потребує БД, Docker або рішення власника):**
1. Зробити `mongodump` production-БД, потім `pnpm migrate` на копії дампа, потім на production (міграції ролей, `media.alt`, `order`). **Без міграції ролей ніхто не зможе керувати користувачами.**
2. Прописати в production env: `COOKIE_DOMAIN=.levelupbalti.com`, `FRONTEND_URL`, `BACKEND_URL`, `PAYLOAD_SECRET`, `DATABASE_URL`.
3. Ручно перевірити `pnpm dev`: вхід в адмінку, CRUD, завантаження зображення, ru/ro/en; запустити `npx playwright install` і `pnpm test:e2e`.
4. Зібрати Docker-образ (`docker compose up --build`) — Docker у цьому середовищі відсутній.
5. Прийняті рішення: лише версії без чернеток (`maxPerDoc: 20`), ліміт файлу 5 МБ, медіа на локальному диску + `scripts/backup.sh` за cron, моніторинг через `/api/health` + uptime-сервіс (треба налаштувати на сервері).

---

## Підсумок аналізу (знахідки)

| # | Серйозність | Знахідка | Де |
|---|---|---|---|
| 1 | 🔴 Критична | Колекція `users` має `create/update/delete/read: () => true` — будь-хто анонімно може створити адміна, змінити чи видалити користувачів і прочитати їх дані | `src/collections/Users.ts` |
| 2 | 🔴 Критична | `media`, `barbers`, `slides`, `about-us` мають лише `read`; решта операцій за замовчуванням вимагає `Boolean(user)`, тож через п.1 фактично відкриті будь-кому | `src/collections/*`, `src/globals/*` |
| 3 | 🟠 Висока | `secret: process.env.PAYLOAD_SECRET \|\| ''` і `DATABASE_URL \|\| ''` — застосунок може стартувати з порожнім секретом | `src/payload.config.ts` |
| 4 | 🟠 Висока | Закоментовані `cors`/`csrf`; домен cookie `.levelupbalti.com` та `secure: true` захардкоджені (ламає локальну розробку/staging) | `payload.config.ts`, `Users.ts` |
| 5 | 🟠 Висока | Немає ролей (RBAC), поле `roles` відсутнє; усі користувачі рівноправні | `Users.ts` |
| 6 | 🟠 Висока | Менеджер пакетів: у `package.json` `engines.pnpm`, скрипти використовують `pnpm`, але lock-файл — `package-lock.json`, `.npmrc` містить `legacy-peer-deps=true` (приховує конфлікти peer-залежностей), `.yarnrc` — сміттєвий файл | корінь |
| 7 | 🟠 Висока | Медіа зберігаються локально в `/media` (не в git, не в Docker-образі, немає бекапу/CDN) | `Media.ts`, `.gitignore` |
| 8 | 🟡 Середня | Хук `generateBlurHash`: `catch (e)` губить причину помилки; не повертає `data` при відсутності файла; блокує завантаження будь-якого не-зображення; не пропускає `size` для відео/svg | `src/hooks/generateBlurHash.ts` |
| 9 | 🟡 Середня | Поле `Media.alt` обов'язкове без локалізації, хоча сайт тримовний | `Media.ts` |
| 10 | 🟡 Середня | Невикористані: `framer-motion`, `src/app/my-route/route.ts` (шаблонний приклад з `getPayload` без логіки), `docker-compose` `node:18-alpine` (застарілий) | `package.json`, `src/app/my-route` |
| 11 | 🟡 Середня | `Dockerfile`: потрібен `output: 'standalone'` (в `next.config.mjs` його немає — образ не збереться); `ENV NODE_ENV production` у застарілому форматі; `COPY public` без папки `public`; `node:22.17.0` не відповідає Node 24 локально | `Dockerfile`, `next.config.mjs` |
| 12 | 🟡 Середня | Тести — шаблонні й нерелевантні: e2e шукає «Payload Blank Template»/«Welcome to your new project» (не існує, адмінка на `/`), int-тест лише `find users` | `tests/` |
| 13 | 🟡 Середня | `eslint-config-next` 15.x при Next 16; `next lint` видалено в Next 16 → скрипт `lint` не працює | `package.json` |
| 14 | 🟡 Середня | Дані без індексів/валідації: `Barbers.name` без `index`, `Slides.image` без `required`, але `verticalImage` required; немає порядку сортування слайдів/барберів (потрібне поле `order`) | колекції |
| 15 | 🟢 Низька | Нестабільний стиль коду (4 пробіли + `;` vs. `.prettierrc.json`), `Logo.tsx` з alt «TRBL Design Logo» (шаблон) | `src/**` |
| 16 | 🟢 Низька | README — шаблонний, описує pnpm/Cloud-деплой, не відображає проєкт | `README.md` |
| 17 | 🟢 Низька | Немає `versions/drafts`, `lastModified`, SEO/метаданих; немає healthcheck-ендпоінта | — |
| 18 | 🟢 Низька | `.env` містить значення в корені робочої копії; `test.env` містить `NODE_OPTIONS`, який дублює `cross-env` | `.env`, `test.env` |

---

## Етап 0. Підготовка та страхувальна сітка

Мета: мати можливість безпечно відкотитись і перевіряти регресії.

- [x] Вирішити «dubious ownership» для git: `git config --global --add safe.directory E:/Users/User/WebstormProjects/levelup`
- [x] Створити гілку `chore/refactoring` від `master`
- [ ] Зробити дамп MongoDB (`mongodump`) та архів папки `/media` перед змінами — архів `/media` зроблено (`../levelup-backup/media-2026-10-29.tgz`), **дамп БД треба зробити вручну** (`mongodump` не встановлено, доступ до БД з `.env` не використовувався)
- [x] Зафіксувати базовий стан: `npx tsc --noEmit`, `npm run build`, `npm run lint` (записати існуючі помилки/попередження) — `tsc` чистий; `next lint` не працював (п.13); `build` перевірено після оновлень
- [x] Прибрати зайву приховану конфігурацію, що міняє поведінку (`.yarnrc` — видалити після підтвердження, що yarn не використовується)
- [x] Перенести `docs/` у git (цей файл) і домовитись вести чекбокси тут

**Критерії завершення:** є бекап БД і медіа, відомий «зелений» базовий стан збірки.

---

## Етап 1. Безпека (виконати першим, незалежно від оновлень)

Мета: закрити анонімний доступ до запису/видалення. Дотримуватись правил з `AGENTS.md` (access control, `overrideAccess: false`).

### 1.1 Ролі та користувачі
- [x] Додати в `Users` поле `roles` (`select`, `hasMany`, `admin`/`editor`, `defaultValue: ['editor']`, `saveToJWT: true`, field-access `update` лише для admin)
- [x] Створити `src/access/` з функціями `anyone`, `authenticated`, `adminOnly`, `adminOrSelf`, `adminOrEditor`
- [x] `Users.access`: `create` — `adminOnly` (першого адміна створювати через `payload.create` у seed-скрипті або тимчасово дозволити, поки `users` порожня), `read/update` — `adminOrSelf`, `delete` — `adminOnly` — `create: adminOnly`; перший користувач автоматично `admin` (хук `beforeChange`), існуючі отримують `admin` міграцією
- [x] Закрити публічне читання користувачів (`read: () => true` прибрати)
- [x] Зменшити `auth.depth: 3` до `0–1`, якщо немає потреби
- [x] Переглянути `tokenExpiration: 1209600` (14 днів) і `useSessions: false` — обрати свідомо (рекомендація: увімкнути sessions, скоротити термін, додати `maxLoginAttempts`/`lockTime`) — 7 днів, `useSessions: true`, `maxLoginAttempts: 5`, `lockTime` 10 хв (після деплою всіх розлогінить один раз)

### 1.2 Контент-колекції
- [x] `Media`, `Barbers`, `Slides`, `AboutUs`: `read: anyone`, `create/update/delete: adminOrEditor` (явно, а не «за замовчуванням»)
- [x] У `Media` обмежити `mimeTypes` (`image/*`) та розмір файлів (`upload.limits`/`fileSize` у `routes`/`serverURL`) — зроблено `mimeTypes: image/*`; ліміт розміру файла 5 МБ додано (`upload.limits.fileSize`)
- [x] Перевірити, що GraphQL-playground (`/api/graphql-playground`) вимкнений у production — `graphQL.disablePlaygroundInProduction: true`

### 1.3 Конфіг і секрети
- [x] Прибрати fallback `|| ''` для `PAYLOAD_SECRET` та `DATABASE_URL`: кидати зрозумілу помилку на старті (валідація `env` через невелику функцію або `zod`) — `src/env.ts` (під час `next build` порожні значення дозволені)
- [x] Винести `cors`/`csrf` у змінні середовища (`FRONTEND_URL`, `BACKEND_URL`) та розкоментувати
- [x] Cookie-домен і `secure` робити залежними від `NODE_ENV`/env-змінної (`COOKIE_DOMAIN`)
- [x] Оновити `.env.example`: усі змінні + коментарі; додати `FRONTEND_URL`, `BACKEND_URL`, `COOKIE_DOMAIN`
- [x] Переконатись, що `.env` ніколи не потрапляв у git-історію (`git log --all -- .env`); якщо потрапляв — змінити секрети — `.env` у git-історії немає, ротація секретів не потрібна

### 1.4 Перевірка
- [x] Інтеграційні тести доступу: анонім не може `create/update/delete` у жодній колекції; editor не може керувати користувачами; admin може все
- [ ] Ручна перевірка REST + GraphQL без токена

**Критерії завершення:** всі тести доступу зелені, анонімні мутації повертають 403.

---

## Етап 2. Модернізація інструментарію та менеджера пакетів

Мета: єдиний менеджер пакетів, чисті peer-залежності.

- [x] Обрати один менеджер. **Рекомендація: pnpm** (так задано в `engines`, скриптах, README, docker-compose, `pnpm.onlyBuiltDependencies`)
  - [x] Встановити pnpm (`corepack enable && corepack prepare pnpm@latest --activate`) (через corepack, pnpm 10.34.9)
  - [x] Додати `"packageManager": "pnpm@<версія>"` у `package.json`
  - [x] Видалити `package-lock.json`, `.yarnrc`, згенерувати `pnpm-lock.yaml`
  - [ ] Альтернатива (якщо лишаємось на npm): прибрати `engines.pnpm`, замінити `pnpm` на `npm` у скриптах `test`, `playwright.config.ts`, README, docker-compose
- [x] Видалити `legacy-peer-deps=true` з `.npmrc` (або весь файл) і розв'язати реальні peer-конфлікти
- [x] Оновити `engines.node` до `>=20.9.0` (Next 16) і узгодити версію Node у Dockerfile / `.nvmrc` (додати `.nvmrc`)
- [x] Додати `"overrides"`/`pnpm.overrides` лише там, де це справді необхідно (документувати причину) — `pnpm.overrides` для `dompurify`, `happy-dom`, `graphql-scalars` (вразливості в транзитивних залежностях Payload; прибрати, коли Payload оновить їх сам)

**Критерії завершення:** чиста установка з нуля (`rm -rf node_modules && pnpm install --frozen-lockfile`) без `legacy-peer-deps` проходить, `build` зелений.

---

## Етап 3. Оновлення залежностей до актуальних версій

Актуальні версії на 2026-10-29 (за `npm outdated`). Оновлюємо **групами**, після кожної — `tsc --noEmit`, `generate:types`, `generate:importmap`, `build`, тести. Кожна група — окремий коміт.

### Зведена таблиця

| Пакет | Поточна | Цільова | Тип оновлення |
|---|---|---|---|
| `payload` | 3.78.0 | 3.91.0 | minor (група Payload) |
| `@payloadcms/next` | 3.78.0 | 3.91.0 | minor |
| `@payloadcms/ui` | 3.78.0 | 3.91.0 | minor |
| `@payloadcms/richtext-lexical` | 3.78.0 | 3.91.0 | minor |
| `@payloadcms/db-mongodb` | 3.78.0 | 3.91.0 (на npm є 3.92.1 — **версії всіх `@payloadcms/*` і `payload` мають збігатись**, брати одну спільну) | minor |
| `next` | 16.1.7 | 16.4.3 | minor |
| `react` / `react-dom` | 19.2.1 | 19.3.1 | minor |
| `@types/react` / `@types/react-dom` | 19.2.9 / 19.2.3 | 19.3.0 | minor |
| `sharp` | 0.34.2 | 0.35.5 | minor (0.x — потенційно ламаюче) |
| `graphql` | 16.13.0 | 16.14.2 (16.x; **не 17**) | patch/minor |
| `framer-motion` | 12.34.4 | — | **видалити** (не використовується) |
| `dotenv` | 16.4.7 | 18.0.9 | major (x2) |
| `cross-env` | 7.0.3 | 10.1.0 | major |
| `plaiceholder` | ^3.0.0 | перевірити актуальну | перевірити |
| `typescript` | 5.7.3 | 5.9.x (7.0.2 — див. нижче) | minor / major |
| `eslint` | 9.39.3 | 9.39.5 (10.x — див. нижче) | patch |
| `eslint-config-next` | 15.4.11 | 16.4.3 (в одну лінію з `next`) | major |
| `prettier` | 3.8.1 | 3.9.10 | minor |
| `vitest` | 4.0.18 | 5.0.5 | major |
| `@vitejs/plugin-react` | 4.5.2 | 6.1.2 | major (x2) |
| `vite-tsconfig-paths` | 6.0.5 | 6.1.1 | minor |
| `jsdom` | 28.0.0 | 30.1.3 | major (x2) |
| `@testing-library/react` | 16.3.0 | 16.3.3 | patch |
| `@playwright/test` | 1.58.2 | 1.64.1 | minor |
| `tsx` | 4.21.0 | 4.23.15 | minor |
| `@types/node` | 22.19.9 | відповідно до Node у проєкті (22.x або 24.x; 26.x лише якщо рантайм Node 26) | узгодити |

> ⚠️ Перед кожною групою перевірити актуальність: `npm outdated` / `pnpm outdated`, і прочитати changelog/release notes. Таблиця — відправна точка, а не гарантія.

### 3.0 Попередня очистка
- [x] Видалити `framer-motion` (`grep` підтвердив, що в `src/` не використовується)
- [x] Перевірити `plaiceholder` (використовується у хуку) на актуальну версію та сумісність з `sharp` 0.35 — 3.0.0 актуальна, працює з sharp 0.35 (тест blurHash)
- [x] Закомітити чистий `lockfile` перед початком

### 3.1 Група A — безпечні patch/minor (низький ризик)
- [x] `@testing-library/react` → 16.3.3
- [x] `prettier` → 3.9.10
- [x] `tsx` → 4.23.15
- [x] `vite-tsconfig-paths` → 6.1.1 — далі **видалено**: vite 8 підтримує `resolve.tsconfigPaths`
- [x] `eslint` → 9.39.5
- [x] `graphql` → 16.14.2
- [x] `@playwright/test` → 1.64.1 (+ `npx playwright install` для нових браузерів) (перед запуском e2e: `npx playwright install`)
- [x] Перевірка: `tsc --noEmit`, `lint`, `build`

### 3.2 Група B — ядро: Payload + Next + React (найважливіше, оновлювати разом)
- [ ] Прочитати release notes Payload 3.79 → 3.91 (breaking changes, зміни `importMap`, deprecated API) та Next 16.2 → 16.4
- [x] Визначити спільну версію для `payload` і всіх `@payloadcms/*` (однакова, закріплена точно, без `^`) — перевірити peer-вимоги до `next` та `react` — обрано 3.92.1 (актуальна на npm); вимагає `next >=16.3.3`
- [x] Оновити `payload`, `@payloadcms/db-mongodb`, `@payloadcms/next`, `@payloadcms/ui`, `@payloadcms/richtext-lexical`
- [x] Оновити `next`, `react`, `react-dom`, `@types/react`, `@types/react-dom`
- [x] Виконати `generate:importmap` та `generate:types`; переглянути diff `payload-types.ts` та `importMap.js`
- [ ] Звірити згенеровані файли `src/app/(payload)/**` з актуальним шаблоном Payload (`layout.tsx`, `[[...segments]]/page.tsx`, `not-found.tsx`, `api/**`)
- [x] Перевірити, чи потрібні міграції схеми БД (Mongo — зазвичай ні, але для localized-полів перевірити) — додано 3 міграції в `src/migrations`
- [ ] Перевірка: `npm run dev` → вхід в адмінку, CRUD для кожної колекції, завантаження зображення (blurHash), локалізація ru/ro/en, rich text, REST та GraphQL

### 3.3 Група C — sharp
- [x] `sharp` → 0.35.x (перевірити breaking changes 0.35, сумісність з Payload та `plaiceholder`)
- [ ] Перевірка: завантаження jpeg/png/webp, генерація blurHash, `onlyBuiltDependencies` у pnpm
- [ ] Якщо `plaiceholder` несумісний — замінити хук на пряме використання `sharp` (resize 16px → base64), прибравши залежність

### 3.4 Група D — інструменти середовища (major)
- [x] `dotenv` 16 → 18 (перевірити, чи пакет взагалі потрібен: Next/Payload CLI вантажать `.env` самі; використовується у `playwright.config.ts` — залишити або замінити на `process.loadEnvFile`) — оновлено, залишено (використовується vitest/playwright)
- [x] `cross-env` 7 → 10 (перевірити Node-вимоги; або замінити на нативні змінні в скриптах, якщо Windows-розробка не обов'язкова)
- [x] `@types/node` узгодити з версією Node у Dockerfile/`.nvmrc` — 22.20.5 (Node 22 в `.nvmrc`/Dockerfile)

### 3.5 Група E — лінтер і типи
- [x] `eslint-config-next` 15 → 16.4.3 (в одну лінію з `next`)
- [x] **Міграція lint-скрипта:** `next lint` у Next 16 видалено → замінити на `eslint .`; оновити `eslint.config.mjs` на нативний flat-config `eslint-config-next` (без `FlatCompat`)
- [x] `typescript` 5.7.3 → найновіший 5.9.x (стабільний, сумісний з Payload/Next). **TypeScript 7.x (native) — окремий експеримент:** переходити, лише коли Payload/Next/typescript-eslint офіційно його підтримують; перевірити peer-залежності — 5.9.3, TS 7 відкладено
- [x] `eslint` 10.x — **відкласти**, доки `eslint-config-next` та плагіни не заявлять підтримку — перевірено: ESLint 10 дає unmet peer у плагінах `eslint-config-next`
- [x] Перевірка: `npm run lint`, `tsc --noEmit`, виправити нові попередження

### 3.6 Група F — тестовий стек (major)
- [x] `vitest` 4 → 5, `@vitejs/plugin-react` 4 → 6, `jsdom` 28 → 30 — оновлювати разом, перевіряти peer-вимоги Vite (+ `vite` 8 як явна залежність для peer `@vitejs/plugin-react` 6)
- [x] Оновити `vitest.config.mts` за міграційним гайдом
- [x] Перевірка: `npm run test:int` — 8/8 тестів

### 3.7 Фіксація
- [x] Закріпити точні версії (без `^`) для `payload`/`@payloadcms/*`/`next`/`react` (як зараз), для решти — `^`
- [x] Увімкнути Dependabot/Renovate з групуванням (`payload*`, `react*`, `vitest*`) і розкладом раз на тиждень — `.github/dependabot.yml`
- [x] Додати скрипт `"deps:check": "pnpm outdated"` (або `npm outdated`)
- [x] `pnpm audit` / `npm audit` — відсутність high/critical вразливостей — лишилась 1 low (`deepmerge` у `payload`, патча немає)

**Критерії завершення:** `outdated` показує лише свідомо відкладені пакети (`graphql@17`, `eslint@10`, `typescript@7`, `@types/node@26` — з причинами в цьому файлі), збірка і тести зелені.

---

## Етап 4. Рефакторинг коду

### 4.1 Структура
- [x] Створити відсутні каталоги за `AGENTS.md`: `src/access/`, `src/fields/` (фабрики полів)
- [x] Видалити `src/app/my-route/route.ts` (шаблонний приклад без користі) або замінити на `/api/health` — замінено на `/api/health`
- [x] Прибрати закоментований код у `payload.config.ts` (`header`, `fallbackLocale`, CORS-блок після винесення в env)
- [x] Уніфікувати імпорти (скрізь `@/…` замість змішаних відносних шляхів)
- [x] Узгодити форматування з `.prettierrc.json` та прогнати `prettier --write` (окремий коміт «format only», щоб не засмічувати diff)

### 4.2 `Media` та хук `generateBlurHash`
- [x] Виправити хук: повертати `data` у всіх гілках; обробляти лише `image/*`; логувати оригінальну помилку через `req.payload.logger`, а не губити її
- [x] Обчислювати blurHash лише при заміні файла (`req.file`), а не при кожному `update`
- [x] Перенести з `beforeValidate` у `beforeChange` (хеш потрібен після валідації)
- [x] Зробити `alt` локалізованим (`localized: true`) — **міграція існуючих даних** (див. Етап 6)
- [x] Налаштувати `imageSizes` (thumbnail/card/hero) і `formatOptions` (webp/avif), щоб фронтенд не тягнув оригінали
- [x] Додати `admin.useAsTitle: 'alt'` або `filename`

### 4.3 Моделі даних
- [x] `Barbers`, `Slides`: додати поле `order` (number, `index: true`) для керованого сортування; `defaultSort: 'order'`
- [x] `Barbers.name` — `index: true`; розглянути `slugField`, якщо фронтенд має сторінки барберів (`slugField` не потрібен — сторінок барберів у CMS немає)
- [ ] `Slides`: узгодити обов'язковість `image` / `verticalImage` (зараз асиметрично), додати `alt`/посилання за потреби
- [ ] `Barbers.description`: `text` → `textarea`, якщо текст довгий; додати `maxLength`
- [x] Додати `versions.drafts` для `barbers`/`about-us`, якщо потрібен процес публікації — **рішення: лише версії без чернеток** (`maxPerDoc: 20`), публікація лишається миттєвою
- [x] Винести повторювані конфіги (`access`, `admin.group: 'Content'`) у спільні константи

### 4.4 Типи
- [x] Після змін схеми — `generate:types`; ніколи не правити `payload-types.ts` вручну
- [ ] Увімкнути `noUncheckedIndexedAccess`/`noImplicitOverride` у `tsconfig.json` (за бажанням) і виправити помилки
- [ ] Прибрати `allowJs`, якщо немає JS-файлів (крім згенерованого `importMap.js` — перевірити)
- [x] Додати `"typecheck": "tsc --noEmit"` у скрипти

### 4.5 Адмін-панель
- [x] `Logo.tsx`: виправити `alt` («TRBL Design Logo» → «LevelUp»), використати `priority`, перевірити розміри, замінити 200×200 на реальні — `alt` виправлено; розміри/`priority` не змінювались
- [ ] Стиснути `logo.webp`/`favicon.png` (Icon і Logo зараз — один компонент; зробити окремий компактний `Icon`)
- [ ] Підготувати переклади адмінки (`i18n`) для `ru`/`ro`, якщо редактори їх потребують

**Критерії завершення:** `tsc --noEmit` без помилок, lint без нових попереджень, поведінка API не змінилась (окрім задокументованих змін).

---

## Етап 5. Оптимізація продуктивності

- [x] **Медіа-сховище (рішення: локальний диск + бекапи, S3 лишається опцією):** винести файли з локальної `/media` у S3-сумісне сховище (`@payloadcms/storage-s3` / R2 / Vercel Blob) + CDN; прибрати залежність від локального диска (критично для Docker/горизонтального масштабування) — додано опційний `s3Storage` (вмикається змінною `S3_BUCKET`); перенесення наявних файлів — вручну, див. `docs/deployment.md`
- [x] Увімкнути `disableLocalStorage: true` після переходу на хмарне сховище — плагін S3 вимикає локальне сховище автоматично
- [x] Оптимізація зображень: ліміт розміру завантаження, автоконвертація у webp/avif, адаптивні розміри (див. 4.2) — webp + розміри + ліміт 5 МБ
- [x] Індекси MongoDB: `order`, `name`, `createdAt` на колекціях, що сортуються; перевірити `explain()` на типових запитах фронтенду — індекси `order`, `name` додано; `explain()` на реальних даних не перевірявся
- [x] Знизити `depth` за замовчуванням (`defaultDepth: 1`) та `maxDepth` у `upload`-полях; рекомендувати фронтенду `depth`/`select` у запитах — `defaultDepth: 1`; `maxDepth` не задавався
- [ ] Кешування: `Cache-Control`/ISR-ревалідація на стороні фронтенду; додати `afterChange`-хук, що викликає revalidate-вебхук фронтенду (`FRONTEND_URL/api/revalidate`) з `req` та `context`-прапорцем проти циклів
- [x] Next: `next.config.mjs` — `output: 'standalone'`, `images.remotePatterns` за потреби, перевірити `experimental`-прапори після оновлення — `output: 'standalone'`
- [ ] Прибрати `--max-old-space-size=8000` у `build`, якщо після оновлень збірка вкладається в стандартний ліміт (виміряти)
- [x] Видалити невикористані залежності (`depcheck`/`knip`): мінімум `framer-motion`
- [ ] Вимірювання: час холодного старту, час `next build`, розмір `.next`, TTFB `/api/barbers` і `/api/slides` — зафіксувати «до/після»

**Критерії завершення:** зафіксовані метрики «до/після», медіа обслуговуються не з локального диска.

---

## Етап 6. Міграції даних (за потреби)

- [x] Перейти на систему міграцій Payload (`payload migrate:create`) для змін схеми, що торкаються існуючих даних — `prodMigrations` + скрипт `pnpm migrate`
- [x] Міграція `media.alt` → локалізоване поле (скопіювати існуюче значення в `ru`, за потреби в інші локалі)
- [x] Міграція заповнення `order` для існуючих `barbers`/`slides`
- [ ] Перенесення існуючих файлів з `/media` у хмарне сховище та перепис URL
- [ ] Протестувати міграції на копії production-дампа; підготувати план відкату

---

## Етап 7. Тестування та CI

- [x] Видалити/переписати шаблонні e2e-тести (`frontend.e2e.spec.ts` перевіряє неіснуючий контент). Адмінка на `/` — оновити `admin.e2e.spec.ts` під `routes.admin: '/'`
- [ ] Інтеграційні тести (vitest + Local API, тестова БД — `mongodb-memory-server` або окремий контейнер):
  - [x] права доступу для кожної колекції/ролі (Етап 1) — покрито `users` і `barbers`
  - [x] хук `generateBlurHash` (зображення / не-зображення / відсутній файл)
  - [ ] локалізація: читання `ru/ro/en`, fallback
  - [ ] сортування за `order`
- [x] Прибрати залежність тестів від `test.env`/`NODE_OPTIONS` (використовувати `cross-env` у скриптах) — `test.env` видалено, int-тести працюють на in-memory MongoDB
- [x] Скрипти: `lint`, `typecheck`, `test:int`, `test:e2e`
- [x] GitHub Actions (або інший CI): install (frozen lockfile) → typecheck → lint → test:int → build; кешування залежностей — `.github/workflows/ci.yml` (не запускався)
- [ ] Pre-commit (`lint-staged` + `husky`, опціонально): prettier + eslint для змінених файлів

---

## Етап 8. Docker, деплой, спостережуваність

- [x] `next.config.mjs`: `output: 'standalone'` (без цього поточний `Dockerfile` не працює)
- [x] Оновити `Dockerfile`: актуальна LTS-версія Node, `ENV KEY=value` синтаксис, використання pnpm-lockfile, видалити `COPY public`, якщо папки немає; non-root user залишити — **образ не збирався** (Docker не встановлено); `next build` у standalone-режимі перевірено
- [x] Додати `.dockerignore` (`node_modules`, `.next`, `media`, `.env*`, `.git`, `tests`)
- [x] `docker-compose.yml`: прибрати `version: '3'` (застарілий ключ), `node:18-alpine` → версія з Dockerfile, `mongo:latest` → зафіксована мажорна версія, налаштувати replica set (потрібен для транзакцій Payload), healthcheck для `mongo` і `payload` — не запускався (Docker відсутній)
- [x] Endpoint `/api/health` (перевірка зв'язку з БД) для оркестратора
- [x] Логування/моніторинг: структуроване логування Payload (`pino`), Sentry (опціонально) — **рішення: `/api/health` + зовнішній uptime-сервіс, без Sentry**; логи Payload (pino) йдуть у stdout, див. `docs/deployment.md`
- [x] Резервне копіювання MongoDB за розкладом; задокументувати процедуру відновлення — `scripts/backup.sh` + cron-приклад, `docs/deployment.md` (розклад на сервері налаштувати вручну)
- [ ] Окремі середовища: `development / staging / production` з власними `.env`

---

## Етап 9. Документація

- [x] Переписати `README.md` під проєкт: призначення, стек, структура, змінні середовища, запуск (dev/prod/Docker), команди, ролі, процес оновлення залежностей
- [x] Документувати API для фронтенду: колекції, поля, локалі, рекомендовані `depth`/`select`, приклади запитів (REST/GraphQL) — `docs/architecture.md`
- [x] Створити `docs/architecture.md` (діаграма: адмінка → Payload → MongoDB/S3 → фронтенд) і `docs/deployment.md`
- [x] Прибрати застарілі згадки «Payload Blank Template» (`package.json` description, README, e2e)
- [x] Перейменувати пакет/опис у `package.json` (`description`) відповідно до проєкту
- [ ] Додати `CHANGELOG.md` або вести історію через Conventional Commits

---

## Рекомендований порядок і оцінка

| Етап | Пріоритет | Залежить від | Орієнтовний обсяг |
|---|---|---|---|
| 0. Підготовка | 🔴 | — | 0.5 год |
| 1. Безпека | 🔴 | 0 | 0.5–1 день |
| 2. Менеджер пакетів | 🟠 | 0 | 1–2 год |
| 3. Оновлення залежностей | 🟠 | 1, 2 | 1–1.5 дня |
| 4. Рефакторинг коду | 🟡 | 3 | 1 день |
| 5. Оптимізація | 🟡 | 3, 4 | 1–2 дні |
| 6. Міграції даних | 🟡 | 4, 5 | 0.5 дня |
| 7. Тести та CI | 🟠 | 1 (паралельно з 3–5) | 1 день |
| 8. Docker/деплой | 🟡 | 2, 3 | 0.5–1 день |
| 9. Документація | 🟢 | усі | 0.5 дня |

> Етап 1 (безпека) варто виконати **негайно**, навіть до оновлення залежностей: поточна конфігурація дозволяє анонімне створення та видалення користувачів.

---

## Журнал відкладених рішень

| Пакет/тема | Рішення | Причина | Дата перегляду |
|---|---|---|---|
| `graphql` 17 | відкладено | Payload 3.x залежить від 16.x | при виході Payload з підтримкою 17 |
| `eslint` 10 | відкладено | очікуємо підтримку в `eslint-config-next` | — |
| `typescript` 7 | відкладено | native-порт; перевірити сумісність Payload/Next | — |
| `@types/node` 26 | відкладено | має відповідати рантайму Node | при переході на Node 26 |
| | | | |
