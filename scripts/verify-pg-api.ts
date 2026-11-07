import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../apps/api/src/app.ts";
import { db } from "../apps/api/src/db.ts";
import { createActive, settle, defaults } from "@nazar/shared";
const server = createApp().listen(0, "127.0.0.1");
await new Promise<void>((r) => server.once("listening", r));
const root = "http://127.0.0.1:" + (server.address() as { port: number }).port;
try {
  const call = async (
    path: string,
    method = "GET",
    body?: unknown,
    cookie = "",
    bearer = "",
  ) => {
    const r = await fetch(root + "/api" + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Nazar": "1",
        Origin: "http://localhost:5173",
        ...(cookie ? { Cookie: cookie } : {}),
        ...(bearer ? { Authorization: "Bearer " + bearer } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: r.status,
      body: await r.json(),
      cookie: r.headers.get("set-cookie")?.split(";")[0] || "",
    };
  };
  const reg = await call("/auth/register", "POST", {
    email: "pg@example.test",
    password: "postgres-test-password",
  });
  assert.equal(reg.status, 201);
  const code = await call("/pair/code", "POST", {}, reg.cookie);
  const instanceId = randomUUID();
  const device = await call("/pair/exchange", "POST", {
    code: code.body.code,
    instanceId,
  });
  assert.equal(device.status, 200);
  const a = createActive(
    randomUUID(),
    instanceId,
    "PG session",
    5000,
    defaults,
    Date.now() - 6000,
  );
  a.host = "youtube.com";
  settle(a, a.deadline);
  assert.equal(
    (
      await call(
        "/sessions/" + a.session.clientSessionId,
        "PUT",
        a.session,
        "",
        device.body.token,
      )
    ).status,
    201,
  );
  assert.equal(
    (
      await call(
        "/sessions/" + a.session.clientSessionId,
        "PUT",
        a.session,
        "",
        device.body.token,
      )
    ).status,
    200,
  );
  const m = createActive(
    randomUUID(),
    randomUUID(),
    "Mobile",
    5000,
    defaults,
    Date.now() - 6000,
  );
  m.session.source = "mobile";
  settle(m, m.deadline);
  assert.equal(
    (
      await call(
        "/sessions/" + m.session.clientSessionId,
        "PUT",
        { ...m.session, ownerId: reg.body.id },
        reg.cookie,
      )
    ).status,
    201,
  );
  assert.equal(
    (await call("/sessions", "GET", undefined, reg.cookie)).body.length,
    2,
  );
  assert.ok((await db.rateLimit.count()) > 0);
} finally {
  await new Promise<void>((r) => server.close(() => r()));
  await db.$disconnect();
}
