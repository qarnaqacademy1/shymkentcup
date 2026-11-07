# Nazar 3.1 — Vercel и постоянная база

> Выпуск 4.0: код запушен в GitHub (`c1553bd`), 25 тестов и production-сборка прошли. Миграция `202611070002_nazar4` применена к существующей Neon PostgreSQL 7 ноября 2026 без пересоздания базы. Новый production ZIP 0.4.0 включает обязательные `tabs`, `history`, `declarativeNetRequest` и доступ к HTTP/HTTPS; точный origin сохранён для моста сайта. Публикация ожидает подтверждения CLI-входа Vercel; MCP-подключение не имеет доступа к команде. Исторические результаты ниже относятся к 3.1. См. [nazar4.md](nazar4.md).

## Фактический статус

Production **READY**: https://nazar-orpin.vercel.app . Проверены публичный сайт и API `/api/health` (HTTP 200, реальная PostgreSQL), Secure cookie, защита Origin/CSRF, MV3 exchange/replay/Bearer, запись и повторная отправка сессии/экспорт, PWA-ресурсы и production ZIP. Тестовый API-аккаунт удалён после проверки. Дата: 7 ноября 2026.

CLI подтвердил аккаунт `qarnaqacademy1-8878`, Hobby и команду `qarnaq-academy1` (`team_BpiRB3R3Az58PCYoURn4OQzm`). Создан новый `nazar` (`prj_nzerPL4Tc8HdNiOzG0Bu8hmG5O0U`). До создания `.vercel/project.json` отсутствовал; теперь содержит только эти IDs. Старый scope не используется. Другие проекты/домены Qarnaq Academy не изменены. Git push/connect не выполнялся.

После отдельного согласия пользователя и принятия им Marketplace terms создана **Neon Free** `nazar-postgres`, Frankfurt (`fra1`), подключена только к production Nazar. На новой пустой базе выполнен `prisma migrate deploy`; локальная SQLite и резервные ZIP сохранены, перенос личных данных не выполнялся. Production аккаунты создаются отдельно от локальных.

Успешный deployment: `dpl_6p6YWsL4FTEEr9Xnffd6kRnX9Bzz`, https://nazar-qp7k2camx-qarnaq-academy1.vercel.app . Публичный адрес — стабильный alias выше. Node 24.x. Секретный DATABASE_URL передан интеграцией; публичные WEB_ORIGIN/NAZAR_PUBLIC_ORIGIN равны точному alias, NODE_ENV=production. Локальный приватный файл `.vercel/.env.production.local` исключён из Git/upload, его не публиковать.

При первой публикации исправлены две реальные облачные ошибки: `npm ci` пропускал esbuild при NODE_ENV=production → `npm ci --include=dev`; TypeScript import отсутствовал в Node function → сборка `apps/api/dist/handler.js` и JavaScript entry `api/index.js`. Текущий API прошёл проверки. В runtime-log отмечено предупреждение pg о будущем изменении трактовки sslmode=require; текущая закреплённая версия проверяет сертификат (verify-full), отключение TLS не использовалось.

## Подготовленная архитектура

- Один Vercel проект с React/Vite static и Node function `api/index.js` → собранный handler.js. `/api/*` идёт в Express, SPA — в index.html; ZIP, PWA manifest, иконки и sw.js — статические файлы.
- Production: отдельная постоянная PostgreSQL (Neon/Supabase при доступном лимите/аккаунте). Нельзя хранить единственную БД в файловой системе Functions. На Vercel приложение отказывается работать с file: URL.
- Local: SQLite через прежний Prisma/libSQL. Два сгенерированных клиента и отдельные миграции: `apps/api/prisma` и `apps/api/prisma-pg`. Это не подстановка postgres URL в SQLite datasource.
- Общий rate limit в БД: атомарные счётчики fixed window, общий для экземпляров Functions, истёкшие ключи очищаются. IP в ключе хешируется. Ошибки хранилища не отключают лимит.
- Cookie __Host-nazar/Secure/HttpOnly/SameSite Strict на Vercel; только явные WEB_ORIGIN и точный VERCEL_URL данного deployment. Host проверяется по этим значениям, CORS без wildcard. Расширение использует credentials:omit и код/Bearer, старое исправление pairing сохранено.

## Порядок повторной публикации

1. Проверить аккаунт qarnaqacademy1-8878 и scope qarnaq-academy1; использовать существующий Nazar с ID prj_nzerPL4Tc8HdNiOzG0Bu8hmG5O0U. Другие проекты и домены не менять. В этой работе remote Git не менялся; origin `qarnaqacademy1/shymkentcup` не является доказательством назначения командой hackathon.kz, поэтому автопубликация от него не включена.
2. Через Vercel Marketplace подключить доступный PostgreSQL-провайдер. Не принимать платный тариф автоматически. Hobby допустим только для личного некоммерческого использования по условиям Vercel; бесплатный коммерческий хостинг не обещается. См. https://vercel.com/docs/plans/hobby .
3. В защищённых Vercel Environment Variables задать `DATABASE_URL` (pooled), `DIRECT_URL` для отдельного шага миграции, `WEB_ORIGIN=https://<реальный-nazar>.vercel.app`, `NAZAR_PUBLIC_ORIGIN` с тем же адресом, `NODE_ENV=production`. Значения не коммитить и не выводить. Для Preview — **другая тестовая БД**, не production credentials. Приложение также допускает точный VERCEL_URL текущего preview; cookies разных хостов не смешиваются.
4. Проверить источник изменений, выполнить `npm ci`, `npm run db:generate`, `npm run typecheck`, `npm test`. Секреты миграции передавать окружением. Выполнить `npm run db:migrate:production` на явно выбранной новой базе; не db push/reset.
5. Проверить `vercel project inspect --non-interactive --scope qarnaq-academy1` на соответствие выбранному Nazar. Если CLI не настроен, выполнить осознанный `npx vercel@65.12.1 login`, затем явный link существующего проекта nazar. Не обходить запрет team другим токеном/аккаунтом.
6. Preview deploy: `npx vercel@65.12.1 deploy --scope qarnaq-academy1`. `vercel.json` вызывает `npm run build:vercel`. Production ZIP строится только при HTTPS public origin. Защищённый preview проверять через vercel curl/допустимый access token, не отключая защиту глобально.
7. Проверить HTTPS `/api/health`, новый тестовый аккаунт, login, защищённый settings, code exchange с Origin Chrome, Bearer/sync, отсутствие чужих данных, `/downloads/nazar-extension.zip`, host_permissions ZIP, SPA reload на / и hash routes, manifest/icons/sw.js. По возможности установить PWA на Android/iPhone. Секреты не попадают в логи/скриншоты.
8. Production deploy: `npx vercel@65.12.1 deploy --prod --scope qarnaq-academy1`, только после правильного project inspect и проверки сборки. Зафиксировать реальный отвечающий URL, проверить те же ключевые границы с production credentials. Не выдавать имя проекта за работающий URL.

