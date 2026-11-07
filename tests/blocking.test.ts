import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import vm from "node:vm";
import { randomUUID, webcrypto } from "node:crypto";
import { defaults, sessionSchema } from "@nazar/shared";

test("real worker: DNR redirect, server plan, enforced 15s delay, one Chat Pass, expiry and restart", async () => {
  const compiled = await build({
    entryPoints: ["apps/extension/src/worker.ts"],
    bundle: true,
    write: false,
    format: "iife",
    define: {
      __API_URL__: JSON.stringify("https://nazar.test"),
      __WEB_URL__: JSON.stringify("https://nazar.test"),
    },
  });
  const code = new TextDecoder().decode(compiled.outputFiles[0].contents);
  const event = () => ({
    handlers: [] as Function[],
    addListener(f: Function) {
      this.handlers.push(f);
    },
  });
  let now = 100000,
    host = "https://instagram.com/",
    rules: any[] = [],
    saved: any,
    plans = 0;
  const instanceId = randomUUID();
  saved = {
    instanceId,
    auth: {
      token: "test",
      ownerId: "A",
      email: "test@example.test",
      instanceId,
    },
    settings: {
      ...defaults,
      budgetMs: 999999,
      siteLimits: [
        { domain: "instagram.com", limitMs: 1000 },
        { domain: "tiktok.com", limitMs: 0 },
      ],
      allowExtraTime: false,
    },
    active: null,
    queue: [],
    syncStatus: "ok",
    history: null,
    lastResult: null,
    notificationBlocked: false,
  };
  const chrome = {
    runtime: {
      id: "a".repeat(32),
      onMessage: event(),
      onMessageExternal: event(),
    },
    storage: {
      local: {
        setAccessLevel: async () => {},
        get: async () => ({ nazar: structuredClone(saved) }),
        set: async (v: any) => {
          saved = structuredClone(v.nazar);
        },
      },
    },
    tabs: {
      query: async () => [{ id: 1, url: host }],
      update: async (_id: number, change: any) => {
        if (change.url) host = change.url;
      },
      create: async () => {},
      onActivated: event(),
      onUpdated: event(),
      onRemoved: event(),
    },
    idle: {
      queryState: async () => "active",
      setDetectionInterval: () => {},
      onStateChanged: event(),
    },
    windows: {
      getAll: async () => [{ id: 1, type: "normal", focused: true }],
      onFocusChanged: event(),
    },
    alarms: { create: async () => {}, onAlarm: event() },
    notifications: { getPermissionLevel: async () => "denied" },
    declarativeNetRequest: {
      RuleActionType: { REDIRECT: "redirect", ALLOW: "allow" },
      ResourceType: { MAIN_FRAME: "main_frame" },
      getDynamicRules: async () => rules,
      updateDynamicRules: async (v: any) => {
        rules = v.addRules;
      },
    },
  };
  class Clock extends Date {
    static now() {
      return now;
    }
  }
  function load() {
    chrome.runtime.onMessage.handlers = [];
    chrome.runtime.onMessageExternal.handlers = [];
    vm.runInNewContext(code, {
      chrome,
      Date: Clock,
      crypto: webcrypto,
      structuredClone,
      URL,
      AbortSignal,
      console,
      setInterval: () => 0,
      setTimeout: () => 0,
      clearTimeout: () => {},
      fetch: async (input: string) => {
        if (input.endsWith("/api/plans")) plans++;
        return new Response(
          JSON.stringify(input.endsWith("/api/settings") ? saved.settings : {}),
          { status: 200 },
        );
      },
    });
  }
  const internal = (type: string, body: object = {}, sender: object = {}) =>
    new Promise<any>((r) =>
      chrome.runtime.onMessage.handlers[0](
        { type, ...body },
        { id: chrome.runtime.id, ...sender },
        r,
      ),
    );
  const external = (type: string, domain = "instagram.com") =>
    new Promise<any>((r) =>
      chrome.runtime.onMessageExternal.handlers[0](
        { type, domain },
        { url: "https://nazar.test/#blocked" },
        r,
      ),
    );
  load();
  const webSender = { tab: { id: 1 }, url: "https://nazar.test/" };
  assert.equal(
    (await internal("state", { webOwnerId: "B" }, webSender)).ok,
    false,
  );
  assert.equal(
    (await internal("state", { webOwnerId: "A" }, webSender)).ok,
    true,
  );
  assert.equal(
    (await internal("history", { webOwnerId: "A" }, webSender)).ok,
    false,
  );
  assert.equal(
    (
      await internal(
        "state",
        { webOwnerId: "A" },
        { ...webSender, url: "https://evil.test/" },
      )
    ).ok,
    false,
  );
  assert.equal(
    (await internal("start", { goal: "Физика", minutes: 30 })).ok,
    true,
  );
  assert.equal(plans, 1);
  assert.ok(
    rules.some((r) => r.condition.requestDomains?.includes("tiktok.com")),
  );
  now += 1000;
  await internal("state");
  assert.match(host, /#blocked\?domain=instagram.com/);
  assert.ok(
    rules.some((r) => r.condition.requestDomains?.includes("instagram.com")),
  );
  let response = await external("focus");
  assert.equal(response.state.readyAt, now + 15000);
  assert.equal((await external("chat")).ok, false);
  now += 15000;
  response = await external("focus");
  assert.equal(
    response.state.readyAt,
    101000 + 15000,
    "refresh cannot reset or shorten the delay",
  );
  assert.equal((await external("extra")).ok, false);
  response = await external("chat");
  assert.equal(response.ok, true);
  assert.equal(response.state.navigate, "https://instagram.com/direct/");
  assert.equal(saved.chatPass.expiresAt, now + 600000);
  assert.ok(
    rules.some(
      (r) =>
        r.action.type === "allow" &&
        r.condition.regexFilter.endsWith("/direct/"),
    ),
  );
  assert.equal(
    (await external("chat")).ok,
    false,
    "messages cannot renew the pass",
  );
  assert.equal(
    (await external("chat", "tiktok.com")).ok,
    false,
    "hard ban has no exception",
  );
  host = "https://instagram.com/direct/inbox/";
  await internal("state");
  assert.equal(host, "https://instagram.com/direct/inbox/");
  host = "https://instagram.com/reels/";
  await internal("state");
  assert.match(host, /#blocked/);
  // Keep worker alive until the fixed pass expiry.
  for (let n = 0; n < 20; n++) {
    now += 30000;
    await internal("state");
  }
  assert.equal(saved.chatPass, null);
  assert.equal(
    rules.some((r) => r.action.type === "allow"),
    false,
  );
  assert.ok(sessionSchema.safeParse(saved.active.session).success);
  load();
  await internal("state");
  assert.equal(saved.active, null);
  assert.ok(saved.restrictionSession);
  assert.ok(
    rules.some((r) => r.condition.requestDomains?.includes("instagram.com")),
    "restart preserves exhausted-site rules",
  );
  assert.ok(sessionSchema.safeParse(saved.lastResult).success);
  let called = false;
  const accepted = chrome.runtime.onMessageExternal.handlers[0](
    { type: "chat", domain: "instagram.com" },
    { url: "https://evil.test" },
    () => {
      called = true;
    },
  );
  assert.equal(accepted, false);
  assert.equal(called, false);
});
