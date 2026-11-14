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
| 6 | Онлайн-запис — окрема секція лендингу `levelup-front` (`#booking`), прихована, доки не натиснуто «Записатися»; після натискання з'являється з плавним скролом до неї, увесь процес запису — всередині секції. Окремої сторінки `/booking` немає (лише `/[locale]/booking/cancel/[token]` для скасування з листа). |
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
- A20. Етап 4, `clients`: `phone` нормалізується в колекційному `beforeValidate` (а не в field-хуку), бо потрібна перевірка дубля. Помилки бізнес-правил — `APIError` (`src/crm/errors.ts`, `businessError`) з `data.code` = `PHONE_INVALID` (400) / `PHONE_TAKEN` (409) і перекладеним `message`. Унікальний індекс `phone_1` задано `unique: true` у схемі та міграцією `20261113_000002_clients` (та сама назва/ключі). `source` — вільний текст (`online | staff | import | назва старої CRM`). Барбер не має прямого доступу до колекції; ім'я+телефон клієнтів своїх записів він отримає через endpoint календаря (етап 13).
- A20. Етап 2, каталог: анонім читає лише `active`, будь-яка роль (admin, manager, barber, editor) — усе, пише лише admin (ресурс `catalog` у policy). Ціни зберігаються в банах; `moneyField` (`src/fields/money.ts`) підключає адмінські компоненти `MoneyField`/`MoneyCell` (ввід і показ у леях, MDL). `services.durationMinutes` > 0 і кратна 5; `extras.durationMinutes` ≥ 0 (ціле); `price` — ціле ≥ 0. Видалення категорії не чіпає послуги (`category` необов'язкова). Міграція не потрібна: колекції нові.
- A21. Етап 5, слоти (`src/crm/slots.ts`, `src/crm/slots.loader.ts`):
  - Сітка — за локальним настінним часом від 00:00 дня D (`localGridInstants`): у весняну ніч 03:xx немає, в осінню 03:00–03:45 дають по два різні моменти. Тривалість рахується в реальних хвилинах. Запис має закінчитися не пізніше локальної півночі (кінця дня D).
  - Інтервали напіввідкриті: запис може закінчитися рівно на початку іншого / перерви / кінця робочого дня. `bufferMinutes` розширює кожен зайнятий інтервал з обох боків і діє в обох режимах.
  - Робочий час рахується лише в локації запиту; день в іншій локації — онлайн-слотів немає, для персоналу — `OUTSIDE_SCHEDULE`.
  - Режим персоналу: `computeSlots` повертає всі кроки сітки дня без перетинів, з попередженням `OUTSIDE_SCHEDULE` для тих, що поза графіком; `checkSlot` для персоналу приймає будь-яку хвилину (не обов'язково по сітці). Онлайн `checkSlot` = «старт є серед `computeSlots`».
  - Автовибір (`pickBarber`, §5.3 п.6): у межах графіка → менше записів (`kind = appointment` з початком у день D; блоки не рахуються) → менший `order` (порожній — останнім) → менший id. Список `slot.barbers` відсортовано так само, тож перший — той, кого обере автовибір.
  - Коди: `SLOT_TAKEN` (перетин), `SLOT_UNAVAILABLE` (поза сіткою/графіком/`minLead`/горизонтом, барбер не підходить); лоадер — `SERVICE_NOT_FOUND`, `EXTRA_NOT_FOUND` (404).
  - Лоадер читає дані системно (`overrideAccess: true` без `user`, `depth: 0`, `select`), бо анонім не має доступу до графіків; він повертає лише похідні дані, а права на запит перевіряє endpoint (етапи 10, 13). Запити йдуть послідовно (безпечно всередині транзакції): налаштування, послуга, додаткові послуги, барбери, винятки, `barber-prices`, зайняті інтервали — фіксовано 6 + 1 незалежно від кількості барберів. Зайняті інтервали надходять через інтерфейс `BusySource`; до етапу 7 — заглушка без записів (`TODO(stage 7)`).
  - Лоадер не перевіряє `active`/`onlineBooking` послуги й додаткових послуг та `extras.appliesTo` — це валідація вибору в endpoint/сервісі записів (етапи 7, 10).
- A22. Етап 6, ціни та промокоди (`src/crm/pricing.ts`, `src/crm/promo.ts`, колекція `promo-codes`):
  - `calculatePrice` повертає `lines` (спершу послуга, далі додаткові), `durationMinutes`, `subtotal`, `promoBase` (Σ застосовних позицій), `promoDiscount`, `manualDiscount`, `manualDiscountReason`, `total`. Ціна перевизначення `0` — справжня (безкоштовна) ціна, порожнє поле — базова.
  - Застосовні позиції: якщо обидва списки `appliesTo*` порожні — усі; інакше лише перелічені (заданий тільки список послуг ⇒ додаткові послуги не входять). Значення промокоду: `percent` — ціле 1–100, `fixed` — ціле ≥ 1 бані.
  - Ручна знижка: `{ type: amount | percent, value, reason }`; `percent` 0–100 (дробовий дозволений, half-up через `percentOf`) від `subtotal − promoDiscount`. Нульова знижка = «немає знижки» (причина не потрібна, `reason = null`). Порушення — `PricingError` з кодом `DISCOUNT_INVALID` | `DISCOUNT_TOO_LARGE` | `DISCOUNT_REASON_REQUIRED`; адаптер перетворює його на `APIError` через `toRuleError` (`src/crm/errors.ts`). Перевірку ролі (лише admin/manager, рішення 30) робить сервіс записів (етап 7).
  - `certificateCoverage({ total, paidAmount, balance })` → `{ covered, toPay }`, `total` не змінюється.
  - Промокод: неактивний код і код без `onlineAllowed` в онлайн-режимі → `PROMO_NOT_FOUND` (не розкриваємо існування). Період — включні локальні дні `Europe/Chisinau` (поля `validFrom`/`validTo` з day-only picker, порівнюються як `YYYY-MM-DD`); і «ще не почався», і «закінчився» → `PROMO_EXPIRED`. Порядок перевірок: існує/активний → період → застосовні позиції → загальний ліміт → ліміт на клієнта.
  - Повторна перевірка коду, який уже стоїть у записі, що редагується: `alreadyApplied` віднімає його від `usedCount`, а `currentAppointmentId` виключає запис із підрахунку клієнта. Без `clientId` (онлайн-розрахунок до кроку телефону) ліміт на клієнта не перевіряється. Підрахунок використань клієнтом — через інтерфейс `PromoUsageSource`, до етапу 7 — заглушка `noPromoUsages` (`TODO(stage 7)`).
  - HTTP-статуси: `PROMO_NOT_FOUND` 404, `PROMO_LIMIT`/`PROMO_CLIENT_LIMIT` 409, решта 400; `message` перекладено мовою адмінки.
  - `promo-codes.code`: без пробілів, верхній регістр, лише літери (будь-якої абетки), цифри, `-`, `_`, до 32 символів; унікальний індекс `code_1` (міграція `20261113_000003_promo_codes`). `description` не локалізується. Поле «Знижка» в адмінці — ввід у MDL для `fixed` і число для `percent`.
  - Доступ: admin CRUD; manager і barber — R; editor і анонім — нічого (анонім перевіряє код лише через публічний endpoint). `usedCount`: читає персонал, через API не записується ніким (ігнорується), змінюється лише сервісом записів через `$inc` у транзакції (етап 7).
- A23. Етап 7, записи (`src/crm/appointments.ts`, `src/crm/appointment-status.ts`, колекції `appointments`, `appointment-logs`, `booking-locks`):
  - Правила живуть у хуках колекції: `prepareAppointment` (`beforeChange`) і `logAppointmentChange` (`afterChange`), тому форма адмінки, CRM- і публічні endpoints проходять один код. Endpoints викликають `createAppointment` / `updateAppointment` / `changeAppointmentStatus`: операція йде у власній транзакції з ≤ 3 повторами при WriteConflict, далі — `SLOT_TAKEN` (409). Форма адмінки працює в транзакції Payload без повторів: конфлікт одразу дає `SLOT_TAKEN`. Кожен виклик сервісу — зі своїм `req` (на ньому зберігається id транзакції).
  - Замок: `booking-locks {barber (id рядком), date}` — upsert з `$inc version` сирою моделлю в сесії транзакції; унікальний індекс `barber_1_date_1`. Замикається день початку запису. Відоме обмеження: при `bufferMinutes > 0` запис біля півночі не замикає сусідній день.
  - Режим і актор передаються через `req.context.appointmentOptions`: `mode` (`staff` за замовчуванням; публічний endpoint ставить `online`), `actorType` (за замовчуванням `user`, якщо є `req.user`, інакше `system`; скасування за токеном — `client`), `now`, `logAction`.
  - Серверні поля (`kind`, `source`, `createdBy`, `cancelTokenHash`, `statusChangedAt`, `cancelledAt`, `lines`, суми, `endAt`, `paymentStatus`) не беруться із запиту; `paidAmount`/`certificateAmount`/`tipAmount` змінюються лише з прапором `req.context.appointmentLedger` (етап 18). `kind` після створення не змінюється. `source`: користувач → `staff`, режим `online` → `online`, інакше передане значення або `import`.
  - Ручна знижка вводиться полями `manualDiscountType` (`amount | percent`), `manualDiscountValue`, `manualDiscountReason`; `manualDiscount` — обчислена сума (readOnly). Нульова знижка очищає тип і значення. Барбер і онлайн-запит з ненульовою знижкою → `DISCOUNT_FORBIDDEN` (403).
  - Перерахунок ціни: зміна послуги, додаткових послуг або барбера → ціни з каталогу й `barber-prices`; зміна лише промокоду чи знижки → від збереженого `lines`. Промокод, що вже стоїть у записі, повторно не перевіряється (період, ліміти) — лише перераховується сума; повна перевірка (§5.5) — для нового/зміненого коду й при відновленні скасованого запису.
  - `usedCount`: запис «використовує» код, якщо `promoCode` задано і статус не `cancelled_*` (`no_show` теж рахується). Зміна — `$inc` у тій самій транзакції.
  - Слот перевіряється, якщо статус активний і є створення, зміна часу/барбера/локації/складу/тривалості або відновлення. Тривалість — зі знімка (`SlotQuery.durationMinutes`), запис, що редагується, виключається з зайнятих. Персонал — будь-яка хвилина, поза графіком — попередження `OUTSIDE_SCHEDULE`; онлайн — `checkSlot` в онлайн-режимі. Барбер має працювати в локації запису (`BARBER_LOCATION_INVALID`). Блок: `durationMinutes > 0`, у межах одного локального дня (`BLOCK_TIME_INVALID`), перетин із буфером → `SLOT_TAKEN`.
  - Вибір: `extras.appliesTo` перевіряється завжди (`EXTRA_NOT_APPLICABLE`); онлайн — послуга й додаткові послуги мають бути `active` і `onlineBooking` (інакше `SERVICE_NOT_FOUND`/`EXTRA_NOT_FOUND`), клієнт обов'язковий (`CLIENT_REQUIRED`), заблокований клієнт → `SLOT_UNAVAILABLE`. Для `appointment` послуга обов'язкова (`SERVICE_REQUIRED`).
  - Статуси: при створенні лише `scheduled` (інший статус — тільки `system`, наприклад імпорт). У `paid` і з `paid` переходить лише ledger (етап 18). Завершення повністю оплаченого запису одразу дає `paid`. Скасування блоку причини не потребує. Скасування клієнтом — `actorType = client`, не пізніше `clientCancelMinHours` (`CANCEL_TOO_LATE`). При відновленні `cancelledAt = null`. Скасування запису з оплатою повертає попередження `REFUND_REQUIRED`. Інші коди: `STATUS_TRANSITION_INVALID`, `STATUS_TOO_EARLY`, `STATUS_FORBIDDEN`, `CANCEL_REASON_REQUIRED`.
  - Оплачений запис (`status = paid` або `paymentStatus = paid`): склад, барбера, промокод і знижку змінює лише admin (`APPOINTMENT_PAID_LOCKED`, 403).
  - Доступ: колекція — row-level (`rowAccessFor`): manager — `location ∈ свої`, barber — `barber = свій`; delete — лише admin. Ціль запису (нові локація/барбер) перевіряє хук: поза своєю зоною → `APPOINTMENT_FORBIDDEN` (403). Restore, ручна знижка й зміна оплаченого — ресурси policy `appointments.restore`, `appointments.discount`, `appointments.paid`.
  - Історія: один запис логу на операцію; `action` = `create` | `status` (якщо змінився статус) | `move` (час, барбер, локація) | `update`; `changes` — значущі поля (зв'язки як id, дати ISO), `from`/`to` зберігаються як є. У лозі продубльовано `location` і `barber` для row-level читання. Прапори `req.context`: `skipAppointmentLog` (пропустити), `appointmentLogging` (захист від рекурсії).
  - Токен скасування створюється для `kind = appointment` при створенні, повертається в результаті сервісу, у БД — лише sha256 (`cancelTokenHash`, hidden, індекс). `language` за замовчуванням — мова клієнта, далі `ru`.
  - `plannedCertificate` додасться разом із колекцією `gift-certificates` (етап 18).
  - `schedule-exceptions` отримали віртуальне поле `appointmentsInRange` (запланові записи барбера в діапазоні дат; рахується лише при читанні одного документа; бачать admin і manager).
  - Лоадер слотів за замовчуванням бере зайнятість з `appointments` (`appointmentsBusySource`), а `validatePromo` рахує використання клієнтом через `appointmentsPromoUsage`.
- A24. Етап 8, seed (`src/seed/`, `pnpm seed`, `pnpm seed:reset`):
  - Ключі ідемпотентності: e-mail користувача, назва (ru) каталогу, телефон клієнта, код промокоду, `externalId = seed:…` запису. Наявні записи не перезаписуються. Локація — наявна (з міграції етапу 1), інакше створюється.
  - Скидання (`seed:reset` / `SEED_RESET=true`; `payload run` забирає прапори CLI, тому `--reset` лише запасний варіант) повністю очищає `appointments`, `appointment-logs`, `booking-locks`, `barber-prices`, `schedule-exceptions`, `promo-codes`, `clients`; каталог, барберів і користувачів — лише за ключами seed. Локації, контент сайту та чужі користувачі не чіпаються.
  - Барбери seed мають `showOnSite = false` (не потрапляють на лендинг). Записи (±7 днів від запуску) створюються сервісом від `system`, статуси `completed`/`no_show`/`cancelled_*` — переходами. Запис у статусі `paid`, каси, витрати, сертифікат — TODO етапів 17–18.
  - `SEED_PASSWORD` читається через `env.seedPassword`; дефолт — у `.env.example`.
- A25. Етап 9, email і jobs (`src/emails/`, `src/crm/appointment-emails.ts`, `src/crm/reminders.ts`, `src/jobs/tasks.ts`):
  - Листи ставляться в чергу з `afterChange`-хука `appointments` (а не лише з сервісу), тож покриті й адмінка, і CRM-endpoints, і публічний запис; job додається в ту саму транзакцію, що й запис. Типи: створення → `confirmation`; зміна `startAt`/`barber`/`location` у `scheduled` → `moved`; `scheduled` → `cancelled_*` → `cancelled`. Не надсилаються: блоки, клієнт без email, запис у минулому, `options.skipEmail` (seed, імпорт). Відновлення запису листа не створює.
  - Мова листа: `appointments.language` → `clients.language` → `ru`. Без `RESEND_API_KEY` підключається консольний адаптер (лист у лог). `FRONTEND_URL` потрібен для посилання скасування.
  - Токен скасування (plain) лежить у input job `confirmation` до успішного завершення (job видаляється); у `appointment-logs` лист пишеться без адреси й токена (`changes: email {type, language}`) — лише після успішної відправки.
  - Нагадування: `reminderSentAt` захоплюється атомарно (`updateOne` з умовою `null`) перед відправкою й повертається в `null`, якщо відправка впала (job повторює). Перенесення запису скидає `reminderSentAt`. `confirmationSentAt` ставиться після підтвердження.
  - `jobs.autoRun` (кожну хвилину, черга `default`) вимкнено під vitest, під час `next build` і при `JOBS_AUTORUN=false`; розклад `queueAppointmentReminders` — `*/5 * * * *`.

- A26. Етап 10, публічний API запису (`src/endpoints/booking/*`, `src/crm/rate-limit.ts`, `src/crm/certificates.ts`, приклади — `docs/api-booking.http`):
  - Актор: усі записи йдуть через `publicRequest(req)` — локальний запит **без `user`** (навіть якщо прийшла cookie персоналу), тож сервіс записів застосовує онлайн-правила (`mode = online`, `actorType = client`, `source = online`, `createdBy = null`). Системні читання — явно через `SYSTEM_READ` (`overrideAccess`, `depth: 0`, завжди `select`); назовні йдуть лише похідні публічні дані. Картка нового клієнта — системний запис з `overrideAccess: true`.
  - Відповіді: `config` — локації, барбери (`active` + `onlineBooking` в активній локації; лише `name`, `position`, `description`, `image`, `locations` і їхні ціни/тривалості послуг і додаткових послуг), категорії, послуги, які хоч хтось надає онлайн (`priceFrom` = мінімум серед барберів), додаткові послуги (`appliesTo`, `appliesToAll`), публічні налаштування; кеш 60 с. `days` → `{ from, to, days[] }`: діапазон обрізається до [сьогодні, сьогодні + horizon] і ≤ 62 днів, фіксована кількість запитів (`loadSlotRange`). `slots` → `{ date, slots: [{ start, time, barbers: [{ id, end, durationMinutes }] }] }`, перший барбер = автовибір. `quote` без барбера (`any`) — найдешевший із можливих барберів, `priceFrom: true`; ліміт промокоду на клієнта тут не перевіряється (телефон невідомий). `POST /booking` → `{ id, start, end, barber: { id, name }, location, service, total, cancelToken }` — однаково для нового й відомого телефону. `cancelToken` — plain-токен щойно створеного запису (той самий, що в листі): фронт показує посилання скасування на екрані успіху, тож скасувати онлайн може й клієнт без email. Токен стосується лише цього запису й нічого не розкриває про телефон.
  - Клієнт за телефоном (E.164): знайдений — не змінюється; розбіжні ім'я/прізвище/email і код сертифіката дописуються в `clientComment` рядком `[online] firstName: …; lastName: …; email: …; certificate: …` (машинні ключі, без перекладу) після коментаря відвідувача. Лист іде на збережений email клієнта, а не на введений. Мова запису = мова форми. Новий клієнт створюється в тій самій транзакції (`source = online`); паралельне створення того самого телефону → повтор транзакції.
  - Ліміти (in-memory, A11; сховище замінюється `setRateLimitStore`): читання (`config`, `days`, `slots`, `quote`, обидва `cancel`) — 30/хв на IP; створення — 5 успішних/год і 20 спроб/год на IP, 10 спроб/год на телефон; ≤ 3 активних майбутніх (`scheduled`) записів на телефон (`ACTIVE_BOOKINGS_LIMIT`, 409). IP — запис `X-Forwarded-For` на позиції `TRUSTED_PROXY_HOPS` справа (за замовчуванням 1, див. `docs/deployment.md`). Honeypot — поле `honeypot`; непорожнє → `BOOKING_REJECTED` (400), рахується як спроба.
  - Коди помилок API: `VALIDATION_ERROR` (`details.fields`), `PHONE_INVALID`, `RATE_LIMITED` (429 + `Retry-After`), `BOOKING_REJECTED`, `BOOKING_DISABLED`, `LOCATION_NOT_FOUND`, `BARBER_NOT_FOUND`, `CERTIFICATE_NOT_FOUND`, `ACTIVE_BOOKINGS_LIMIT`, `TOKEN_INVALID` (404), `CANCEL_NOT_ALLOWED` (409, запис уже не `scheduled`), а також коди сервісів (`SLOT_*`, `SERVICE_*`, `EXTRA_*`, `PROMO_*`, `CANCEL_TOO_LATE`). `message` = код, текст перекладає фронт.
  - Сертифікат: до етапу 18 `findCertificate` — заглушка (`CERTIFICATE_NOT_FOUND`); етап 18 підключив `gift-certificates` і переніс код із `clientComment` у `plannedCertificate` (A34).
  - CORS — `config.cors` (`FRONTEND_URL`, `BACKEND_URL`): Payload додає заголовки й відповідає на preflight для custom endpoints.
- A27. Етап 11, секція запису у `levelup-front` (`app/[locale]/components/Booking/`, `app/[locale]/lib/booking/`):
  - Секція `#booking` рендериться лише після натискання «Записатися» (`BookingProvider` → `BookingSection`); перше натискання показує її, наступні лише скролять (`react-scroll`, як меню). Стан кроків живе в компоненті, не в URL (рішення власника): оновлення сторінки скидає вибір.
  - `NEXT_PUBLIC_BOOKING_PROVIDER` (за замовчуванням `easyweek`): `native` — кнопки відкривають секцію й віджет EasyWeek не підключається; `easyweek` — секції немає, кнопки мають клас-тригер віджета. Для локальної розробки додано `NEXT_PUBLIC_API_URL` і `NEXT_PUBLIC_BACKEND_URL` (за замовчуванням production).
  - Кроки: салон (прихований, якщо один) → барбер/«будь-який» (варіант «будь-який» лише якщо в салоні понад один барбер) → послуга → додаткові (пропускається, якщо жодна не підходить) → дата й час (календар за `/booking/days`, час за `/booking/slots`) → телефон → ім'я/прізвище/email → підсумок (`/booking/quote`, промокод і сертифікат) → екран успіху. Зміна раннього вибору скидає залежні (`patchState`). Поле коментаря в формі не виводиться (API його приймає).
  - Ціна «від X» у списках — лише для «будь-якого барбера», коли ціни барберів у салоні різні; у підсумку — за `quote.priceFrom`.
  - Екран успіху показує посилання `/{locale}/booking/cancel/{cancelToken}`; сторінка з'являється на етапі 12 (до того посилання веде на 404).
  - Телефон перевіряється `libphonenumber-js` (регіон `MD`) і відправляється в E.164; помилки API перекладаються ключами `errors.*` (`SLOT_TAKEN`/`SLOT_UNAVAILABLE` ведуть назад на вибір часу, `PHONE_INVALID` — на телефон). Паритет `messages/*.json` — `scripts/check-messages.mjs` (входить у `npm run lint`).
- A28. Етап 12, `levelup-front`: сторінка `/[locale]/booking/cancel/[token]` (`components/CancelBooking`, клієнтська, `noindex`) бере деталі з `GET /booking/cancel/:token?locale=`, скасовує через `POST`; якщо `canCancel = false` — повідомлення з `clientCancelMinHours` і телефон локації (запасний — `assets.salonPhone`). Формат посилання в листі (`buildCancelUrl`) збігається з маршрутом. Секція «Послуги» — серверний компонент: активні категорії й послуги за `order` (`depth=0`, `select`), група = картка; іконка картки — за позицією категорії (циклічно scissors/razor/brush), бо в `service-categories` немає поля іконки; послуги без категорії — в останній картці; при помилці API секція порожня.
- A29. Етап 13, CRM API календаря (`src/endpoints/crm/*`, приклади — `docs/api-crm.http`):
  - Кожен endpoint (`crmEndpoint`) спершу перевіряє `req.user` (401 `UNAUTHORIZED`) і роль персоналу (`editor` → 403 `FORBIDDEN`); формат помилок — як у публічному API. Помилки доступу Payload без коду отримують `FORBIDDEN`/`NOT_FOUND`. Запис поза зоною користувача (PATCH, `/status`, `slots?exclude`) → 404, існування не розкривається. Новий ресурс policy `calendar` (read — персонал).
  - Зона локацій (`locationScope`): admin — усі, manager — `users.locations`, barber — локації свого барбера; ролі об'єднуються (A15). Чужа локація → 403.
  - `GET /crm/calendar` → `{ view, date, from, to, location, locations[], barbers[], slotStepMinutes, columns[] }`, колонка = `{ barber {id, name, position, color, image, active, own}, date, off, intervals[], appointments[] }`. День — барбери локації (неактивні — лише якщо мають записи в діапазоні; своя колонка барбера — першою). Тиждень (A2) — 7 днів (пн–нд) одного барбера (`barber` або власний; інакше `VALIDATION_ERROR`). `intervals` — робочий час у цій локації без перерв; `off` = `no_schedule | day_off | vacation | sick | other_location`. Робочі інтервали колег барбер теж бачить (потрібні для сітки; онлайн-слоти їх і так розкривають).
  - Записи: `scheduled | completed | paid | no_show`, скасовані — з `cancelled=1`. Рядок, який користувач може читати за policy `appointments`, повертається з повними деталями (клієнт `{id, firstName, lastName, phone}`, послуга й додаткові послуги з назвами мовою `?locale`, суми, нотатки). Інакше — рівно `{ start, end, busy: true }` і лише для активних статусів. Email клієнта календар не повертає нікому. Клієнтів читає система (барбер не має доступу до колекції).
  - Кількість запитів фіксована: налаштування, локації, барбери, винятки, записи, клієнти, послуги, додаткові послуги, media (+1 для manager, +2 для barber — контекст), незалежно від кількості записів (тест на seed-даних).
  - `GET /crm/slots` — режим персоналу (`computeSlots`, `mode = staff`), `warnings` у кожного варіанта. Барбер отримує лише свої слоти (рішення 37; `any` для барбера = свій). `exclude` — редагований запис (доступ перевіряється), `duration` — знімок тривалості (лише з конкретним барбером). Барбер не з цієї локації → `BARBER_NOT_FOUND`.
  - `POST /crm/appointments`, `PATCH /crm/appointments/:id`, `POST …/:id/status` викликають сервіс записів з `req` користувача (`overrideAccess: false`), тож діють правила хуків (зона, ціни, слот під замком, статуси, історія, лист «перенесено»). Тіло: `start` (ISO), `promoCode` — текст коду (`null` знімає), `manualDiscount: {type, value, reason} | null`. PATCH приймає лише `location, barber, client, service, extras, start, durationMinutes, promoCode, manualDiscount, clientComment, internalNote, language, confirm` (статус — тільки через `/status`). Барбер без `barber` створює запис у своїй колонці; знайти клієнта не може (lookup — лише admin/manager), тож створює «Без імені».
  - Попередження потребують підтвердження: `OUTSIDE_SCHEDULE`, `PRICE_CHANGED` (`total` змінився без явної зміни складу/промокоду/знижки, тобто через зміну барбера), `HAS_PAYMENTS` (`total` змінився при `paidAmount > 0`), `REFUND_REQUIRED` (скасування з оплатою). Без `confirm: true` транзакція відкочується (нічого не змінено, лист не поставлено в чергу) і повертається 409 `CONFIRMATION_REQUIRED` з `details.warnings` (для PATCH ще `details.total {from, to}`). Успіх → `{ appointment, warnings }`.
  - `GET /crm/clients/lookup?phone=` — точний пошук за E.164 з правами користувача (`clients` read: admin, manager) → `{ client | null }`.
  - Автентифікація — `Authorization: Bearer <token>` або cookie адмінки (префікс `JWT` у цій версії Payload не приймається).
- A30. Етап 14, календар (денний перегляд): admin view `/calendar` (`src/components/calendar/`), пункт меню — `afterNavLinks`, доступ — policy `calendar` (інакше 404). Дані — `GET /api/crm/calendar?view=day`. Позиціонування — чисті функції `src/crm/calendar-layout.ts` (відступи в хвилинах від локальної півночі, коректно на DST); видиме вікно дня = робочі інтервали й записи ± 1 год (за замовчуванням 09:00–20:00); 120 px = година. Накладені блоки — смуги поруч. Блок «Новий запис» і клік по блоку — етап 15; на телефоні колонка часу липка, колонки скролляться, власна колонка барбера — перша (сортування в API).

- A31. Етап 15, модальне вікно запису (`src/components/calendar/Appointment*.tsx`, `src/crm/appointment-form.ts`, `src/endpoints/crm/appointment-detail.ts`):
  - Клік по блоку відкриває модалку (деталі, ціна по позиціях зі знімка `lines`, історія з `appointment-logs`, дії); клік по порожньому слоту колонки (admin/manager — будь-якої, barber — власної) або «Новий запис» відкриває форму створення зі стартом, округленим вниз до кроку сітки (`slotStartAt`; «Новий запис» — найближчий крок сьогодні або 10:00). Дії: редагувати, завершити (до початку — вимкнено), no-show (лише після початку), скасувати (хто скасував + причина; блок скасовується без причини), відновити (admin/manager), оплачений запис — редагує лише admin. Приховування кнопок — зручність, усі правила повторно перевіряє сервер (`appointmentActions`).
  - Нові ендпоїнти: `GET /crm/appointments/:id` (деталі + `lines` з назвами + `promoCode` текстом + `history` + `can {restore, discount, paid, update}`; запис поза зоною → 404; e-mail користувачів в історії — лише admin/manager) і `POST /crm/appointments/preview` (розрахунок ціни без запису тим самим `calculatePrice`/`validatePromo`; barber — лише власна колонка, ручна знижка → `DISCOUNT_FORBIDDEN`).
  - Клієнт вводиться телефоном: `clientPhone` (+ `clientFirstName`, `clientLastName`) у POST/PATCH — сервер сам знаходить картку за E.164 або створює нову (`source = staff`, мова = мова адмінки) системним записом у тій самій транзакції; наявна картка не змінюється, нова без імені → `VALIDATION_ERROR` `clientFirstName`, поганий телефон → `PHONE_INVALID`. Явний `client` має пріоритет. admin/manager додатково бачать пошук за телефоном (`/crm/clients/lookup`); barber вводить телефон і ім'я без пошуку. Наслідок для прав (рішення 36): barber бачить ім'я й телефон клієнта власного запису, тож, ввівши відомий телефон, дізнається ім'я цього клієнта — це той самий обсяг, що й для його звичайних записів.
  - Ручна знижка й промокод у формі — лише admin/manager; барбер їх не бачить і не надсилає. PATCH містить лише змінені поля (`buildPatchBody`), бо сервер визначає `PRICE_CHANGED` за наявністю полів ціноутворення в тілі.
  - Попередження (`CONFIRMATION_REQUIRED`) показуються панеллю зі списком і зміною суми; «Підтвердити» повторює той самий запит із `confirm: true`. Помилки сервера → `crm:errors.*` за машинним кодом (`src/crm/error-keys.ts` — безпечний для клієнта; `RULE_ERROR_KEYS` перенесено туди з `errors.ts`), невідомий код → `errors.unknown`, мережа → `errors.networkError`.
  - Каталог для форми (послуги, додаткові) — стандартний REST `/api/services`, `/api/extras` (читає будь-яка роль персоналу); додаткові фільтруються за `appliesTo`. Модалка — портал; на ≤ 640 px займає весь екран. Час — поле дати й часу (будь-яка хвилина), без вибору зі слотів; поза графіком — попередження сервера. У історії зв'язки (барбер, послуга, клієнт) показуються id, а не назвами.
- A32. Drag-n-drop (етап 16): `@dnd-kit/core`, миша (поріг 6 px) і touch (утримання 300 мс), прилипання до `slotStepMinutes`, тривалість не змінюється. Тягнути можна лише записи/блоки зі статусом `scheduled`; барбер — свої записи лише у своїй колонці, admin/manager — будь-які. Клієнт одразу показує нову позицію й викликає `PATCH /crm/appointments/:id` {start, barber?}; помилка → відкат і переклад коду помилки; `409 CONFIRMATION_REQUIRED` → діалог підтвердження (відкат при «Назад»/закритті). Права й накладки перевіряє сервер.

- A33. Етап 17, каси й ledger (`src/crm/ledger.ts` — чисті інваріанти, `src/crm/ledger.service.ts` — хуки й сервіс, колекції `cash-registers`, `expense-categories`, `transactions`, endpoint `POST /crm/transactions/:id/reverse`, скрипт `pnpm crm:recalc-balances`):
  - Інваріанти (`validateTransaction`, коди `LEDGER_*`, `EXPENSE_CATEGORY_*`, `COMMENT_REQUIRED`, `APPOINTMENT_REQUIRED`, `REVERSAL_TARGET_INVALID`, `ALREADY_REVERSED`): кожна entry — каса + ненульова ціла сума, одна каса не більше одного разу в операції; `expenseCategory` — лише в `expense`, `appointment`/`certificateAmount`/`tipAmount` — лише в `appointment_payment`/`refund`. `appointment_payment` без entries можливий, якщо `certificateAmount > 0` (оплата повністю сертифікатом), сума в рахунок запису > 0.
  - Усі каси операції належать її `location` (переказ між локаціями не підтримується); нові операції — лише в активні каси (`CASH_REGISTER_INVALID`); категорія витрат має бути активною. Каси не видаляються (деактивація); категорію, що використана у витратах, видалити не можна (`EXPENSE_CATEGORY_IN_USE`).
  - `appointment_payment`, `certificate_sale`, `refund` створюються лише сервісами етапу 18 (прапор `req.context.ledgerOptions.allowServiceTypes`), інакше `TRANSACTION_TYPE_UNSUPPORTED`. Сторно (`reversal`) — для `expense`, `transfer`, `adjustment`; оплату скасовує лише `refund` (етап 18); продаж сертифіката поки не сторнується (етап 18 вирішить разом з анулюванням сертифіката); сторно сторно заборонене.
  - Сторно будує сервер: дзеркальні entries, локація оригіналу, `occurredAt = now`; передані entries/локація ігноруються. Оригінал отримує `reversed = true` умовним атомарним оновленням у тій самій транзакції; додатково — частковий унікальний індекс `reverses_unique` (міграція `20261113_000005_ledger`).
  - Баланс: `afterChange` → `$inc` кожної каси в сесії транзакції `req`; від'ємний баланс → попередження `NEGATIVE_BALANCE` (A8) у результаті сервісу/endpoint. Конфлікт запису → до 3 повторів, далі `LEDGER_CONFLICT` (409). `author` = `req.user`; операція без користувача — системна (seed, скрипти).
  - Незмінність: після створення змінюються лише `comment` і `expenseCategory` (для витрати — обов'язкова й активна); решта полів ігнорується навіть при системному оновленні. Update — лише admin, delete — нікому.
  - Права: manager — `expense`/`transfer` у своїх локаціях і лише з `occurredAt` у поточному локальному дні (без заднього числа), сторно `expense`/`transfer` своїх локацій, проведених сьогодні (будь-ким); `adjustment` — лише admin. Manager читає операції й каси своїх локацій (з балансом) і категорії витрат. Barber читає всі каси без `balance`, операції — лише `appointment_payment`/`refund` зі своїм `barber` (етап 18); витрат, переказів і категорій не бачить. Editor — нічого. Endpoint сторно: операція поза доступом читання → 404.
  - `pnpm crm:recalc-balances`: агрегує Σ`entries.amount` по касах в одній транзакції й виправляє розбіжності; `RECALC_DRY_RUN=true` — лише звіт.
  - Seed: дві каси («Наличные», «Терминал (карта)»), 4 категорії витрат, початковий залишок (adjustment), 3 витрати й переказ — від імені seed-admin, лише якщо в касах ще немає операцій.
- A34. Етап 18, оплата записів і сертифікати (`src/crm/certificates.ts`, `src/crm/payments.ts` — чисті правила; `src/crm/certificates.service.ts`, `src/crm/payments.service.ts` — БД; колекція `gift-certificates`; endpoints `POST /crm/certificates/sell`, `POST /crm/appointments/:id/payments`, `POST /crm/transactions/:id/refund` у `src/endpoints/crm/payments.ts`; приклади — `docs/api-crm.http`):
  - Сертифікат: код `LU-XXXX-XXXX` з алфавіту `A–Z` + `2–9` без `0/O/1/I` (32 символи, `crypto.randomBytes`), унікальний індекс (міграція `20261114_000000_gift_certificates`); введений код нормалізується (регістр, пробіли, дефіси). `status` — віртуальне поле, рахується при читанні: `void` (прапорець `voided`, ставить admin) → `expired` (`expiresAt ≤ now`) → `depleted` (`balance = 0`) → `active`. Термін за замовчуванням — той самий локальний момент через 12 місяців (`addLocalMonths`), при продажу можна передати `expiresAt`.
  - Створення — лише продажем (`CERTIFICATE_SALE_ONLY` для прямого create): у одній транзакції документ сертифіката (`balance = nominal`, `issuedAt = now`) і `certificate_sale` (Σentries = nominal, усі каси — однієї локації; локація = локація першої каси, якщо не передано), потім системне посилання `saleTransaction`. Продають admin і manager (каси своїх локацій); barber, editor — ні. Після створення не змінюються `code`, `nominal`, `balance`, `issuedAt`, `saleTransaction`; admin змінює `voided`, `expiresAt`, покупця, коментар. Видаляти не може ніхто. `buyerName`/`buyerPhone` (E.164) читають лише admin/manager; barber бачить сертифікати (код, залишок, статус) для перевірки при оплаті.
  - Продаж сертифіката в v1 не сторнується (як у A33); помилковий продаж — анулювання сертифіката + `adjustment` admin. Переглянути, якщо знадобиться повне сторно продажу.
  - `transactions.certificate` — новий зв'язок: обов'язковий для `certificate_sale`; в `appointment_payment` — разом із `certificateAmount > 0` (`CERTIFICATE_REQUIRED`); для інших типів заборонений. Чайові в оплаті ≤ Σentries (`PAYMENT_TIP_INVALID`): сертифікат покриває лише запис (§5.4 п.6). `refund` копіює з оригіналу `certificate`, `certificateAmount`, `tipAmount` (для звітів і зарплати).
  - Оплата: лише записи (`kind = appointment`) у статусах `scheduled | completed | paid` (`APPOINTMENT_NOT_PAYABLE`); entries — додатні суми в каси локації запису; сума в рахунок запису > 0 (`PAYMENT_EMPTY`) і ≤ `total − paidAmount` (`PAYMENT_EXCEEDS_DUE`, 409). Сертифікат без явної суми покриває `min(balance, due − (Σentries − tip))`; явна сума ≤ `balance`; коди `CERTIFICATE_NOT_FOUND` (404), `CERTIFICATE_VOID`, `CERTIFICATE_EXPIRED`, `CERTIFICATE_INSUFFICIENT` (409). Списання — `findOneAndUpdate` з умовою `balance ≥ amount`, не `voided`, `expiresAt > now` у тій самій транзакції; паралельне списання дає WriteConflict → повтор → `CERTIFICATE_INSUFFICIENT`.
  - Статус після оплати (уточнення §5.1/§5.8): повністю оплачений `completed` → `paid`; `scheduled`, що вже почався (`startAt ≤ now`), → `paid` (оплата в кінці візиту його завершує); передоплата майбутнього візиту лишає `scheduled` з `paymentStatus = paid | partial`, а «Завершити» потім одразу дає `paid`. `paidAmount`/`certificateAmount`/`tipAmount` запису змінюються лише сервісом (контекст `appointmentLedger`) через сервіс записів з правами користувача; лог `payment` / `refund` зі змінами полів.
  - Права оплати: barber — лише свої записи, manager — записи своїх локацій, admin — усі; запис поза доступом читання → 404, сам сервіс також відмовляє (`TRANSACTION_FORBIDDEN`). Refund — лише admin (manager/barber → 403 `TRANSACTION_FORBIDDEN`), лише для `appointment_payment` (`REVERSAL_TARGET_INVALID`), один раз (`ALREADY_REVERSED`); повертає частину сертифіката на його баланс (незалежно від статусу сертифіката), зменшує суми запису, `paid → completed`, `paymentStatus = refunded`, якщо оплачено 0. Після refund запис можна оплатити знову.
  - Онлайн-запис: `findCertificate` шукає в `gift-certificates` (знайдено лише `active`), код більше не дописується в `clientComment`, а зберігається як `appointments.plannedCertificate` (без списання).
  - Seed: сертифікат 1000 MDL (картою, тиждень тому, `comment = seed:certificate`), оплати ~80% завершених візитів (каса/картка, інколи чайові; один — частково сертифікатом), одна передоплата 50% майбутнього візиту. Оплати мають окрему псевдовипадкову послідовність, тож набір записів не змінився.

- A35. Етап 19, UI фінансів (`src/components/finance/`, `src/components/calendar/PaymentTab.tsx`; чиста логіка — `src/crm/payment-form.ts`, `src/crm/finance.ts`, `src/crm/certificate-code.ts`; тести — `tests/int/payment-form.int.spec.ts`):
  - Вкладка «Оплата» в модалці запису (лише `kind = appointment`; вкладка й повідомлення живуть у `AppointmentModal`, тому переживають перезавантаження деталей): рядки «каса + сума» — активні каси локації запису (REST `/cash-registers`, права користувача), перший рядок заповнений «готівка на всю суму до сплати»; чайові; сертифікат за кодом (REST `/gift-certificates?where[code][equals]`, код нормалізується, показується залишок і термін, `void/expired/depleted` — помилка до відправки); підсумок «до сплати / прийнято / залишок або решта». Решта = надлишок над сумою до сплати: сервер переплату відхиляє (A34), тому UI блокує кнопку й радить зменшити суму або внести надлишок як чайові. Підсумок рахує `summarizePayment` через ті самі `planPayment`/`PAYABLE_STATUSES`, що й сервер, тож повідомлення збігаються з кодами сервера.
  - Історія оплат запису — REST `/transactions?where[appointment][equals]` (barber бачить лише свої, §3.1); «Повернути» — лише admin (`POST /crm/transactions/:id/refund`, з підтвердженням і коментарем). Кнопки лише відображають роль; рішення за сервером.
  - Admin view `/cash` «Каси» (policy `finance`: admin і manager; barber/editor — 404, пункт меню лише для admin/manager): картки кас з балансом (клік = фільтр «рух по касі»; від'ємний баланс червоним), швидкі форми «Витрата» (`POST /transactions`, сума від'ємна), «Переказ» (дві entries, одна локація — A33), «Продаж сертифіката» (`POST /crm/certificates/sell`; один рядок без суми = весь номінал; термін за замовчуванням 12 міс.; після продажу показується код), список операцій (REST `/transactions`, нові зверху, по 30, «Показати ще») з фільтрами: період (локальні дні), тип, каса, локація. Сторно (`POST /crm/transactions/:id/reverse`) пропонується для `expense`/`transfer` (manager — лише сьогоднішні) і `adjustment` (admin); оплата повертається лише refund-ом із запису, продаж сертифіката не сторнується (A33/A34).
  - Попередження `NEGATIVE_BALANCE`: endpoints повертають його в `warnings`; для витрат/переказів через REST попередження немає, тому після запису UI перечитує задіяні каси й показує його сам. Помилки стандартного REST читаються з `errors[0].data.code` (`crmRequest`), решта — переклад `errors.unknown`.
  - Суми — лише через `formatMoney`/`parseLeiInput`; адаптивність: від 720 px операція — картка, підсумок і рядки кас — в одну колонку, модалка на телефоні на весь екран.
  - Клієнтський код не імпортує `certificates.ts` (там `node:crypto`): формат коду винесено в `certificate-code.ts` (реекспорт зі старого місця).
- A36. Етап 20, тижневий режим і винятки графіка з календаря (`ScheduleExceptionModal`, `ColumnHeader`, `Toolbar`, `DayGrid`; `src/endpoints/crm/schedule-exceptions.ts`; тести — `tests/int/calendar-move.int.spec.ts`, `tests/int/crm-api.int.spec.ts`):
  - Перемикач «День / Тиждень» у тулбарі; у тижні — вибір барбера (список `barbers[]` приходить у `GET /crm/calendar` в обох режимах: `{ id, name, own }` барберів локації). Тиждень відкривається з власним барбером, інакше з першою колонкою дня; зміна локації повертає в денний режим (барбери різні). Кроки «‹ ›» — на 7 днів.
  - Колонка в тижні = день (`barber.id|date`), шапка — день тижня й дата; блоки, модалка, створення кліком і DnD — ті самі, що й у дні. DnD у тижні переносить і по днях: новий `start` = та сама позиція (хвилини від локальної півночі) у цільовому дні + зсув (`movedStart`, правильно в дні переходу часу); барбер змінюється лише в денному режимі. Діапазон годин сітки — об'єднання діапазонів колонок, кожен у своїй даті; лінія «зараз» у тижні лише в колонці сьогодні; колір блока — за барбером.
  - Меню «⋯» у шапці колонки (admin/manager; сервер перевіряє права через policy `schedule-exceptions`): «Додати графік» (`custom_hours`, локація — календаря), «Вихідний», «Відпустка». Модалка: дати (за замовчуванням — дата колонки), години для графіка, коментар. Створення — стандартний REST `POST /api/schedule-exceptions` (ті самі валідації й перетин винятків; повідомлення валідації показуються як є, бо вже перекладені сервером). Меню створює лише нові винятки; редагування й видалення існуючих — у колекції `schedule-exceptions`.
  - Попередження про записи (§4.5): перед збереженням модалка викликає `GET /crm/schedule-exceptions/preview?barber&dateFrom&dateTo` → `{ count, appointments: [{ id, start }] }` (записи зі статусом `scheduled`; без персональних даних; доступно тим, хто може створити виняток для цього барбера, інакше 403). Записи не скасовуються автоматично. Для `sick` і перерв у меню немає (лише в колекції).

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
- `POST /booking` {вибір, start, phone, firstName, lastName?, email?, language, promoCode?, certificateCode?, comment?, honeypot} → `{ id, start, end, barber, total, cancelToken }`. Дані наявного клієнта у відповіді не повертаються.
- `GET /booking/cancel/:token` → короткі деталі (дата, час, барбер, послуга) і `canCancel`.
- `POST /booking/cancel/:token` → скасування.
- Rate limit: 30 запитів/хв на IP для читання; 5 створень/год на IP і 3 активні майбутні записи на телефон.
- Формати відповідей, коди помилок і ліміти спроб — A26; приклади запитів — [api-booking.http](api-booking.http).

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
- Формати відповідей, попередження й підтвердження — A29; приклади — [api-crm.http](api-crm.http).
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
