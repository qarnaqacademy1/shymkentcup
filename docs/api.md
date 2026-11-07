# API

## Дополнения 3.1

Session имеет необязательные `source: extension|mobile`, `note` (до 500), `decisions[]` и `interruption`. У старых принятых payload эти поля не добавляются автоматически: каноническая сериализация/хеш сохраняется. Exception может иметь expiresAt и until=time|session; старый вариант без expiresAt по-прежнему действует до конца сессии. Decision: domain?, at, kind=budget|context, action=return|allow5|allow-session|details, expiresAt?.

`source=mobile` принимается только с проверенной web cookie и `ownerId` в теле, строго совпадающим с владельцем cookie. Переданный ownerId не является авторизацией: это дополнительная проверка принадлежности локальной очереди. Интервалы сайтов, предупреждения/исключения/решения для mobile запрещены. Chrome требует прежний device bearer и совпадающий instanceId. Старый source отсутствует → отображается как прежний Chrome-отчёт без изменения записи.

GET /api/stats дополнительно возвращает mobileSessions, extensionSessions, warnings, exceptions и overBudgetMs. withinBudget считает только Chrome-сессии. trackedMs/distractedMs по-прежнему вычисляются только по интервалам, mobile их не увеличивает. Период в UI — последние 24 часа/7/30 дней. Settings.weeklyGoal — необязательное целое 0..100, 0 отключает ориентир.

GET /api/export (web cookie) — JSON своих данных без passwordHash/токенов; `?format=csv` — CSV с источником, длительностью и note, формулы экранированы. GET /api/config — публичные extensionMode и mobileMonitoring=false. Все приватные ответы no-store. RateLimit теперь общий в SQLite/PostgreSQL, не память отдельного процесса.

Дальше — совместимые базовые маршруты.

JSON. Все мутации: X-Nazar:1. Сайт использует cookie, worker — Authorization: Bearer. Владелец определяется только сервером. Общие схемы — packages/shared/src/index.ts.

Worker всегда использует `credentials: omit`. Единственное исключение из cookie-проверки Origin: POST /api/pair/exchange с корректным `chrome-extension://<32 символа a–p>` — авторизация одноразовым кодом, а не cookie. Origin не является удостоверением устройства. Cookie, случайно присланный старой сборкой, здесь не используется и не меняется. Остальные мутации расширения допускаются только на маршрутах устройства с Bearer; валидность токена/владелец проверяются существующим auth middleware. Чужие web origins отклоняются даже без cookie. X-Nazar, одноразовость/TTL и rate-limit сохранены. CORS credentialed-ответы выдаются только конкретным web origins; service worker использует host_permissions для API, без расширения CORS allowlist на все расширения.

| Метод / путь | Доступ | Контракт |
| --- | --- | --- |
| GET /api/health | Нет | SELECT 1 → ok |
| POST /api/auth/register | Нет, rate-limit | email/password → id/email и cookie, 201 |
| POST /api/auth/login | Нет, rate-limit | email/password → id/email и cookie |
| GET /api/auth/me | Любой credential | id/email |
| POST /api/auth/logout | Любой | Отзыв текущего credential |
| POST /api/pair/code | Cookie | code/expiresAt, старый код удаляется |
| POST /api/pair/exchange | Нет, rate-limit | code/instanceId UUID → token/expiresAt/ownerId/email/instanceId |
| GET /api/devices | Cookie | Свои устройства без токенов/хешей |
| DELETE /api/devices/:id | Cookie | Отзыв своего устройства |
| GET/PUT /api/settings | Любой | domains[],budgetMs,timezone,shareHistory |
| PUT /api/sessions/:clientSessionId | Device | Session → id/synced; 201 создание, 200 повтор, 409 конфликт |
| GET /api/sessions?page=0 | Любой | По 30 сессий, новые первыми |
| GET /api/sessions/:id | Любой | Свой отчёт, чужой id → 404 |
| GET /api/stats?from=epochMs&to=epochMs | Любой | Полуоткрытый диапазон до 366 дней, totals/days/sessions/completed/taskDone/withinBudget/timezone |
| GET/PUT/DELETE /api/history | Любой | Последний снимок / замена при согласии / удаление |
| DELETE /api/account | Cookie + password | Каскадное удаление своего аккаунта |

Session: clientSessionId,instanceId UUID; goal; startedAt/endedAt; plannedMs/elapsedMs; status completed/interrupted; taskDone; rules Settings; intervals:[start,end,domain,distracting]; exceptions:[domain,at]; warnings:[at,kind:budget] максимум одно. Миллисекунды UTC. userId не принимается. Итоги trackedMs/distractedMs/overBudgetMs вычисляет сервер. Сохранённый отчёт не редактируется.

HistorySnapshot: from/to epochMs, complete, domains:[domain,visits], период не более 7 дней. URL/заголовков нет, PUT заменяет снимок. Выключение shareHistory удаляет сводку.

Ошибки `{error:string}`: 400 схема/код; 401 нет/истёк credential; 403 источник/тип credential/согласие; 404 нет своей записи; 409 email/содержимое повтора; 413 размер; 429 частота; 500 без внутренних деталей. Production proxy требует явной настройки доверия к реальному proxy, не trust proxy для всех.
