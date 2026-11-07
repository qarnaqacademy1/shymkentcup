import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { unlink } from "node:fs/promises";
import { createActive, defaults, settle } from "@nazar/shared";
test("mobile queue binds to cookie owner, remains idempotent and separate from Chrome KPI/export", async () => {
  const filename = "data/mobile-" + randomUUID() + ".db";
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
    "http://127.0.0.1:" + (server.address() as { port: number }).port + "/api";
  async function call(
    path: string,
    method = "GET",
    body?: unknown,
    cookie = "",
  ) {
    const r = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Nazar": "1",
        Origin: "http://localhost:5173",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return {
      status: r.status,
      text: await r.text(),
      cookie: r.headers.get("set-cookie")?.split(";")[0] || "",
    };
  }
  try {
    const a = await call("/auth/register", "POST", {
      email: "mobilea@example.test",
      password: "mobile-test-password",
    });
    const b = await call("/auth/register", "POST", {
      email: "mobileb@example.test",
      password: "mobile-test-password",
    });
    const ownerId = JSON.parse(a.text).id;
    const now = Date.now() - 10000;
    const s = createActive(
      randomUUID(),
      randomUUID(),
      "=CSV formula test",
      5000,
      defaults,
      now,
    );
    s.session.source = "mobile";
    s.session.note = "Самоотметка";
    s.session.taskDone = true;
    settle(s, now + 5000);
    const body = { ...s.session, ownerId };
    assert.equal(
      (
        await call(
          "/sessions/" + s.session.clientSessionId,
          "PUT",
          body,
          b.cookie,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await call(
          "/sessions/" + s.session.clientSessionId,
          "PUT",
          body,
          a.cookie,
        )
      ).status,
      201,
    );
    assert.equal(
      (
        await call(
          "/sessions/" + s.session.clientSessionId,
          "PUT",
          body,
          a.cookie,
        )
      ).status,
      200,
    );
    const stats = JSON.parse(
      (
        await call(
          `/stats?from=${now - 1}&to=${now + 6000}`,
          "GET",
          undefined,
          a.cookie,
        )
      ).text,
    );
    assert.equal(stats.mobileSessions, 1);
    assert.equal(stats.extensionSessions, 0);
    assert.equal(stats.trackedMs, 0);
    assert.equal(stats.withinBudget, 0);
    const json = JSON.parse(
      (await call("/export", "GET", undefined, a.cookie)).text,
    );
    assert.equal(json.sessions.length, 1);
    assert.equal(json.sessions[0].source, "mobile");
    assert.ok(!JSON.stringify(json).includes("passwordHash"));
    const csv = await call("/export?format=csv", "GET", undefined, a.cookie);
    assert.match(csv.text, /'=CSV formula test/);
    assert.equal(
      JSON.parse((await call("/export", "GET", undefined, b.cookie)).text)
        .sessions.length,
      0,
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await db.$disconnect();
    await unlink(filename).catch(() => {});
  }
});
