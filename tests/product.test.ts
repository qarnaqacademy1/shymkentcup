import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import {
  createActive,
  defaults,
  settle,
  decide,
  pause,
  resume,
  totals,
  sessionSchema,
  coach,
} from "@nazar/shared";
const active = () =>
  createActive(
    randomUUID(),
    randomUUID(),
    "Учебная цель",
    900000,
    { ...defaults, domains: ["youtube.com"], budgetMs: 1000 },
    100000,
  );
test("Decision 5 minutes splits a delayed checkpoint exactly at expiry and preserves past", () => {
  const a = active();
  a.host = "youtube.com";
  decide(a, "allow5", a.host, 102000);
  settle(a, 412000);
  assert.deepEqual(
    a.session.intervals.map((i) => [i.start, i.end, i.distracting]),
    [
      [100000, 102000, true],
      [102000, 402000, false],
      [402000, 412000, true],
    ],
  );
  assert.equal(totals(a.session).distractedMs, 12000);
  assert.ok(sessionSchema.safeParse(a.session).success);
  assert.equal(a.session.decisions![0].expiresAt, 402000);
});
test("repeated overlapping decisions remain non-overlapping and validate", () => {
  const a = active();
  a.host = "youtube.com";
  decide(a, "allow5", a.host, 102000);
  decide(a, "allow-session", a.host, 105000);
  settle(a, 450000);
  assert.ok(sessionSchema.safeParse(a.session).success);
  assert.equal(totals(a.session).distractedMs, 2000);
  assert.equal(a.session.warnings.length, 1);
  assert.equal(a.session.decisions!.length, 2);
});
test("session exception moves with pause; five-minute allowance uses wall time; deadline clips all", () => {
  const a = active();
  a.host = "youtube.com";
  decide(a, "allow-session", a.host, 102000);
  pause(a, 103000);
  resume(a, 113000);
  assert.equal(a.session.exceptions[0].expiresAt, a.deadline);
  a.host = "youtube.com";
  settle(a, a.deadline + 99999);
  assert.equal(a.session.endedAt, a.deadline);
  assert.equal(totals(a.session).distractedMs, 2000);
  assert.ok(sessionSchema.safeParse(a.session).success);
});
test("mobile contracts cannot masquerade as measured websites, coach is explicitly rules based", () => {
  const a = active();
  a.session.source = "mobile";
  a.host = null;
  settle(a, 105000);
  assert.ok(sessionSchema.safeParse(a.session).success);
  a.session.intervals.push({
    start: 100000,
    end: 105000,
    domain: "youtube.com",
    distracting: true,
  });
  assert.equal(sessionSchema.safeParse(a.session).success, false);
  assert.equal(coach(a.session).mode, "Анализ по правилам");
});
test("legacy canonical payload has no invented source/note/decisions or changed hash serialization", () => {
  const a = active();
  a.host = "youtube.com";
  settle(a, 105000);
  const s = a.session;
  const oldCanonical = {
    clientSessionId: s.clientSessionId,
    instanceId: s.instanceId,
    goal: s.goal,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    plannedMs: s.plannedMs,
    elapsedMs: s.elapsedMs,
    status: s.status,
    taskDone: s.taskDone,
    rules: s.rules,
    intervals: s.intervals,
    exceptions: [],
    warnings: s.warnings.map((w) => ({ at: w.at, kind: w.kind })),
  };
  const serialized = JSON.stringify(oldCanonical);
  assert.equal(
    JSON.stringify(sessionSchema.parse(JSON.parse(serialized))),
    serialized,
  );
});
test("PWA manifest, icons and SW policy exclude private API/HTML from offline cache", async () => {
  const manifest = JSON.parse(
    await readFile("apps/web/public/manifest.webmanifest", "utf8"),
  );
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.name, "Nazar");
  for (const icon of manifest.icons) {
    const png = await readFile("apps/web/public" + icon.src);
    const size = png.readUInt32BE(16);
    assert.equal(icon.sizes, `${size}x${size}`);
  }
  const handlers: Record<string, Function> = {};
  let precached: string[] = [];
  vm.runInNewContext(await readFile("apps/web/public/sw.js", "utf8"), {
    URL,
    fetch: () => {},
    caches: {
      open: async () => ({
        addAll: async (urls: string[]) => {
          precached = urls;
        },
      }),
    },
    self: {
      location: { origin: "https://nazar.test" },
      addEventListener: (n: string, f: Function) => (handlers[n] = f),
      skipWaiting: () => {},
    },
  });
  await new Promise<void>((r) =>
    handlers.install({ waitUntil: (p: Promise<void>) => p.then(r) }),
  );
  assert.ok(precached.includes("/offline.html"));
  assert.ok(!precached.includes("/") && !precached.includes("/index.html"));
  for (const pathname of [
    "/api/sessions",
    "/api/export",
    "/downloads/nazar-extension.zip",
  ]) {
    let intercepted = false;
    handlers.fetch({
      request: {
        url: "https://nazar.test" + pathname,
        method: "GET",
        mode: "navigate",
      },
      respondWith: () => (intercepted = true),
    });
    assert.equal(intercepted, false);
  }
});
