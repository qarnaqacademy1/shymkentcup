import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { unlink } from "node:fs/promises";
import { createActive, settle, defaults } from "@nazar/shared";
test("real HTTP + SQLite: auth, CSRF, pairing, ownership, retry, history, revocation, deletion", async () => {
  const filename = "data/test-" + randomUUID() + ".db";
  process.env.DATABASE_URL = "file:./" + filename;
  execFileSync(process.execPath, ["scripts/migrate.mjs"], {
    env: process.env,
    stdio: "pipe",
  });
  const { createApp } = await import("../apps/api/src/app.ts");
  const { db } = await import("../apps/api/src/db.ts");
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const addr = server.address() as { port: number };
  const base = "http://127.0.0.1:" + addr.port;
  async function call(
    path: string,
    method = "GET",
    body?: unknown,
    credential = "",
    bearer = false,
    header = true,
  ) {
    const r = await fetch(base + "/api" + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:5173",
        ...(header ? { "X-Nazar": "1" } : {}),
        ...(credential
          ? bearer
            ? { Authorization: "Bearer " + credential }
            : { Cookie: credential }
          : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return {
      status: r.status,
      data: await r.json(),
      cookie: r.headers.get("set-cookie")?.split(";")[0] || "",
    };
  }
  try {
    assert.equal((await call("/health")).status, 200);
    const a = await call("/auth/register", "POST", {
      email: "a@example.test",
      password: "valid-password-123",
    });
    assert.equal(a.status, 201);
    const b = await call("/auth/register", "POST", {
      email: "b@example.test",
      password: "valid-password-123",
    });
    assert.equal(b.status, 201);
    assert.equal(
      (await call("/settings", "PUT", defaults, a.cookie, false, false)).status,
      403,
    );
    const crossSite = await fetch(base + "/api/settings", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Nazar": "1",
        Origin: "https://other.example",
        Cookie: a.cookie,
      },
      body: JSON.stringify(defaults),
    });
    assert.equal(crossSite.status, 403);
    assert.equal(
      (
        await call("/auth/login", "POST", {
          email: "a@example.test",
          password: "wrong-password",
        })
      ).status,
      401,
    );
    assert.deepEqual(
      (await call("/sessions", "GET", undefined, a.cookie)).data,
      [],
    );
    const pair = await call("/pair/code", "POST", {}, a.cookie);
    const instanceId = randomUUID();
    const exchange = await call("/pair/exchange", "POST", {
      code: pair.data.code,
      instanceId,
    });
    assert.equal(exchange.status, 200);
    const device = exchange.data.token;
    const expiredPair = await call("/pair/code", "POST", {}, a.cookie);
    await db.pairCode.updateMany({
      where: { userId: a.data.id },
      data: { expiresAt: new Date(0) },
    });
    assert.equal(
      (
        await call("/pair/exchange", "POST", {
          code: expiredPair.data.code,
          instanceId,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call("/pair/exchange", "POST", {
          code: pair.data.code,
          instanceId,
        })
      ).status,
      400,
    );
    const now = Date.now() - 10000;
    const active = createActive(
      randomUUID(),
      instanceId,
      "Интеграционная сессия",
      5000,
      { ...defaults, budgetMs: 1000, domains: ["example.com"] },
      now,
    );
    active.host = "example.com";
    settle(active, now + 5000);
    active.session.taskDone = true;
    const payload = active.session;
    const firstSaves = await Promise.all([
      call(
        "/sessions/" + payload.clientSessionId,
        "PUT",
        payload,
        device,
        true,
      ),
      call(
        "/sessions/" + payload.clientSessionId,
        "PUT",
        payload,
        device,
        true,
      ),
    ]);
    assert.deepEqual(firstSaves.map((r) => r.status).sort(), [200, 201]);
    const saved = firstSaves.find((r) => r.status === 201)!;
    const retry = await Promise.all([
      call(
        "/sessions/" + payload.clientSessionId,
        "PUT",
        payload,
        device,
        true,
      ),
      call(
        "/sessions/" + payload.clientSessionId,
        "PUT",
        payload,
        device,
        true,
      ),
    ]);
    assert.ok(
      retry.every((r) => r.status === 200 && r.data.id === saved.data.id),
    );
    assert.equal(
      (
        await call(
          "/sessions/" + payload.clientSessionId,
          "PUT",
          { ...payload, goal: "Different" },
          device,
          true,
        )
      ).status,
      409,
    );
    assert.equal(
      (await call("/sessions/" + saved.data.id, "GET", undefined, b.cookie))
        .status,
      404,
    );
    assert.deepEqual(
      (await call("/sessions", "GET", undefined, b.cookie)).data,
      [],
    );
    assert.equal(
      (
        await call(
          "/sessions/" + payload.clientSessionId,
          "PUT",
          payload,
          b.cookie,
        )
      ).status,
      403,
    );
    const stats = await call(
      `/stats?from=${now - 1}&to=${now + 6000}`,
      "GET",
      undefined,
      a.cookie,
    );
    assert.equal(stats.data.trackedMs, 5000);
    assert.equal(stats.data.distractedMs, 5000);
    assert.equal(stats.data.sessions, 1);
    const hist = {
      from: now - 10000,
      to: now,
      complete: true,
      domains: [{ domain: "example.com", visits: 3 }],
    };
    assert.equal(
      (await call("/history", "PUT", hist, device, true)).status,
      403,
    );
    await call(
      "/settings",
      "PUT",
      { ...defaults, shareHistory: true },
      a.cookie,
    );
    await call("/history", "PUT", hist, device, true);
    await call("/history", "PUT", hist, device, true);
    assert.equal(
      (await call("/history", "GET", undefined, a.cookie)).data.domains[0]
        .visits,
      3,
    );
    assert.equal(
      (await call("/history", "GET", undefined, b.cookie)).data,
      null,
    );
    await call("/settings", "PUT", defaults, a.cookie);
    assert.equal(
      (await call("/history", "GET", undefined, a.cookie)).data,
      null,
    );
    const devices = await call("/devices", "GET", undefined, a.cookie);
    await db.credential.updateMany({
      where: { userId: a.data.id, kind: "device" },
      data: { expiresAt: new Date(0) },
    });
    assert.equal(
      (await call("/settings", "GET", undefined, device, true)).status,
      401,
    );
    await db.credential.updateMany({
      where: { userId: a.data.id, kind: "device" },
      data: { expiresAt: new Date(Date.now() + 60000) },
    });
    await call("/devices/" + devices.data[0].id, "DELETE", {}, b.cookie);
    assert.equal(
      (await call("/settings", "GET", undefined, device, true)).status,
      200,
    );
    await call("/devices/" + devices.data[0].id, "DELETE", {}, a.cookie);
    assert.equal(
      (await call("/settings", "GET", undefined, device, true)).status,
      401,
    );
    await call(
      "/account",
      "DELETE",
      { password: "valid-password-123" },
      a.cookie,
    );
    assert.equal(
      (await call("/auth/me", "GET", undefined, a.cookie)).status,
      401,
    );
    assert.equal(await db.studySession.count(), 0);
    assert.equal(
      (await call("/auth/me", "GET", undefined, b.cookie)).status,
      200,
    );
  } finally {
    await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
    await db.$disconnect();
    await unlink(filename).catch(() => {});
  }
});