CLI не является зависимостью продукта: он был установлен для проверки авторизации и затем удалён из package.json. Используйте закреплённый npx при подготовке окружения; native Vercel connector предпочтительнее, если достаточен.

## Сохранность SQLite и перенос

`npm run db:migrate` перед изменением существующего SQLite делает VACUUM INTO снимок, integrity_check, ZIP с SHA-256 и количествами строк, затем повторно читает ZIP и проверяет хеш. Архивы в `data/backups` исключены из Git и Vercel. На Windows временная копия может остаться рядом из-за EBUSY; проверенный ZIP от этого не теряется. Старые миграции и таблицы пользователей не переписываются.

Необязательный перенос: `node --import tsx scripts/transfer-data.mjs`. Без `--apply` — только локальная инвентаризация, персональные данные не отправляются. Нужны приватные `LOCAL_DATABASE_URL` и `PRODUCTION_DATABASE_URL`. Применение требует `--apply --confirm-target=<точный host:port из разрешённого URL>`. Команда не запускается автоматически. Она создаёт backup, переносит User/Credential/PairCode/StudySession в одну PostgreSQL-транзакцию, проверяет количества по исходным id; конфликт вызывает rollback, повтор идентичен и не изменяет записи. RateLimit не переносится.

Откат до первого production использования: вернуть локальный DATABASE_URL и запустить прежний локальный режим; SQLite остаётся неизменной. После новых production записей нельзя просто переключаться и терять эти записи — требуется сверка/экспорт. Целевую БД не удалять. Перенос существующих личных данных в облако в этой работе **не выполнялся**.

## Режимы расширения

### Установка опубликованной версии

Сайт: https://nazar-orpin.vercel.app . Production ZIP: https://nazar-orpin.vercel.app/downloads/nazar-extension-production.zip . Локальная копия: `C:\shymkentcup\downloads\nazar-extension-production.zip`, распакованная: `C:\shymkentcup\apps\extension\dist-production`.

- Android: открыть сайт в Chrome → меню ⋮ → «Установить приложение» / «Добавить на главный экран».
- iPhone: открыть сайт в Safari → «Поделиться» → «На экран Домой».
- Chrome desktop, новая установка: распаковать production ZIP в постоянную папку → chrome://extensions → режим разработчика → «Загрузить распакованное расширение» → выбрать папку с manifest.json. На сайте создать аккаунт/войти, получить одноразовый код подключения, вставить его в popup Nazar.
- Если расширение уже установлено: завершить активную сессию, сохранить прежнюю папку. Для сохранения ID и local storage обновить файлы **в прежней загруженной папке** файлами production ZIP и нажать «Обновить» в chrome://extensions; старое расширение не удалять. Новый сайт использует отдельную облачную базу, локальные аккаунты автоматически не перенесены. Старую локальную очередь не удалять; перенос личных данных требует отдельного решения.

Перезапуск локального сервера для публичного сайта не нужен. Повтор smoke: `$env:NAZAR_PUBLIC_ORIGIN='https://nazar-orpin.vercel.app'; node --import tsx scripts/verify-production.ts`.

- `npm run build`: development → `apps/extension/dist`, `downloads/nazar-extension-development.zip`, API по NAZAR_API_URL (по умолчанию localhost:3001).
- `npm run build:production` с проверенным `NAZAR_PUBLIC_ORIGIN=https://...`: `apps/extension/dist-production`, `downloads/nazar-extension-production.zip`. Host permission только на этот HTTPS origin.
- ZIP выбранного режима копируется в web/dist/downloads/nazar-extension.zip. На опубликованном сайте это production ZIP, локально — development. В корне архива manifest.json. Не распространяйте тестовый production ZIP с адресом .invalid.
- Обновлять существующее расширение кнопкой «Обновить» в chrome://extensions, не удалять. Завершите текущую сессию перед обновлением. Папка dev остаётся прежней, id/key не меняются принудительно.

## Проверено без внешнего доступа

Локальная PostgreSQL 18 в отдельном временном кластере: настоящая миграция и HTTP auth/pairing/Chrome-session/mobile-session/idempotency/rate limit. Процесс остановлен после теста. Это проверка PostgreSQL-адаптации, **не** доказательство внешнего Neon/Supabase или Vercel deployment. Внешние HTTPS, preview, production, тариф/имя проекта и доступность ZIP по публичному URL пока не подтверждены.
