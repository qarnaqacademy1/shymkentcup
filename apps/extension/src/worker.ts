import {
  defaults,
  createActive,
  settle,
  pause,
  resume,
  except,
  decide,
  decisionSchema,
  domainOf,
  totals,
  countVisits,
  canUpload,
  settingsSchema,
  type Active,
  type Session,
  type Settings,
  type HistorySnapshot,
} from "@nazar/shared";
declare const __API_URL__: string;
declare const __WEB_URL__: string;
type Auth = {
  token: string;
  ownerId: string;
  email: string;
  instanceId: string;
  expiresAt: string;
};
type QueueItem = {
  ownerId: string;
  instanceId: string;
  session: Session;
  attempts: number;
  nextAt: number;
};
interface Store {
  instanceId: string;
  auth: Auth | null;
  settings: Settings;
  active: Active | null;
  queue: QueueItem[];
  lastSync: number | null;
  syncStatus: string;
  history: HistorySnapshot | null;
  historyOwner: string | null;
  lastResult: Session | null;
  notificationBlocked: boolean;
}
let store: Store;
let chain = Promise.resolve();
const serial = <T>(fn: () => Promise<T>): Promise<T> => {
  const p = chain.then(fn);
  chain = p.then(
    () => {},
    (e) => console.warn("Nazar operation failed:", e.message),
  );
  return p;
};
const persist = async () => {
  await chrome.storage.local.set({ nazar: store });
  if (chrome.action) {
    const a = store.active;
    await chrome.action.setBadgeText({
      text: a
        ? a.pausedAt !== null
          ? "Ⅱ"
          : a.session.warnings.length
            ? "!"
            : String(Math.max(1, Math.ceil((a.deadline - Date.now()) / 60000)))
        : "",
    });
    await chrome.action.setBadgeBackgroundColor({
      color: a?.session.warnings.length ? "#99642d" : "#286447",
    });
  }
};
async function request(
  path: string,
  method = "GET",
  body?: unknown,
  anonymous = false,
) {
  const res = await fetch(__API_URL__ + path, {
    method,
    // Device requests use a pairing code or bearer, never the website's cookie.
    credentials: "omit",
    headers: {
      "Content-Type": "application/json",
      "X-Nazar": "1",
      ...(!anonymous && store.auth
        ? { Authorization: "Bearer " + store.auth.token }
        : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(8000),
  });
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 401) {
      store.syncStatus = "Нужен вход";
      await persist();
    }
    throw new Error(data.error || "Сервер недоступен");
  }
  return data;
}
async function sync(force = false) {
  if (!store.auth) {
    store.syncStatus = "Нужен вход";
    await persist();
    return;
  }
  try {
    await request("/api/auth/me");
    store.settings = settingsSchema.parse(await request("/api/settings"));
    for (const item of [...store.queue]) {
      if (!canUpload(item, store.auth) || (!force && item.nextAt > Date.now()))
        continue;
      try {
        await request(
          "/api/sessions/" + item.session.clientSessionId,
          "PUT",
          item.session,
        );
        store.queue = store.queue.filter((x) => x !== item);
        await persist();
      } catch (e) {
        item.attempts++;
        item.nextAt =
          Date.now() +
          Math.min(3600000, 15000 * 2 ** Math.min(item.attempts, 8));
        await persist();
        throw e;
      }
    }
    store.lastSync = Date.now();
    store.syncStatus = store.queue.some((q) => canUpload(q, store.auth))
      ? "Ожидает отправки"
      : "Синхронизировано";
  } catch (e: any) {
    store.syncStatus =
      store.syncStatus === "Нужен вход"
        ? "Нужен вход"
        : "Сохранено локально · " + e.message;
  }
  await persist();
}
async function finish(interrupted = false, done = false) {
  if (!store.active) return;
  const a = store.active;
  a.session.status = interrupted ? "interrupted" : "completed";
  a.session.taskDone = done;
  store.lastResult = structuredClone(a.session);
  if (store.auth)
    store.queue.push({
      ownerId: store.auth.ownerId,
      instanceId: store.instanceId,
      session: structuredClone(a.session),
      attempts: 0,
      nextAt: 0,
    });
  store.active = null;
  store.syncStatus = "Ожидает отправки";
  await persist();
}
async function observeHost() {
  const idle = await chrome.idle.queryState(120);
  if (idle !== "active") return null;
  const windows = await chrome.windows.getAll();
  const focused = windows.find((w) => w.focused && w.type === "normal");
  if (!focused?.id) return null;
  const tabs = await chrome.tabs.query({ active: true, windowId: focused.id });
  const url = tabs[0]?.url;
  return url && /^https?:\/\//.test(url) ? domainOf(url) : null;
}
async function checkpoint(now = Date.now(), override?: null) {
  const a = store.active;
  if (!a) return;
  const warned = a.session.warnings.length;
  if (now < a.lastCheckpoint || now - a.lastCheckpoint > 45000) {
    a.session.interruption =
      now < a.lastCheckpoint ? "clock-backwards" : "checkpoint-gap";
    await finish(true);
    return;
  }
  settle(a, now);
  if (a.session.warnings.length > warned) {
    try {
      const permission = await chrome.notifications.getPermissionLevel();
      store.notificationBlocked = permission !== "granted";
      if (permission === "granted")
        await chrome.notifications.create(
          "budget-" + a.session.clientSessionId,
          {
            type: "basic",
            iconUrl: "icon.png",
            title: "Nazar · бюджет сайтов исчерпан",
            message: `Цель: ${a.session.goal}. Откройте Nazar и выберите следующий шаг.`,
          },
        );
    } catch {
      store.notificationBlocked = true;
    }
  }
  if (a.pausedAt === null && now >= a.deadline) {
    await finish();
    return;
  }
  a.host =
    a.pausedAt !== null || override === null ? null : await observeHost();
  await persist();
}
async function init() {
  await chrome.storage.local.setAccessLevel({
    accessLevel: "TRUSTED_CONTEXTS",
  });
  const saved = (await chrome.storage.local.get("nazar")).nazar;
  store = (saved as Store) || {
    instanceId: crypto.randomUUID(),
    auth: null,
    settings: defaults,
    active: null,
    queue: [],
    lastSync: null,
    syncStatus: "Нужен вход",
    history: null,
    historyOwner: null,
    lastResult: null,
    notificationBlocked: false,
  };
  if (store.active) {
    store.active.session.interruption = "worker-restart";
    await finish(true);
  }
  await persist();
  chrome.idle.setDetectionInterval(120);
  await chrome.alarms.create("checkpoint", { periodInMinutes: 0.5 });
  await chrome.alarms.create("sync", { periodInMinutes: 1 });
}
const ready = init();
function event(override?: null) {
  const at = Date.now();
  void serial(async () => {
    await ready;
    await checkpoint(at, override);
  });
}
chrome.tabs.onActivated.addListener(() => event());
chrome.tabs.onUpdated.addListener((_id, change) => {
  if (change.url || change.status === "complete") event();
});
chrome.tabs.onRemoved.addListener(() => event());
chrome.windows.onFocusChanged.addListener((id) =>
  event(id === chrome.windows.WINDOW_ID_NONE ? null : undefined),
);
chrome.idle.onStateChanged.addListener((state) =>
  event(state === "active" ? undefined : null),
);
chrome.alarms.onAlarm.addListener(
  (alarm) =>
    void serial(async () => {
      await ready;
      await checkpoint();
      if (alarm.name === "sync" || !store.active) await sync();
    }),
);
setInterval(() => event(), 15000);
async function importHistory() {
  if (!(await chrome.permissions.contains({ permissions: ["history"] })))
    throw Error("Доступ к истории не разрешён. Таймер продолжает работать.");
  const to = Date.now(),
    from = to - 7 * 86400000;
  const pages = await chrome.history.search({
    text: "",
    startTime: from,
    endTime: to,
    maxResults: 500,
  });
  let complete = pages.length < 500;
  const domains: Record<string, number> = {};
  let processed = 0;
  for (const p of pages) {
    if (!p.url) continue;
    const d = domainOf(p.url);
    if (!d) continue;
    const visits = await chrome.history.getVisits({ url: p.url });
    if (visits.some((v) => typeof v.isLocal !== "boolean")) complete = false;
    if (visits.length > 10000) complete = false;
    const n = countVisits(visits.slice(0, 10000), from, to);
    domains[d] = (domains[d] || 0) + n;
    processed += visits.length;
    if (processed >= 50000) {
      complete = false;
      break;
    }
  }
  store.history = {
    from,
    to,
    complete,
    domains: Object.entries(domains)
      .filter(([, v]) => v > 0)
      .map(([domain, visits]) => ({ domain, visits }))
      .sort((a, b) => b.visits - a.visits),
  };
  store.historyOwner = store.auth?.ownerId || null;
  await persist();
  return store.history;
}
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return false;
  void serial(async () => {
    await ready;
    await checkpoint();
    switch (msg.type) {
      case "state":
        break;
      case "connect": {
        if (store.active) throw Error("Сначала завершите текущую сессию");
        store.auth = await request(
          "/api/pair/exchange",
          "POST",
          { code: String(msg.code).trim(), instanceId: store.instanceId },
          true,
        );
        store.history = null;
        store.historyOwner = null;
        store.lastResult = null;
        await persist();
        await sync(true);
        break;
      }
      case "disconnect":
        if (store.active) throw Error("Сначала завершите сессию");
        try {
          await request("/api/auth/logout", "POST");
        } catch {}
        store.auth = null;
        store.history = null;
        store.lastResult = null;
        store.settings = structuredClone(defaults);
        store.syncStatus = "Нужен вход";
        await persist();
        break;
      case "start": {
        if (!store.auth) throw Error("Подключите аккаунт");
        if (store.active) throw Error("Сессия уже идёт");
        await sync(true);
        if (store.syncStatus === "Нужен вход")
          throw Error("Подключите аккаунт снова");
        const goal = String(msg.goal || "").trim();
        const minutes = Number(msg.minutes);
        if (
          !goal ||
          goal.length > 200 ||
          !Number.isFinite(minutes) ||
          minutes < 1 / 60 ||
          minutes > 240
        )
          throw Error("Укажите цель и длительность от 1 секунды до 240 минут");
        store.active = createActive(
          crypto.randomUUID(),
          store.instanceId,
          goal,
          Math.round(minutes * 60000),
          store.settings,
          Date.now(),
        );
        store.active.host = await observeHost();
        const tabs = await chrome.tabs.query({
          active: true,
          lastFocusedWindow: true,
        });
        store.active.taskTabId = tabs[0]?.id;
        await persist();
        break;
      }
      case "pause":
        if (store.active) {
          pause(store.active, Date.now());
          await persist();
        }
        break;
      case "resume":
        if (store.active) {
          resume(store.active, Date.now());
          store.active.host = await observeHost();
          await persist();
        }
        break;
      case "except":
        if (store.active?.host) {
          except(store.active, store.active.host, Date.now());
          await persist();
        }
        break;
      case "decision": {
        if (!store.active) throw Error("Нет активной сессии");
        const action = decisionSchema.shape.action.parse(msg.action);
        if (
          (action === "allow5" || action === "allow-session") &&
          !store.active.host
        )
          throw Error("Откройте нужный сайт в сфокусированном Chrome");
        decide(store.active, action, store.active.host, Date.now());
        await persist();
        if (action === "return" && store.active.taskTabId !== undefined) {
          try {
            await chrome.tabs.update(store.active.taskTabId, { active: true });
          } catch {
            throw Error(
              "Исходная вкладка закрыта. Откройте страницу своей задачи. Решение сохранено.",
            );
          }
        }
        if (action === "details")
          await chrome.tabs.create({ url: __WEB_URL__ + "/#sessions" });
        break;
      }
      case "finish":
        if (store.active) {
          settle(store.active, Date.now());
          store.active.session.note = String(msg.note || "")
            .trim()
            .slice(0, 500);
          await finish(false, !!msg.done);
          await sync(true);
        }
        break;
      case "sync":
        await sync(true);
        break;
      case "history":
        await importHistory();
        break;
      case "chooseDomains": {
        const selected = Array.isArray(msg.domains) ? msg.domains : [];
        store.settings = settingsSchema.parse({
          ...store.settings,
          domains: [...new Set([...store.settings.domains, ...selected])],
        });
        await request("/api/settings", "PUT", store.settings);
        await persist();
        break;
      }
      case "shareHistory":
        if (store.history && store.historyOwner === store.auth?.ownerId) {
          store.settings = settingsSchema.parse(await request("/api/settings"));
          if (!store.settings.shareHistory)
            throw Error("Разрешите сводку на сайте в настройках");
          await request("/api/history", "PUT", store.history);
          store.syncStatus = "Сводка истории синхронизирована";
          await persist();
        }
        break;
      case "clearLocal":
        if (store.active) throw Error("Сначала завершите сессию");
        store.history = null;
        store.historyOwner = null;
        store.queue = store.queue.filter(
          (q) => q.ownerId !== store.auth?.ownerId,
        );
        store.lastResult = null;
        await persist();
        break;
      default:
        throw Error("Неизвестная команда");
    }
    return {
      auth: store.auth
        ? { email: store.auth.email, ownerId: store.auth.ownerId }
        : null,
      settings: store.settings,
      active: store.active,
      history: store.history,
      queueCount: store.queue.filter((q) => canUpload(q, store.auth)).length,
      foreignQueueCount: store.queue.filter((q) => !canUpload(q, store.auth))
        .length,
      lastSync: store.lastSync,
      syncStatus: store.syncStatus,
      notificationBlocked: store.notificationBlocked,
      lastResult: store.lastResult,
      currentHost: await observeHost(),
      totals: store.active ? totals(store.active.session) : null,
    };
  }).then(
    (state) => respond({ ok: true, state }),
    (e) => respond({ ok: false, error: e.message }),
  );
  return true;
});
