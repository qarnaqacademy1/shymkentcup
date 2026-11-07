import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { unlink } from "node:fs/promises";
import {
  blockedDomains,
  chatPath,
  createActive,
  dailyReport,
  dayKey,
  defaults,
  domainBreakdown,
  sessionSchema,
  settle,
  settingsSchema,
} from "@nazar/shared";
import { nazarAssistant } from "../apps/api/src/assistant.ts";

test("site-specific limits, hard ban and domain boundaries use measured time", () => {
  const settings = {
    ...defaults,
    budgetMs: 600000,
    domains: [],
    siteLimits: [
      { domain: "instagram.com", limitMs: 2000 },
      { domain: "tiktok.com", limitMs: 0 },
    ],
  };
  const a = createActive(
    randomUUID(),
    randomUUID(),
    "Физика",
    60000,
    settings,
    100000,
  );
  assert.deepEqual(blockedDomains(settings, a.session, 100000), ["tiktok.com"]);
  a.host = "m.instagram.com";
  settle(a, 102000);
  assert.deepEqual(blockedDomains(settings, a.session, 102000), [
    "instagram.com",
    "tiktok.com",
  ]);
  assert.equal(a.session.warnings[0].kind, "site-limit");
  assert.ok(a.session.intervals[0].distracting);
  assert.ok(sessionSchema.safeParse(a.session).success);
  assert.equal(chatPath("instagram.com.evil.test"), null);
  assert.equal(chatPath("www.instagram.com"), "/direct/");
  assert.equal(chatPath("tiktok.com"), null);
  assert.equal(
    settingsSchema.safeParse({
      ...settings,
      siteLimits: [settings.siteLimits[0], settings.siteLimits[0]],
    }).success,
    false,
  );
});
test("donut and day report preserve actual milliseconds across midnight", () => {
  const start = Date.parse("2026-11-06T18:59:00Z");
  const a = createActive(
    randomUUID(),
    randomUUID(),
    "Прочитать",
    120000,
    { ...defaults, timezone: "Asia/Qyzylorda" },
    start,
  );
  a.host = "youtube.com";
  settle(a, start + 120000);
  const before = dailyReport(
    [a.session],
    "2026-11-06",
    a.session.rules.timezone,
  );
  const after = dailyReport(
    [a.session],
    "2026-11-07",
    a.session.rules.timezone,
  );
  assert.equal(before.trackedMs, 60000);
  assert.equal(after.trackedMs, 60000);
  assert.equal(before.plannedMs, 120000);
  assert.equal(after.plannedMs, 0);
  assert.equal(before.elapsedMs, 0);
  assert.equal(after.elapsedMs, 120000);
  const many = Array.from({ length: 12 }, (_, n) => ({
    domain: `site${n}.test`,
    start: 0,
    end: n + 1,
    distracting: false,
  }));
  const rows = domainBreakdown(many);
  assert.equal(rows.length, 8);
  assert.equal(rows.at(-1)!.domain, "Другие");
  assert.equal(
    rows.reduce((n, r) => n + r.ms, 0),
    78,
  );
});
test("AI fallback is honest with empty measurements and never changes rules", async () => {
  const result = await nazarAssistant("Экзамен по физике", [], false);
  assert.equal(result.mode, "rules");
  assert.match(result.label, /без AI/);
  assert.match(result.text, /пока нет/);
  assert.match(result.text, /физике/);
});
test("Nazar 4 HTTP: account daily cap, idempotent reservation, reports and fallback", async () => {
  const filename = "data/test-nazar4-" + randomUUID() + ".db";
  process.env.DATABASE_URL = "file:./" + filename;
  execFileSync(process.execPath, ["scripts/migrate.mjs"], {
    env: process.env,
    stdio: "pipe",
  });
  const { createApp } = await import("../apps/api/src/app.ts");
  const { db } = await import("../apps/api/src/db.ts");
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base =
    "http://127.0.0.1:" + (server.address() as { port: number }).port;
  let cookie = "";
  async function call(path: string, method = "GET", body?: unknown) {
    const r = await fetch(base + "/api" + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Nazar": "1",
        Origin: "http://localhost:5173",
        Cookie: cookie,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return {
      status: r.status,
      data: await r.json(),
      cookie: r.headers.get("set-cookie")?.split(";")[0] ?? "",
    };
  }
  try {
    assert.equal((await call("/plans")).status, 401);
    cookie = (
      await call("/auth/register", "POST", {
        email: "v4@example.test",
        password: "valid-password-123",
      })
    ).cookie;
    const plan = {
      id: randomUUID(),
      goal: "Экзамен",
      plannedMs: 120 * 60000,
      source: "mobile",
    };
    assert.equal((await call("/plans", "POST", plan)).status, 201);
    assert.equal((await call("/plans", "POST", plan)).status, 200);
    const first = await call("/plans");
    assert.equal(first.data.remainingMs, 120 * 60000);
    const concurrent = await Promise.all([
      call("/plans", "POST", { ...plan, id: randomUUID() }),
      call("/plans", "POST", { ...plan, id: randomUUID() }),
    ]);
    assert.deepEqual(concurrent.map((r) => r.status).sort(), [201, 409]);
    assert.equal((await call("/plans")).data.remainingMs, 0);
    assert.equal(
      (await call("/plans", "POST", { ...plan, goal: "Другие данные" })).status,
      409,
    );
    const report = await call(
      "/reports/daily?day=" + dayKey(Date.now(), "Asia/Qyzylorda"),
    );
    assert.equal(report.data.reservedMs, 240 * 60000);
    assert.equal(report.data.trackedMs, 0);
    assert.equal(report.data.elapsedMs, 0);
    const ai = await call("/assistant", "POST", {
      goal: "Физика",
      useAI: false,
    });
    assert.equal(ai.status, 200);
    assert.equal(ai.data.mode, "rules");
    const now = Date.now();
    assert.deepEqual(
      (await call(`/analytics?from=${now - 86400000}&to=${now + 1}`)).data,
      [],
    );
    const second = await call("/auth/register", "POST", {
      email: "other-v4@example.test",
      password: "valid-password-123",
    });
    cookie = second.cookie;
    assert.equal((await call("/plans", "POST", plan)).status, 409);
    assert.equal((await call("/plans")).data.plannedMs, 0);
    assert.equal(
      (await call("/reports/daily?day=" + dayKey(now, "Asia/Qyzylorda"))).data
        .reservedMs,
      0,
    );
    const identical = { ...plan, id: randomUUID(), plannedMs: 240 * 60000 };
    const retries = await Promise.all([
      call("/plans", "POST", identical),
      call("/plans", "POST", identical),
    ]);
    assert.deepEqual(retries.map((r) => r.status).sort(), [200, 201]);
    assert.equal((await call("/plans")).data.plannedMs, 240 * 60000);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await db.$disconnect();
    for (const suffix of ["", "-wal", "-shm"])
      await unlink(filename + suffix).catch(() => {});
  }
});
