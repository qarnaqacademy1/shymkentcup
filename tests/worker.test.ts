import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createActive, defaults, totals } from "@nazar/shared";
import { randomUUID } from "node:crypto";
// Executes the real worker bundle against a deterministic Chrome event adapter.
// This is an automated lifecycle test, NOT a claim of manual Chrome verification.
test("worker: popup-independent events, offline queue, account switching, recovery, history denial", async () => {
  const compiled = await build({
    entryPoints: ["apps/extension/src/worker.ts"],
    bundle: true,
    write: false,
    format: "esm",
    define: { __API_URL__: JSON.stringify("http://api.test") },
  });
  const event = () => {
    const handlers: Function[] = [];
    return { addListener: (f: Function) => handlers.push(f), handlers };
  };
  let stored: any,
    host = "https://example.com/",
    focused = true,
    online = true,
    owner = "A",
    now = 100000;
  const uploads: string[] = [];
  let notify = 0;
  const instance = randomUUID();
  const auth = {
    ownerId: "A",
    email: "a@test.local",
    token: "token-A",
    instanceId: instance,
    expiresAt: "2099-01-01",
  };
  stored = {
    instanceId: instance,
    auth,
    settings: { ...defaults, domains: ["example.com"], budgetMs: 1000 },
    active: null,
    queue: [],
    lastSync: null,
    syncStatus: "ok",
    history: null,
    historyOwner: null,
    lastResult: null,
    notificationBlocked: false,
  };
  const chromeMock = {
    storage: {
      local: {
        setAccessLevel: async () => {},
        get: async () => ({ nazar: structuredClone(stored) }),
        set: async (v: any) => {
          stored = structuredClone(v.nazar);
        },
      },
    },
    idle: {
      queryState: async () => "active",
      setDetectionInterval: () => {},
      onStateChanged: event(),
    },
    windows: {
      getAll: async () => [{ id: 1, type: "normal", focused }],
      onFocusChanged: event(),
      WINDOW_ID_NONE: -1,
    },
    tabs: {
      query: async () => [{ url: host }],
      onActivated: event(),
      onUpdated: event(),
      onRemoved: event(),
    },
    alarms: { create: async () => {}, onAlarm: event() },
    notifications: {
      getPermissionLevel: async () => "denied",
      create: async () => {
        notify++;
      },
    },
    permissions: { contains: async () => false },
    runtime: { id: "test-extension", onMessage: event() },
  };
  const old = {
    chrome: (globalThis as any).chrome,
    fetch: globalThis.fetch,
    now: Date.now,
    setInterval: globalThis.setInterval,
  };
  (globalThis as any).chrome = chromeMock;
  Date.now = () => now;
  (globalThis as any).setInterval = () => 0;
  globalThis.fetch = async (input: any, options: any) => {
    assert.equal(
      options.credentials,
      "omit",
      "worker must never send website cookies",
    );
    assert.equal(options.headers.Cookie, undefined);
    if (String(input).endsWith("/api/pair/exchange")) {
      assert.equal(options.method, "POST");
      assert.equal(
        options.headers.Authorization,
        undefined,
        "pairing must not use the old device bearer",
      );
      assert.equal(options.headers["X-Nazar"], "1");
    }
    if (!online) throw Error("offline");
    const path = String(input).replace("http://api.test", "");
    let data: any = {};
    if (path === "/api/settings") data = stored.settings;
    if (path === "/api/pair/exchange")
      data = {
        ...auth,
        ownerId: owner,
        email: owner + "@test.local",
        token: "token-" + owner,
      };
    if (path.startsWith("/api/sessions/"))
      uploads.push(options.headers.Authorization);
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const code = new TextDecoder().decode(compiled.outputFiles[0].contents);
  async function load(suffix: string) {
    chromeMock.runtime.onMessage.handlers.length = 0;
    await import(
      "data:text/javascript;base64," +
        Buffer.from(code + "\n// " + suffix).toString("base64")
    );
  }
  async function message(type: string, data: object = {}) {
    return await new Promise<any>((resolve) =>
      chromeMock.runtime.onMessage.handlers[0](
        { type, ...data },
        { id: "test-extension" },
        resolve,
      ),
    );
  }
  try {
    await load("first");
    assert.equal(
      (await message("start", { goal: "Real worker test", minutes: 1 })).ok,
      true,
    );
    now += 2000;
    focused = false;
    chromeMock.windows.onFocusChanged.handlers[0](-1);
    const state = (await message("state")).state;
    assert.equal(state.totals.trackedMs, 2000);
    assert.equal(state.active.host, null);
    assert.equal(state.active.session.warnings.length, 1);
    assert.ok(state.notificationBlocked);
    assert.equal(notify, 0);
    now += 2000;
    focused = true;
    host = "https://docs.example.org/";
    chromeMock.tabs.onUpdated.handlers[0](1, { url: host });
    await message("state");
    now += 1000;
    online = false;
    await message("finish", { done: true });
    assert.equal(stored.queue.length, 1);
    assert.equal(stored.queue[0].session.intervals.length, 2);
    assert.equal(totals(stored.queue[0].session).trackedMs, 3000);
    online = true;
    owner = "B";
    await message("disconnect");
    await message("connect", { code: "test" });
    assert.equal(stored.queue.length, 1);
    assert.equal(uploads.length, 0);
    owner = "A";
    await message("disconnect");
    await message("connect", { code: "test" });
    assert.equal(stored.queue.length, 0);
    assert.deepEqual(uploads, ["Bearer token-A"]);
    assert.equal((await message("history")).ok, false);
    assert.equal(
      (
        await message("start", {
          goal: "Still works after history denied",
          minutes: 1,
        })
      ).ok,
      true,
    );
    now += 5000;
    await message("state");
    const confirmed = stored.active.session.elapsedMs;
    now += 200000;
    await load("restart");
    await message("state");
    assert.equal(stored.active, null);
    assert.equal(stored.lastResult.status, "interrupted");
    assert.equal(stored.lastResult.elapsedMs, confirmed);
    await message("start", { goal: "Sleep test", minutes: 1 });
    now += 50000;
    await message("state");
    assert.equal(stored.lastResult.status, "interrupted");
    assert.equal(stored.lastResult.elapsedMs, 0);
  } finally {
    (globalThis as any).chrome = old.chrome;
    globalThis.fetch = old.fetch;
    Date.now = old.now;
    globalThis.setInterval = old.setInterval;
  }
});
