# LevelUp Barbershop — backend + CRM

Payload CMS backend: контент сайту levelupbalti.com, CRM барбершопу (онлайн-запис, календар, оплати, каси, звіти).
Фронтенд — окремий репозиторій `../levelup-front` (Next.js + next-intl).

- Специфікація: [docs/spec.md](docs/spec.md) — джерело істини щодо сутностей, статусів, правил і ролей.
- План: [docs/plan.md](docs/plan.md) — працюємо поетапно; після етапу відмічаємо чекбокси. Промти й протокол етапу: [docs/prompts.md](docs/prompts.md).
- Payload-правила (безпека, хуки, access): [AGENTS.md](AGENTS.md). Архітектура й деплой: `docs/architecture.md`, `docs/deployment.md`.

## Стек
- Payload **3.92**, Next.js 16, React 19, TypeScript 5.9, **pnpm 10**, Node ≥ 22 (`.nvmrc`).
- MongoDB (`@payloadcms/db-mongodb`) **replica set** — транзакції обов'язкові для запису й фінансів.
- Тести: vitest (`tests/int`, in-memory MongoDB replset) + playwright (`tests/e2e`).
- Час: `date-fns` + `@date-fns/tz`; телефони: `libphonenumber-js`; DnD: `@dnd-kit/core`; пошта: Resend (`@payloadcms/email-resend`, ключ `RESEND_API_KEY` у `.env`).

## Структура
```
src/
  payload.config.ts      # колекції, i18n, localization, плагіни, jobs
  env.ts                 # усі env-змінні тільки звідси
  access/                # policy.ts (уся логіка прав) + access-функції
  collections/ globals/  # схема; одна сутність = один файл
  crm/                   # чиста бізнес-логіка: slots, pricing, money, time, phone, appointments, ledger
  endpoints/             # booking/* (публічні), crm/* (персонал)
  emails/                # шаблони листів + словники ru/ro/en
  i18n/                  # переклади адмінки (namespace `crm`)
  components/            # кастомні компоненти адмінки (calendar view тощо)
  migrations/            # data-міграції та індекси, реєструються в migrations/index.ts
  seed/                  # seed-дані для локальної розробки
tests/int, tests/e2e
```

## Команди
```bash
pnpm dev                 # http://localhost:3000 (адмінка на /)
pnpm typecheck           # tsc --noEmit
pnpm lint
pnpm test:int            # vitest; один файл: pnpm test:int -- slots
pnpm test:e2e
pnpm generate:types      # після будь-якої зміни схеми
pnpm generate:importmap  # після додавання/зміни компонентів адмінки
pnpm migrate             # застосувати міграції
pnpm seed                # seed-дані (не в production); ідемпотентний, паролі — SEED_PASSWORD з .env
pnpm seed:reset          # очистити CRM-дані (не контент сайту й не чужих admin/editor) і засіяти заново
docker compose up mongo  # локальна MongoDB з replica set
```
Готовність етапу: `typecheck` + `lint` + `test:int` зелені.

## Конвенції коду
- TypeScript strict; типи з `src/payload-types.ts` (не редагувати вручну).
- Бізнес-логіка — чисті функції в `src/crm/` без доступу до БД; БД — в адаптерах/сервісах. Чисті функції покриваються unit-тестами.
- Гроші — цілі числа в **банах** (`number`), MDL. Обчислення й форматування тільки через `src/crm/money.ts`.
- Час: моменти — `Date` в UTC; дати графіків — `YYYY-MM-DD`, години — `HH:mm` у `Europe/Chisinau`. Обчислення тільки через `src/crm/time.ts`.
- Телефон — E.164 через `src/crm/phone.ts`.
- Права — тільки через `src/access/policy.ts`. Приховування кнопок у UI не замінює серверну перевірку.
- Local API з `user` → завжди `overrideAccess: false`. У хуках завжди передавати `req`. Хуки, що пишуть у ту саму колекцію, — з context-флагом.
- Записи й фінансові операції змінюються тільки в БД-транзакції (див. spec §5.6, §5.9).
- Суми фінансових операцій не редагуються, лише сторно.
- Помилки бізнес-правил: `APIError` з машинним кодом (`SLOT_TAKEN`, `PROMO_EXPIRED`…); текст перекладає клієнт.
- Endpoints: `depth: 0` і `select` за замовчуванням.
- Будь-яка зміна схеми, що потребує дефолтів або індексів для наявних даних, — міграція в `src/migrations`.
- Prettier (`.prettierrc.json`); імпорти через `@/`.

## Мультимовність (обов'язково)
- Мови: **ru** (за замовчуванням), **ro**, **en** — і контент (`localization`), і UI адмінки (`i18n`).
- **Жодних захардкожених рядків в UI** — ні в адмінці (labels, descriptions, кнопки, повідомлення), ні в листах, ні на фронті.
  - Адмінка: `label: ({ t }) => t('crm:...')`, ключі в `src/i18n/{ru,ro,en}.ts`.
  - Листи: `src/emails/i18n/{ru,ro,en}.ts`, мова = `clients.language`.
  - Фронт: next-intl, `messages/{ru,ro,en}.json`.
- Новий ключ одразу додається у **всі три** мови. Тест `i18n-parity` має бути зеленим.
- Локалізовані поля контенту: назви/описи послуг, додаткових послуг, категорій, локацій, посада барбера, категорії витрат.

## Робочий процес
- Гілки: уся CRM-робота — лише в гілці `crm` (тут і в `levelup-front`); `master` не чіпати до запуску.
- Не починати етап, не затверджений у `docs/plan.md`. Після етапу — відмітити `[x]` і оновити spec, якщо змінилися рішення.
- Не ламати наявний функціонал (`barbers`, `slides`, `about-us`, `media`, роль `editor`, публічне API для лендингу).
- Нові залежності — тільки ті, що зафіксовані в spec (A9), інші — після погодження.
