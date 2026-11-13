# Специфікація CRM LevelUp Barbershop

> Версія 1.0, 2026-11-13. Статус: **затверджено**.
> Репозиторії: `levelup` (Payload CMS backend + адмінка + CRM), `levelup-front` (публічний сайт і онлайн-запис).
> План реалізації: [plan.md](plan.md).

## 0. Обсяг

CRM для барбершопу:
- онлайн-запис клієнтів без авторизації;
- календар записів для персоналу;
- облік оплат, витрат і кас;
- промокоди та подарункові сертифікати;
- звіти.

Усе працює поверх наявного Payload 3 (MongoDB) і Next.js-фронтенду. Наявний функціонал не ламаємо: контент сайту (`barbers`, `slides`, `about-us`, `media`) і роль `editor` працюють як раніше.

## 1. Прийняті рішення та припущення

Затверджено власником (питання 1–40 від 2026-11-13):

| # | Рішення |
|---|---|
| 1 | Мови: `ru` (за замовчуванням), `ro`, `en`. Українську не додаємо. |
| 2 | Адмінка: ru/ro/en, мову обирає сам користувач. Власні рядки — через `i18n.translations` Payload (namespace `crm`). |
| 3 | Email: Resend через `@payloadcms/email-resend`; `RESEND_API_KEY` у `.env` (без ключа — лог у консоль). Відправник — верифікований домен (`EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME`). SMS/Viber/Telegram — поза обсягом v1. |
| 4 | Валюта MDL. Суми зберігаються як **цілі числа в банах** (1 лей = 100 бань). Часовий пояс `Europe/Chisinau`. |
| 5 | Календар — кастомний view адмінки Payload (`/calendar`). |
| 6 | Онлайн-запис — сторінка `/[locale]/booking` у `levelup-front`. |
| 7 | Послуги на лендингу беруться з колекції `services`, а не з захардкоженого `servicesData.tsx`. |
| 8 | Ролі `users.roles`: `admin`, `manager`, `barber`, `editor` (лише контент сайту). Барбер-користувач пов'язаний через `barbers.user`. |
| 9 | Міграція зі старої CRM: зараз лише поля `externalId`/`source`, імпорт — окремим етапом пізніше. |
| 10 | Зарплата барбера: `% від послуг` + окремий `% від додаткових послуг`. Чайові — 100% барберу. |
| 11 | Графік: тижневий шаблон + винятки на дати. Редагують admin/manager, барбер тільки бачить. |
| 12 | Один барбер в один день працює лише в одній локації. |
| 13 | Ціну й тривалість основних і додаткових послуг можна перевизначити для конкретного барбера. |
| 14 | Барбер має список послуг, які він надає. |
| 15 | Додаткова послуга прив'язується до основних послуг; порожній список = доступна до всіх. |
| 16 | Є категорії послуг. |
| 17 | Передоплата й часткова оплата дозволені (див. §5.4). |
| 18 | Ціна запису фіксується (snapshot) у момент створення або редагування складу послуг. |
| 19 | Історія змін — окрема колекція `appointment-logs`. |
| 20 | Персонал може ставити запис без клієнта і поза графіком (з попередженням). Накладка записів заборонена. |
| 21 | Є блокування часу без клієнта (`kind = block`). |
| 22 | «Будь-який вільний барбер» обирається автоматично (§6.1.6). До вибору барбера ціна показується як «від X». |
| 23 | Порядок кроків онлайн-запису фіксований, як у вимогах. |
| 24 | Налаштування в global `booking-settings`: крок 15 хв, мінімум 2 год до запису, горизонт 30 днів, скасування клієнтом ≥ 3 год до початку, нагадування за 24 год. |
| 25 | Антиспам: rate limit за IP і телефоном + honeypot. SMS-верифікації немає. |
| 26 | Дані наявного клієнта не перезаписуються; розбіжні ім'я/email зберігаються в `clientComment` запису. |
| 27 | Промокод діє на всі або на вибрані основні/додаткові послуги; знижка рахується від суми застосовних позицій. |
| 28 | Сертифікат — спосіб оплати, а не знижка. Дозволене часткове використання із залишком. |
| 29 | Промокод + сертифікат в одному записі — дозволено. Два промокоди — ні. |
| 30 | Ручну знижку можуть давати лише admin і manager. |
| 31 | Чайові — частина оплати, зберігаються окремо, у звітах відносяться до барбера. |
| 32 | Оплата розділяється між кількома касами. Повернення коштів (refund) — тільки admin, як сторно. |
| 33 | Кас «рахунок» на локацію може бути кілька. Інкасації та змін немає — тільки перекази. |
| 34 | Суми у фінансових операціях не редагуються ніким, виправлення — через сторно (§5.6). |
| 35 | Manager бачить лише свої локації, створює витрати, бачить операційні звіти (без зарплат і прибутку). |
| 36 | Barber бачить зайнятість інших барберів своєї локації (без деталей). Телефон клієнта — тільки у своїх записах, email — ні. |
| 37 | Barber не створює записи іншим барберам. |
| 38 | MongoDB: «міграції» = data-міграції та індекси в `src/migrations`. |
| 39 | Тести логіки — vitest у backend. На фронті — Biome і typecheck. |
| 40 | Документи CRM живуть у `levelup/docs`, у `levelup-front` лежить короткий CLAUDE.md з посиланням. |

