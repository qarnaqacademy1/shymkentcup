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
  blockedDomains,
  chatPath,
  FOCUS_DELAY_MS,
  CHAT_PASS_MS,
  siteLimit,
  siteUsage,
  dayKey,
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
  focus?: Record<string, number>;
  chatPass?: { domain: string; expiresAt: number } | null;
  pendingPlan?: { id: string; goal: string; plannedMs: number; day: string };
  restrictionSession?: Session | null;
}
let store: Store;
let nextLimitTimer: ReturnType<typeof setTimeout> | undefined;
let appliedRules = "";
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
  await enforceRules();
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
function blocked() {
  return blockedDomains(
    store.settings,
    store.active?.session ?? store.restrictionSession ?? null,
    Date.now(),
  );
}
function blockUrl(domain: string) {
  return (
    __WEB_URL__ +
    "/#blocked?domain=" +
    encodeURIComponent(domain) +
    "&extension=" +
    chrome.runtime.id
  );
}
async function enforceRules() {
  if (!chrome.declarativeNetRequest) return;
  const now = Date.now();
  if (store.chatPass && store.chatPass.expiresAt <= now) store.chatPass = null;
  const domains = blocked();
  const protectedHosts = [
    new URL(__WEB_URL__).hostname,
    new URL(__API_URL__).hostname,
  ];
  const rules: chrome.declarativeNetRequest.Rule[] = domains.map(
    (domain, n) => ({
      id: n + 1,
      priority: 1,
      action: {
        type: chrome.declarativeNetRequest.RuleActionType.REDIRECT,
        redirect: { url: blockUrl(domain) },
      },
      condition: {
        requestDomains: [domain],
        excludedRequestDomains: protectedHosts,
        resourceTypes: [chrome.declarativeNetRequest.ResourceType.MAIN_FRAME],
      },
    }),
  );
  const pass = store.chatPass;
  if (pass && chatPath(pass.domain)) {
    rules.push({
      id: 10001,
      priority: 2,
      action: { type: chrome.declarativeNetRequest.RuleActionType.ALLOW },
      condition: {
        regexFilter:
          "^https://([a-z0-9-]+\\.)*" +
          pass.domain.replaceAll(".", "\\.") +
          chatPath(pass.domain),
        resourceTypes: [chrome.declarativeNetRequest.ResourceType.MAIN_FRAME],
      },
    });
    await chrome.alarms.create("chat-expiry", { when: pass.expiresAt });
  }
  const signature = JSON.stringify(rules);
  if (signature !== appliedRules) {
    const old = await chrome.declarativeNetRequest.getDynamicRules();
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: old.map((r) => r.id),
      addRules: rules,
    });
    appliedRules = signature;
  }
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id === undefined || !tab.url || !/^https?:/.test(tab.url)) continue;
    const host = domainOf(tab.url);
    if (
      host &&
      protectedHosts.some((p) => host === p || host.endsWith("." + p))
    )
      continue;
    const domain = domains.find(
      (d) => host && (host === d || host.endsWith("." + d)),
    );
    if (!domain) continue;
    const url = new URL(tab.url);
    if (
      pass?.domain === domain &&
      pass.expiresAt > now &&
      url.protocol === "https:" &&
      url.pathname.startsWith(chatPath(domain) ?? "\0")
    )
      continue;
    await chrome.tabs.update(tab.id, { url: blockUrl(domain) }).catch(() => {});
  }
}
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
  if (nextLimitTimer) clearTimeout(nextLimitTimer);
  const a = store.active;
  a.session.status = interrupted ? "interrupted" : "completed";
  a.session.taskDone = done;
  store.lastResult = structuredClone(a.session);
  store.restrictionSession = interrupted ? structuredClone(a.session) : null;
  if (store.auth)
    store.queue.push({
      ownerId: store.auth.ownerId,
      instanceId: store.instanceId,
      session: structuredClone(a.session),
      attempts: 0,
      nextAt: 0,
    });
  store.active = null;
  store.focus = {};
  store.chatPass = null;
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
  if (nextLimitTimer) clearTimeout(nextLimitTimer);
  if (a.host && a.pausedAt === null) {
    const rule = siteLimit(a.session.rules, a.host);
    const remaining = rule
      ? rule.limitMs - siteUsage(a.session, rule.domain)
      : Number.POSITIVE_INFINITY;
    const budget = a.session.rules.domains.some(
      (d) => a.host === d || a.host!.endsWith("." + d),
    )
      ? a.session.rules.budgetMs - totals(a.session).distractedMs
      : Number.POSITIVE_INFINITY;
    const delay = Math.min(remaining, budget, a.deadline - now);
    if (Number.isFinite(delay) && delay > 0) {
      nextLimitTimer = setTimeout(() => event(), delay);
      if (typeof nextLimitTimer === "object") nextLimitTimer.unref();
    }
  }
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
  store.focus ??= {};
  store.chatPass = null;
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
    if (sender.tab) {
      let trusted = false;
      try {
        trusted =
          new URL(sender.url ?? "").origin === new URL(__WEB_URL__).origin;
      } catch {}
      if (
        !trusted ||
        !["state", "start", "pause", "resume", "finish", "sync"].includes(
          msg.type,
        )
      )
        throw Error("Недопустимая команда сайта");
      if (msg.webOwnerId !== store.auth?.ownerId)
        throw Error(
          "Расширение подключено к другому аккаунту. Переподключите его в разделе «Расширение».",
        );
    }
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
        store.restrictionSession = null;
        store.pendingPlan = undefined;
        store.focus = {};
        store.chatPass = null;
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
        store.restrictionSession = null;
        store.pendingPlan = undefined;
        store.focus = {};
        store.chatPass = null;
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
        const plannedMs = Math.round(minutes * 60000);
        const pending = store.pendingPlan;
        const day = dayKey(Date.now(), "Asia/Qyzylorda");
        const id =
          pending?.goal === goal &&
          pending.plannedMs === plannedMs &&
          pending.day === day
            ? pending.id
            : crypto.randomUUID();
        store.pendingPlan = { id, goal, plannedMs, day };
        await persist();
        await request("/api/plans", "POST", {
          id,
          goal,
          plannedMs,
          source: "extension",
        });
        store.active = createActive(
          id,
          store.instanceId,
          goal,
          Math.round(minutes * 60000),
          store.settings,
          Date.now(),
        );
        store.restrictionSession = null;
        store.pendingPlan = undefined;
        store.focus = {};
        store.chatPass = null;
        store.active.host = await observeHost();
        const tabs = await chrome.tabs.query({
          active: true,
          lastFocusedWindow: true,
        });
        store.active.taskTabId = tabs[0]?.id;
        await checkpoint();
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
          if (
            blocked().some(
              (d) =>
                store.active!.host === d ||
                store.active!.host!.endsWith("." + d),
            )
          )
            throw Error("Используйте Focus Delay на странице ограничения");
          except(store.active, store.active.host, Date.now());
          await persist();
        }
        break;
      case "decision": {
        if (!store.active) throw Error("Нет активной сессии");
        const action = decisionSchema.shape.action.parse(msg.action);
        if (action === "chat-pass" || action === "focus-delay")
          throw Error("Откройте страницу ограничения Nazar");
        if (
          (action === "allow5" || action === "allow-session") &&
          (store.active.session.rules.allowExtraTime !== true ||
            blocked().length)
        )
          throw Error(
            "Дополнительное время доступно через Focus Delay, если разрешено в правилах",
          );
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
      case "openBlocked": {
        const domain = blocked()[0];
        if (!domain) throw Error("Активных ограничений нет");
        await chrome.tabs.create({ url: blockUrl(domain) });
        break;
      }
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

// The website can only control the narrow blocked-page flow; it never receives credentials.
chrome.runtime.onMessageExternal?.addListener((msg, sender, respond) => {
  let trusted = false;
  try {
    trusted = new URL(sender.url ?? "").origin === new URL(__WEB_URL__).origin;
  } catch {}
  if (!trusted) return false;
  void serial(async () => {
    await ready;
    await checkpoint();
    const domain = domainOf(String(msg.domain ?? ""));
    if (!domain || !blocked().includes(domain))
      throw Error("Ограничение больше не действует. Вернитесь к задаче.");
    const a = store.active;
    const rules = a?.session.rules ?? store.settings;
    const hard = siteLimit(rules, domain)?.limitMs === 0;
    const now = Date.now();
    store.focus ??= {};
    if (msg.type === "focus") {
      if (!store.focus[domain]) {
        store.focus[domain] = now + FOCUS_DELAY_MS;
        if (a) decide(a, "focus-delay", domain, now);
      }
    } else if (
      msg.type === "chat" ||
      msg.type === "extra" ||
      msg.type === "return"
    ) {
      if (!store.focus[domain] || now < store.focus[domain])
        throw Error("Дождитесь завершения 15-секундной паузы");
      if (!a || a.pausedAt !== null)
        throw Error("Начните или продолжите учебную сессию в расширении");
      if (msg.type === "chat") {
        if (hard || !chatPath(domain))
          throw Error("Для этого сайта Chat Pass недоступен");
        if (
          a.session.decisions?.some(
            (d) => d.action === "chat-pass" && d.domain === domain,
          )
        )
          throw Error("Chat Pass уже использован для этого сайта в сессии");
        const expiresAt = Math.min(a.deadline, now + CHAT_PASS_MS);
        store.chatPass = { domain, expiresAt };
        (a.session.decisions ??= []).push({
          domain,
          at: now,
          kind: "budget",
          action: "chat-pass",
          expiresAt,
        });
        await persist();
        return { navigate: "https://" + domain + chatPath(domain) };
      }
      if (msg.type === "extra") {
        if (hard || rules.allowExtraTime !== true)
          throw Error("Дополнительное время отключено в правилах");
        decide(a, "allow5", domain, now);
        await persist();
        return { navigate: "https://" + domain + "/" };
      }
      decide(a, "return", domain, now);
      if (a.taskTabId !== undefined)
        await chrome.tabs.update(a.taskTabId, { active: true }).catch(() => {});
    } else if (msg.type !== "blocked-state") throw Error("Неизвестная команда");
    await persist();
    return {
      domain,
      goal: a?.session.goal ?? "Вернитесь к запланированной задаче",
      readyAt: store.focus[domain] ?? null,
      canChat:
        !!a &&
        !hard &&
        !!chatPath(domain) &&
        !a.session.decisions?.some(
          (d) => d.action === "chat-pass" && d.domain === domain,
        ),
      canExtra: !!a && !hard && rules.allowExtraTime === true,
      hard,
    };
  }).then(
    (state) => respond({ ok: true, state }),
    (e) => respond({ ok: false, error: e.message }),
  );
  return true;
});
