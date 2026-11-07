# Происхождение

Дополнение 7 ноября 2026: версия 3.1 разработана в том же репозитории по NAZAR_FINAL_CODEX_3_1.txt. Добавлены @prisma/adapter-pg 7.10.1 и pg 8.23.1; Vercel CLI 65.12.1 временно использован только для проверки входа и не оставлен зависимостью приложения. Изображения с подписью v31 — скриншоты локального UI. Attention Map /#demo явно содержит контролируемые временные метки, не пользовательские измерения. API/SQLite/PostgreSQL и браузерные тесты отделены от неподтверждённого cloud deployment. Даты/авторство Git не изменялись.

Исходники MVP созданы 6 ноября 2026 в этом рабочем каталоге с помощью Codex по заданию пользователя. Изначально были README и пользовательский `условия.txt`; готовый сторонний проект не копировался. Документ сохранён. История Git, авторство и даты не фабриковались. AI-помощь не скрывается.

Инфраструктурные зависимости: React, Vite, Express, Prisma, libSQL, Zod, @node-rs/argon2, Helmet, express-rate-limit, cookie-parser, dotenv, TypeScript, tsx, esbuild, concurrently, Prettier, fflate. Точные версии и происхождение — package.json/package-lock.json, лицензии — соответствующие npm-пакеты. Это сторонние библиотеки, не готовый продукт. При сомнениях трактовку ограничений хакатона согласует команда с организаторами.

Версии проверялись через npm; Prisma 8 RC не выбран, используется стабильный 7.10.1. Найденные npm audit уязвимости устранены обновлением зависимостей. Иконка и CSS созданы в проекте, внешних фотографий нет. Скриншоты — локальный сайт и отдельный тестовый аккаунт, не пользовательское исследование.

Официальные источники, использованные при реализации:

- https://developer.chrome.com/docs/extensions/reference/api/history
- https://developer.chrome.com/docs/extensions/reference/api/permissions
- https://developer.chrome.com/docs/extensions/reference/api/tabs
- https://developer.chrome.com/docs/extensions/reference/api/windows
- https://developer.chrome.com/docs/extensions/reference/api/idle
- https://developer.chrome.com/docs/extensions/reference/api/storage
- https://developer.chrome.com/docs/extensions/reference/api/alarms
- https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
- https://developer.chrome.com/docs/extensions/develop/concepts/network-requests
- https://vite.dev/guide/
- https://expressjs.com/
- https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/sqlite