Припущення, прийняті мною (дрібні рішення, які можна змінити):
- A1. Колір блоку в календарі = **колір барбера** (як на `docs/dashboard.jpg`). Статус показується іконкою і стилем: `paid` — ✓, `no_show` — штриховка, `completed` — приглушений колір. Скасовані за замовчуванням приховані (перемикач «показати скасовані»).
- A2. Тижневий режим календаря: один барбер, колонки = 7 днів. Денний режим: колонки = барбери.
- A3. EasyWeek залишається паралельно до запуску. Перемикання — через env фронту `NEXT_PUBLIC_BOOKING_PROVIDER=easyweek|native`.
- A4. Онлайн-форма не розкриває, чи є телефон у базі: ім'я обов'язкове завжди, прізвище й email — опційні.
- A5. Промокод перевіряється на момент застосування: `now ∈ [validFrom, validTo]`. Використання рахується за нескасованими записами з цим кодом.
- A6. Сертифікат продається за номіналом. Код має формат `LU-XXXX-XXXX` (без схожих символів 0/O, 1/I).
- A7. Буфер між записами — 0 хв (параметр `bufferMinutes` у налаштуваннях).
- A8. Залишок каси може стати від'ємним — це показується як попередження, а не блокує операцію.
- A9. Нові залежності: `date-fns` + `@date-fns/tz` (час), `libphonenumber-js` (телефони, регіон за замовчуванням `MD`), `@dnd-kit/core` (drag-n-drop з підтримкою touch), `@payloadcms/email-resend`.
- A10. Нагадування та листи відправляються через Payload Jobs Queue (`autoRun`, cron кожні 5 хв), щоб помилка відправки (Resend) не ламала запис і щоб були повтори.
- A11. Rate limit — in-memory (один інстанс застосунку). Для кількох інстансів буде потрібен Redis — поза обсягом.
- A12. Поля `description`/`about` барбера обов'язкові лише при `showOnSite = true`, бо персонал без публічного профілю їх не має.
- A13. Розрахунок зарплати: нетто кожної позиції = ціна позиції × (`total` / `subtotal`), тобто знижка розподіляється пропорційно. База — оплачені записи за датою оплати.
- A14. Етап 0: додатково встановлено `@payloadcms/translations@3.92.1` (та сама версія, що `payload`) — pnpm не дає імпортувати транзитивну залежність. Типізовані ключі: `en.ts` — джерело форми, `ru`/`ro` типізовані `CrmTranslations`; `crmLabel(key)` для label/description, `crmLabels(key)` для `admin.group` (приймає лише статичний запис за мовами). Глобального `pnpm` на машині немає — запуск через `npx pnpm@10`.
- A15. Етап 1, `locations`: анонім читає лише активні; manager — лише свої (`users.locations`); admin, barber, editor — усі. Права ролей користувача об'єднуються через OR (manager+barber бачить усе, що бачить barber).
- A16. Етап 1, `users`: кожен користувач читає й оновлює себе (пароль, `language`); `roles` і `locations` змінює лише admin (field-level `create`/`update`) — спроба не-admin змінити їх мовчки ігнорується Payload, а не повертає помилку. `language` поки лише зберігається; мову адмінки Payload і далі бере зі своїх налаштувань користувача.
- A17. Етап 1, `booking-settings`: непублічні поля — `senderName`, `replyTo` (читає будь-який залогінений користувач); решта публічна. Міграція зберігає дефолти глобалу в БД. Числові поля — цілі з межами (`slotStepMinutes` 5–120, `horizonDays` 1–365, `bufferMinutes` 0–120, решта ≥ 0).
- A18. Етап 1, `getStaffContext(req)`: `barberId` шукається через `barbers.user` лише якщо це поле є в схемі (з'явиться в етапі 3) і лише для ролі `barber`; результат — `null`, якщо прив'язок не рівно одна. Правило «barber ↔ рівно один `barbers.user`» перевірятиметься на запис в етапі 3. `locations.phone` нормалізується в E.164, `mapUrl` — лише `http(s)://`.
- A19. `t` Payload ділить ключ лише по `:` і не заходить у вкладені об'єкти, тому в `i18n.translations` словники `crm` передаються розгорнутими в плоскі ключі (`users.plural`); вихідні файли `src/i18n/{ru,ro,en}.ts` лишаються вкладеними. Тест `i18n-parity` перевіряє переклад кожного ключа через `initI18n`.

## 2. Загальні правила

### 2.1 Гроші
- Тип — `number` (ціле, бані). Поля мають суфікс без одиниць, наприклад `price`, `total`. Для відображення використовується `formatMoney(bani, locale)` → `Intl.NumberFormat(locale, { style: 'currency', currency: 'MDL' })`.
- Відсоткові знижки рахуються в банах, округлення half-up до цілої бані.
- Жодних float-обчислень з грошима поза `src/crm/money.ts`.

### 2.2 Час
- Моменти (`startAt`, `endAt`, `occurredAt`) зберігаються як `Date` (UTC).
- Календарні дати графіків (`date`, `dateFrom`, `dateTo`) — рядки `YYYY-MM-DD` у локальному часі салону.
- Години в графіках — рядки `HH:mm` у локальному часі салону.
- Усі перетворення робляться лише через `src/crm/time.ts` (TZ `Europe/Chisinau`, з урахуванням переходу на літній/зимовий час).

### 2.3 Мультимовність
- Контент, який локалізується (`localized: true`): назви й описи послуг, додаткових послуг і категорій, назва та адреса локації, посада барбера, назви категорій витрат.
- UI адмінки: жодних літералів у `label`, `description`, кнопках і повідомленнях — тільки `t('crm:...')`. Помилки бізнес-правил повертають код (`SLOT_TAKEN`), а текст перекладається на клієнті.
- Фронт: next-intl, ключі в `messages/{ru,ro,en}.json`. Новий ключ додається одразу в усі три файли.
- Тест `i18n-parity` перевіряє однаковий набір ключів у всіх мовах (backend і front).
- Листи надсилаються мовою `clients.language` (fallback — мова запису, далі `ru`).

### 2.4 Телефон
- Нормалізується в E.164 через `libphonenumber-js` (регіон за замовчуванням `MD`). Невалідний номер → помилка `PHONE_INVALID`.
- `clients.phone` — унікальний індекс.

## 3. Ролі та доступ

Ролі зберігаються в `users.roles` (`saveToJWT`). Користувач може мати кілька ролей. `users.locations` (локації менеджера) теж іде в JWT. Зв'язок «користувач → барбер» визначається через `barbers.user` і кешується в `req.context` (`getStaffContext(req)`).

Уся логіка прав зосереджена в одному модулі `src/access/policy.ts`. Його використовують і access-функції колекцій, і кастомні endpoints. Endpoints працюють з даними через Local API з `user` + `overrideAccess: false` або перевіряють права явно через policy перед системною операцією.

### 3.1 Матриця

| Ресурс | admin | manager (свої локації) | barber (свої записи) | editor | анонім |
|---|---|---|---|---|---|
| Контент сайту (slides, about-us, media, публічні поля barbers) | CRUD | R | R | CRUD | R (публічне) |
| users | CRUD | R себе | R себе | R себе | — |
| locations, booking-settings | CRUD | R | R | R | R (публічні поля) |
| service-categories, services, extras, barber-prices | CRUD | R | R | R | R (активні) |
| barbers: CRM-поля (графік, %, user, послуги) | CRUD | R графік; % — ні | R свій графік; % — свій | — | графік — лише через endpoint слотів |
| schedule-exceptions | CRUD | CRUD | R свої | — | — |
| clients | CRUD | CRU | R лише ім'я + телефон клієнтів своїх записів (через endpoint календаря) | — | — |
| appointments | CRUD | CRU (cancel замість D) | CRU своїх; зайнятість інших у своїй локації | — | create через публічний endpoint; cancel за токеном |
| appointment-logs | R | R | R своїх записів | — | — |
| ручна знижка | так | так | ні | — | — |
| cash-registers | CRUD | R (з балансом) | R (без балансу) | — | — |
| transactions: оплата запису | так | так | лише своїх записів | — | — |
| transactions: витрата | так | створення | — | — | — |
| transactions: переказ | так | так (між касами своїх локацій) | — | — | — |
| transactions: сторно оплати (refund) | так | — | — | — | — |
| transactions: сторно інших | так | свої за поточний день | — | — | — |
| expense-categories | CRUD | R | — | — | — |
| promo-codes, gift-certificates | CRUD | R; продаж сертифіката | R (перевірка коду при оплаті) | — | перевірка через публічний endpoint |
| Звіти по клієнтах | так | так | — | — | — |
| Фінансові звіти (дохід, каси, витрати) | так | так, без зарплат/прибутку | — | — | — |
| Звіт по зарплатах | так | — | лише свій | — | — |
| Календар | усі локації | свої локації | своя колонка + зайнятість інших у локації | — | — |

`delete` для `appointments`, `clients` і `transactions` доступний тільки admin. Для `transactions` delete недоступний нікому, лише сторно.

Поля з обмеженим читанням (field-level `read`): `barbers.commission*` (admin + сам барбер), `barbers.user` (admin), `clients.email` (admin, manager), `appointments.cancelTokenHash` (нікому), `cash-registers.balance` (admin, manager).

## 4. Сутності

Нотація: `!` — обов'язкове, `L` — localized, `idx` — індекс, `uniq` — унікальне. У всіх колекцій є `timestamps`.

### 4.1 `users` (розширення наявної)
- `roles!` select hasMany: `admin | manager | barber | editor` (saveToJWT; змінює лише admin).
- `locations` rel → `locations` hasMany (saveToJWT). Обов'язкове для `manager`.
- `language` select `ru|ro|en` — мова інтерфейсу за замовчуванням.
- Правило: якщо роль `barber`, до користувача має бути прив'язаний рівно один `barbers.user`.

### 4.2 `locations`
- `name!` L, `address` L, `phone`, `mapUrl`, `active!` (default true), `order`.
- Якщо активна локація одна, вона обирається автоматично, а вибір прихований (на фронті й у календарі).

### 4.3 `booking-settings` (global)
- `slotStepMinutes` (15), `minLeadMinutes` (120), `horizonDays` (30), `clientCancelMinHours` (3), `reminderHoursBefore` (24), `bufferMinutes` (0), `onlineBookingEnabled` (true), `senderName`, `replyTo`.

### 4.4 `barbers` (розширення наявної)
Наявні поля зберігаються: `order`, `name`, `description` L, `image`, `about` L.
Нові поля:
- `active!` (true) — працює в салоні; `showOnSite!` (true) — показується на лендингу; `onlineBooking!` (true) — доступний в онлайн-записі.
- `position` L (наприклад «top barber»), `color!` (hex, для календаря).
- `user` rel → `users` (uniq, nullable).
- `locations!` rel → `locations` hasMany.
- `services` rel → `services` hasMany — що надає барбер.
- `commissionServicesPercent` (0–100), `commissionExtrasPercent` (0–100).
- `weeklySchedule` array (≤ 7 рядків, унікальний `weekday`): `weekday!` 1–7 (пн = 1), `location!`, `start!` HH:mm, `end!` HH:mm, `breaks` array {`start`, `end`}.
  Валідація: `start < end`, перерви всередині робочого інтервалу й не перетинаються, `location ∈ locations`.

### 4.5 `schedule-exceptions`
- `barber!` idx, `dateFrom!`, `dateTo!` (YYYY-MM-DD, `dateFrom ≤ dateTo`), `kind!`: `day_off | vacation | sick | custom_hours`, `location`, `start`, `end`, `breaks` (для `custom_hours`), `comment`.
- Винятки одного барбера не можуть перетинатися за датами.
- Якщо в цьому діапазоні є записи, admin/manager отримує попередження зі списком записів (без автоматичного скасування).

### 4.6 `service-categories`
- `name!` L, `order`, `active`.

### 4.7 `services`
- `name!` L, `description` L, `category` rel, `durationMinutes!` (кратне 5, > 0), `price!` (бані), `active!`, `onlineBooking!` (true), `order`.

### 4.8 `extras` (додаткові послуги)
- `name!` L, `description` L, `durationMinutes!` (≥ 0), `price!`, `appliesTo` rel → `services` hasMany (порожньо = до всіх), `active!`, `onlineBooking!`, `order`.

### 4.9 `barber-prices` (перевизначення)
- `barber!`, `item!` polymorphic rel → `services | extras`, `price` (nullable), `durationMinutes` (nullable).
- Пара `(barber, item)` унікальна. Порожнє поле означає «брати базове значення».

### 4.10 `clients`
- `firstName!`, `lastName`, `phone!` uniq (E.164), `email`, `language!` (`ru|ro|en`, default `ru`), `notes`, `externalId` idx, `source` (`online | staff | import | <назва старої CRM>`), `blocked` (заборона онлайн-запису).
- Статистика (кількість візитів, останній візит, середній чек, скасування, no-show) не зберігається, а рахується агрегацією у звітах і картці клієнта.

### 4.11 `appointments`
- `kind!`: `appointment | block`.
- `location!`, `barber!` idx, `client` (обов'язковий для онлайн-запису; для персоналу може бути порожнім — «Без імені»).
- `service` (обов'язковий для `appointment`), `extras` hasMany.
- `startAt!` idx, `endAt!`, `durationMinutes!`.
- `lines` (snapshot): array {`itemType` service|extra, `item` (id), `price`, `durationMinutes`}.
- `subtotal`, `promoCode` rel, `promoDiscount`, `manualDiscount`, `manualDiscountReason`, `total` — усі readOnly, рахуються сервером.
- `plannedCertificate` rel → `gift-certificates` (код, введений онлайн; списання відбувається при оплаті).
- `paidAmount`, `certificateAmount`, `tipAmount` — readOnly, оновлюються з ledger.
- `paymentStatus` (похідне): `unpaid | partial | paid | refunded`.
- `status!`: див. §5.1. Також `statusChangedAt`, `cancelledAt`, `cancelReason`.
- `source!`: `online | staff | import`. `createdBy` rel → `users`.
- `language` — мова листів для цього запису.
- `clientComment`, `internalNote` (клієнт не бачить).
- `cancelTokenHash` (sha256, hidden), `confirmationSentAt`, `reminderSentAt`, `externalId`.
- Індекси: `{barber, startAt}`, `{location, startAt}`, `{client, startAt}`.

### 4.12 `appointment-logs`
- `appointment!` idx, `actorType!`: `user | client | system`, `actor` rel → `users`, `action!`: `create | update | move | status | payment | refund | email`, `changes` array {`field`, `from` (json), `to` (json)}, `at!`.
- Записи створюються лише сервером. Update і delete заборонені всім.

### 4.13 `cash-registers`
- `name!` (L), `type!`: `cash | account`, `location!`, `active!`, `balance` (readOnly; змінюється лише ledger-хуком).

### 4.14 `expense-categories`
- `name!` L, `active!`, `order`.

### 4.15 `transactions` (фінансові операції, ledger)
- `type!`: `appointment_payment | certificate_sale | expense | transfer | refund | reversal | adjustment`.
- `occurredAt!` idx, `location!` idx, `author!` (auto з `req.user`), `comment`.
- `entries!` array {`cashRegister!`, `amount!` (бані зі знаком: + надходження, − списання)}.
- Залежно від типу: `appointment`, `barber` (snapshot), `certificate` + `certificateAmount` (оплата сертифікатом, не гроші каси), `tipAmount`, `expenseCategory`, `reverses` rel → `transactions` (для `refund`/`reversal`).
- `reversed` (bool, readOnly).
- Інваріанти за типами:
  - `appointment_payment`: усі `entries > 0`; Σ`entries` + `certificateAmount` = сума в рахунок запису + `tipAmount`.
  - `certificate_sale`: Σ`entries` = номінал сертифіката, `entries > 0`.
  - `expense`: рівно одна entry, `amount < 0`, `expenseCategory!`.
  - `transfer`: дві entries, різні каси, сума = 0.
  - `refund` / `reversal`: дзеркальні entries операції `reverses`; оригінал отримує `reversed = true`; повторне сторно заборонене.
  - `adjustment` (тільки admin): довільні entries, `comment!` (наприклад, початковий залишок).
- `entries` і суми після створення не змінюються. Admin може змінити лише `comment` і `expenseCategory`.

### 4.16 `promo-codes`
- `code!` uniq (зберігається у верхньому регістрі, без пробілів), `description`, `discountType!`: `percent | fixed`, `value!` (відсоток 1–100 або бані), `validFrom`, `validTo`, `maxUses` (null = без ліміту), `maxUsesPerClient` (null = без ліміту), `appliesToServices`, `appliesToExtras` (обидва порожні = на все), `onlineAllowed!` (true), `active!`, `usedCount` (readOnly).

### 4.17 `gift-certificates`
- `code!` uniq (`LU-XXXX-XXXX`, генерується), `nominal!`, `balance!` (readOnly), `issuedAt!`, `expiresAt!`, `status` (похідне: `active | depleted | expired | void`), `buyerName`, `buyerPhone`, `saleTransaction` rel, `comment`.
- Створюється тільки через операцію продажу (§5.7). Анулювати (`void`) може лише admin.

## 5. Бізнес-правила

### 5.1 Статуси запису

```
scheduled ──► completed ──► paid
    │  └─────────────────────▲   (оплата повної суми одразу завершує візит)
    ├──► cancelled_by_client
    ├──► cancelled_by_salon
    └──► no_show
```

| Перехід | Хто | Умови |
|---|---|---|
| scheduled → completed | персонал з доступом до запису | `startAt ≤ now` |
| scheduled/completed → paid | автоматично при `paidAmount ≥ total` під час дії «Оплатити» | — |
| scheduled → cancelled_by_client | клієнт за токеном (≥ `clientCancelMinHours` до початку) або персонал | — |
| scheduled → cancelled_by_salon | персонал | `cancelReason` обов'язковий |
| scheduled → no_show | персонал | `startAt ≤ now` |
| cancelled_* / no_show / completed → scheduled (відновити) | admin, manager | слот вільний |
| paid → completed | лише через refund (admin) | — |

- Передоплата: оплату можна провести в статусі `scheduled`. Тоді `paymentStatus = partial | paid`, а статус змінюється лише при завершенні: якщо оплачено повністю, одразу `paid`.
- При скасуванні запису з оплатою з'являється попередження «потрібне повернення». Refund робить admin.
- Склад послуг, ціни й знижки оплаченого запису змінює лише admin.
- `kind = block` має тільки статуси `scheduled` і `cancelled_by_salon`.

### 5.2 Робочий час барбера на дату D (локальна)
1. Якщо є виняток, що покриває D:
   - `day_off | vacation | sick` → неробочий день;
   - `custom_hours` → інтервал виключення та його перерви.
2. Інакше береться рядок `weeklySchedule` з `weekday = день тижня D`. Немає рядка → неробочий день.
3. Робочі інтервали = [start, end] мінус перерви. Локація дня = локація з винятку або шаблону.

### 5.3 Розрахунок вільних слотів (`computeSlots`, чиста функція)
Вхід: барбер(и), локація, дата D, тривалість для кожного барбера, налаштування, існуючі зайняті інтервали, `now`.
1. Тривалість = `durationMinutes` основної послуги + Σ додаткових з урахуванням `barber-prices`.
2. Вільні інтервали = робочі інтервали (§5.2) у локації запиту мінус зайняті. Зайняті — записи зі статусом `scheduled | completed | paid` будь-якого `kind`, кожен розширений на `bufferMinutes`.
3. Кандидати — моменти, вирівняні по сітці `slotStepMinutes` від 00:00 локального часу дня D.
4. Слот валідний, якщо `[t, t + тривалість]` повністю лежить в одному вільному інтервалі.
5. Онлайн-фільтри: `t ≥ now + minLeadMinutes`; D ≤ сьогодні + `horizonDays`; барбер `active` і `onlineBooking`; барбер надає послугу; клієнт не `blocked`.
6. «Будь-який барбер»: беремо об'єднання слотів усіх підхожих барберів локації. На етапі створення обирається барбер, вільний у цей слот, з найменшою кількістю записів у цей день; при рівності — менший `order`.
7. Персонал (CRM): фільтри п.5 не діють. Слот поза робочим часом дозволений з попередженням `OUTSIDE_SCHEDULE`. Перетин з іншим записом заборонений завжди.
8. Переходи на літній/зимовий час: дати 2026-03-29 і 2026-10-25 мають покриватися тестами.

### 5.4 Ціноутворення (`calculatePrice`, чиста функція)
1. Позиції: основна послуга + додаткові. Ціна й тривалість позиції = `barber-prices` (якщо задано) або базові.
2. `subtotal = Σ price`.
3. Промокод (якщо валідний, §5.5):
   - застосовні позиції = ті, що входять до `appliesTo*` (або всі, якщо списки порожні);
   - `percent` → `round(Σзастосовних × value / 100)`;
   - `fixed` → `min(value, Σзастосовних)`.
4. Ручна знижка (admin/manager): сума або відсоток від `subtotal − promoDiscount`, `≤ subtotal − promoDiscount`, причина обов'язкова.
5. `total = subtotal − promoDiscount − manualDiscount` (≥ 0).
6. Сертифікат не змінює `total`. Він покриває `min(balance, total − paidAmount)` під час оплати.
7. Ціни фіксуються в `lines` при створенні та при кожній зміні складу послуг, барбера або промокоду (`calculatePrice` перераховується). Зміна прайсу не впливає на наявні записи.
8. До вибору барбера фронт показує «від X» = мінімальна ціна серед підхожих барберів.

### 5.5 Промокоди
- Валідний, якщо: `active`; `now ∈ [validFrom, validTo]`; `usedCount < maxUses`; кількість нескасованих записів клієнта з цим кодом `< maxUsesPerClient`; для онлайн-запису також `onlineAllowed`; є хоча б одна застосовна позиція.
- `usedCount` +1 при застосуванні, −1 при скасуванні запису або знятті коду. Зміна відбувається в тій самій БД-транзакції, що й запис (конфлікт запису на документі промокоду захищає від перевищення ліміту).
- Код нечутливий до регістру. Помилки: `PROMO_NOT_FOUND`, `PROMO_EXPIRED`, `PROMO_LIMIT`, `PROMO_CLIENT_LIMIT`, `PROMO_NOT_APPLICABLE`.

### 5.6 Каси та ledger
- `cash-registers.balance` змінюється тільки в `afterChange` хуку `transactions` через атомарний `$inc` у тій самій транзакції (`req`).
- Скрипт `pnpm crm:recalc-balances` перераховує баланси з нуля; тест звіряє його з інкрементальними балансами.
- Виправлення помилок — тільки сторно (`reversal`, `refund`), яке створює дзеркальну операцію.
- Оплату можна провести лише в каси локації запису.

### 5.7 Сертифікати
- Продаж: створюється `transactions(type = certificate_sale)` + `gift-certificates(balance = nominal, expiresAt = issuedAt + 12 міс за замовчуванням)` в одній транзакції.
- Використання: при оплаті запису `certificateAmount ≤ balance`, сертифікат `active` і не прострочений. `balance` зменшується атомарним `$inc` з умовою `balance ≥ amount`.
- Refund оплати з сертифікатом повертає суму на баланс сертифіката.
- Онлайн: код лише перевіряється, а сума «до сплати» показується після сертифіката. Фактичне списання відбувається при оплаті в салоні.

### 5.8 Оплата запису
- Дія «Оплатити» створює `appointment_payment`: рядки «каса + сума», опційно сертифікат і чайові.
- Сума в рахунок запису = Σ`entries` + `certificateAmount` − `tipAmount`, і вона не може перевищувати `total − paidAmount`.
- Після оплати оновлюються `paidAmount`, `certificateAmount`, `tipAmount` і `paymentStatus` запису; якщо оплачено повністю, статус стає `paid`. Пишеться лог.
- Refund (admin): створює `refund` з дзеркальними entries, повертає сертифікат, перераховує `paidAmount`, статус `paid → completed`.

### 5.9 Захист від подвійного бронювання
- Створення й перенесення запису виконуються в БД-транзакції (MongoDB replica set):
  1. upsert документа-замка `booking-locks {barber, date}` з інкрементом `version`. Конкурентні транзакції на того самого барбера й день отримують WriteConflict.
  2. Повторна перевірка перетинів по БД.
  3. Запис документа.
- WriteConflict → до 3 повторів; потім помилка `SLOT_TAKEN`.
- Ту саму перевірку виконує `beforeChange` хук `appointments`, тому редагування через стандартну форму адмінки теж захищене.

### 5.10 Скасування і перенесення
- Скасування клієнтом: посилання `${FRONTEND_URL}/{lang}/booking/cancel/{token}`. Токен — 32 випадкові байти (base64url), у БД зберігається лише sha256. Дозволено, якщо `status = scheduled` і `startAt − now ≥ clientCancelMinHours`; інакше показується телефон салону.
- Перенесення персоналом (форма або drag-n-drop): змінюються `startAt`/`barber`. Якщо зміна барбера змінює ціну за `barber-prices`, перераховується `total` (з попередженням, якщо вже була оплата). Клієнту надсилається лист «перенесено». Пишеться лог `move`.

### 5.11 Історія змін
- `afterChange` хук `appointments` порівнює `previousDoc` і `doc` по значущих полях і пише `appointment-logs` з `req` (атомарно).
- Актор: `req.user` → `user`; публічний endpoint → `client`; jobs → `system`.

## 6. API

Усі endpoints — Payload custom endpoints у `src/endpoints/*`, з префіксом `/api`. Відповідь з помилкою має вигляд `{ error: { code, details? } }`, а HTTP-статус відповідає типу помилки.

### 6.1 Публічні (`/api/booking/*`, без авторизації, з rate limit)
- `GET /booking/config?locale=` — активні локації, барбери (`onlineBooking`), категорії, послуги, додаткові послуги, ціни «від», налаштування (step, lead, horizon).
- `GET /booking/days?location&barber|any&service&extras[]&from&to` — дні з вільними слотами (для календаря-вибору дати).
- `GET /booking/slots?location&barber|any&service&extras[]&date` → `[{ start, barbers?: [...] }]`.
- `POST /booking/quote` {вибір, promoCode?, certificateCode?} → `{ lines, subtotal, promoDiscount, total, certificateCover, toPay }` або код помилки.
- `POST /booking` {вибір, start, phone, firstName, lastName?, email?, language, promoCode?, certificateCode?, comment?, honeypot} → `{ id, start, end, barber, total }`. Дані наявного клієнта у відповіді не повертаються.
- `GET /booking/cancel/:token` → короткі деталі (дата, час, барбер, послуга) і `canCancel`.
- `POST /booking/cancel/:token` → скасування.
- Rate limit: 30 запитів/хв на IP для читання; 5 створень/год на IP і 3 активні майбутні записи на телефон.

### 6.2 CRM (`/api/crm/*`, тільки персонал, права через policy)
- `GET /crm/calendar?date&view=day|week&location&barber` — колонки (барбери), робочі інтервали, записи. Поля фільтруються за роллю: у чужих записах барбер бачить лише `{ start, end, busy }`.
- `GET /crm/slots` — як публічний, але в режимі персоналу (§5.3 п.7).
- `POST /crm/appointments`, `PATCH /crm/appointments/:id` (зміна складу, перенесення, ручна знижка, промокод).
- `POST /crm/appointments/:id/status` {status, reason?}.
- `POST /crm/appointments/:id/payments` {entries, certificateCode?, certificateAmount?, tip?}.
- `POST /crm/transactions/:id/refund` (admin), `POST /crm/transactions/:id/reverse`.
- `POST /crm/certificates/sell` {nominal, entries, buyer?}.
- `GET /crm/clients/lookup?phone=` — тільки admin/manager.
- `GET /crm/reports/clients|finance|salary` (§8).
- Довідники та прості CRUD — через стандартні колекції Payload з access-функціями.

## 7. Email
- Шаблони (React Email не використовуємо; прості HTML-шаблони в `src/emails/` + словники `ru/ro/en`): підтвердження (з посиланням на скасування), перенесення, скасування (клієнтом або салоном), нагадування.
- Відправка через job `sendAppointmentEmail` (повтори до 3 разів). Нагадування — запланований job кожні 5 хв: записи `scheduled` з `startAt ∈ [now + 24h − 5хв, now + 24h]` і `reminderSentAt = null`.
- Без email у клієнта листи не надсилаються.
- Кожен лист пишеться в лог (`action = email`).

## 8. Звіти
Параметри: період (локальні дати), локація (manager — тільки свої), барбер.
- **Клієнти**: для кожного клієнта — візити (`completed | paid`), останній візит, середній чек (середній `total` оплачених), кількість скасувань (клієнтом/салоном), no-show. Сортування й пошук за ім'ям/телефоном.
- **Дохід**: Σ надходжень у каси за типами (оплати, продаж сертифікатів) за період; розрізи: локація, каса, барбер (для оплат). Окремо — виручка за послугами (Σ`total` оплачених записів, включно з частиною, оплаченою сертифікатом).
- **Витрати**: за категоріями та касами.
- **Залишки кас**: поточний баланс + рух за період (на початок, прихід, розхід, на кінець).
- **Промокоди та сертифікати**: використання промокодів (кількість, сума знижок); сертифікати — продано, використано, залишок, прострочено.
- **Зарплата** (admin; барбер — свою): для кожного барбера `Σ нетто послуг × % + Σ нетто додаткових послуг × % + чайові` за оплатами в періоді (A13). Refund віднімається в періоді, коли його проведено.
- Експорт у CSV — для всіх звітів.

## 9. Нефункціональні вимоги
- Права перевіряються на сервері; тести прав обов'язкові для кожної ролі й кожного ресурсу з матриці §3.1.
- Обов'язкові unit-тести: `computeSlots`, `calculatePrice`, промокоди, інваріанти ledger. Integration-тести (mongodb-memory-server replset): подвійне бронювання (паралельні запити), access, оплата + баланс.
- Міграції: індекси та дефолти для наявних документів (`barbers`: `active`, `showOnSite`, `onlineBooking`, `color`, `locations` = локація за замовчуванням; `users`: існуючі ролі без змін).
- Seed: `pnpm seed` (заборонений при `NODE_ENV=production`) створює 1 локацію, 2 каси, 3 барбери з графіками й користувачами (admin, manager, 3 barber), категорії, 6 послуг, 3 додаткові послуги, перевизначення цін, 15 клієнтів, записи на ±7 днів у різних статусах, промокод, сертифікат, кілька витрат.
- Адаптивність: календар і модалки працюють від 360 px; на телефоні барбер за замовчуванням бачить свою колонку.
- Продуктивність: календар дня одним запитом (< 300 мс на 10 барберів × 60 записів); `select` і `depth: 0` у всіх CRM-запитах.
