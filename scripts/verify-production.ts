// Creates and deletes its own test account. Never uses existing users or local SQLite.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { unzipSync, strFromU8 } from "fflate";
import { createActive, defaults, settle, dayKey } from "@nazar/shared";

const origin = process.env.NAZAR_PUBLIC_ORIGIN;
assert.ok(
  origin && new URL(origin).protocol === "https:",
  "HTTPS NAZAR_PUBLIC_ORIGIN required",
);
const base = new URL(origin).origin;
const call = (
  path: string,
  method = "GET",
  body?: unknown,
  extra: Record<string, string> = {},
) =>
  fetch(base + path, {
    method,
    headers: {
      Origin: base,
      "Content-Type": "application/json",
      "X-Nazar": "1",
      ...extra,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000),
    redirect: "error",
  });
for (const path of [
  "/",
  "/api/health",
  "/api/config",
  "/manifest.webmanifest",
  "/sw.js",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-512.png",
  "/offline.html",
]) {
  const r = await call(path);
  assert.equal(r.status, 200, `${path}: HTTP ${r.status}`);
  if (path === "/api/health") assert.equal((await r.json()).ok, true);
  console.log(`PASS public ${path}`);
}
const zip = await call("/downloads/nazar-extension-production.zip");
assert.equal(zip.status, 200);
const files = unzipSync(new Uint8Array(await zip.arrayBuffer()));
const manifest = JSON.parse(strFromU8(files["manifest.json"]));
assert.deepEqual(manifest.host_permissions, ["http://*/*", "https://*/*"]);
assert.ok(manifest.permissions.includes("declarativeNetRequest"));
assert.ok(
  manifest.permissions.includes("history") &&
    manifest.permissions.includes("tabs"),
);
assert.deepEqual(manifest.externally_connectable.matches, [base + "/*"]);
assert.equal(manifest.version, "0.4.0");
assert.equal(manifest.manifest_version, 3);
assert.ok(strFromU8(files["worker.js"]).includes(base));
assert.match(strFromU8(files["worker.js"]), /credentials:\s*["']omit["']/);
console.log(
  "PASS production ZIP: DNR permissions and exact trusted website origin",
);
const password = randomUUID() + randomUUID();
const reg = await call("/api/auth/register", "POST", {
  email: `deploy-${randomUUID()}@example.test`,
  password,
});
assert.equal(reg.status, 201, `register: ${reg.status}`);
const cookieHeader = reg.headers.get("set-cookie")!;
assert.match(cookieHeader, /__Host-nazar=/);
assert.match(cookieHeader, /Secure/);
assert.match(cookieHeader, /HttpOnly/);
assert.match(cookieHeader, /SameSite=Strict/);
const Cookie = cookieHeader.split(";")[0];
const owner = await reg.json();
try {
  assert.equal(
    (await call("/api/auth/me", "GET", undefined, { Cookie })).status,
    200,
  );
  assert.equal((await call("/api/settings")).status, 401);
  const bad = await call(
    "/api/pair/code",
    "POST",
    {},
    { Cookie, Origin: "https://evil.invalid" },
  );
  assert.equal(bad.status, 403);
  assert.equal(bad.headers.get("access-control-allow-origin"), null);
  assert.equal(
    (await call("/api/pair/code", "POST", {}, { Cookie, "X-Nazar": "" }))
      .status,
    403,
  );
  const code = await (
    await call("/api/pair/code", "POST", {}, { Cookie })
  ).json();
  const instanceId = randomUUID();
  const payload = { code: code.code, instanceId };
  const deviceHeaders = { Origin: "chrome-extension://" + "a".repeat(32) };
  const exchange = await call(
    "/api/pair/exchange",
    "POST",
    payload,
    deviceHeaders,
  );
  assert.equal(exchange.status, 200);
  assert.equal(exchange.headers.get("set-cookie"), null);
  const device = await exchange.json();
  assert.equal(
    (await call("/api/pair/exchange", "POST", payload, deviceHeaders)).status,
    400,
  );
  assert.equal(
    (
      await call("/api/settings", "GET", undefined, {
        ...deviceHeaders,
        Authorization: "Bearer " + device.token,
      })
    ).status,
    200,
  );
  const now = Date.now() - 5000;
  const planId = randomUUID();
  const plan = {
    id: planId,
    goal: "Deployment verification (controlled timestamps)",
    plannedMs: 1000,
    source: "mobile",
  };
  assert.equal(
    (await call("/api/plans", "POST", plan, { Cookie })).status,
    201,
  );
  assert.equal(
    (await call("/api/plans", "POST", plan, { Cookie })).status,
    200,
  );
  const budget = await (
    await call("/api/plans", "GET", undefined, { Cookie })
  ).json();
  assert.equal(budget.plannedMs, 1000);
  assert.equal(
    (
      await call(
        "/api/plans",
        "POST",
        { ...plan, id: randomUUID(), plannedMs: 14400000 },
        { Cookie },
      )
    ).status,
    409,
  );
  const active = createActive(
    planId,
    instanceId,
    "Deployment verification (controlled timestamps)",
    1000,
    defaults,
    now,
  );
  active.session.source = "mobile";
  settle(active, now + 1000);
  const path = "/api/sessions/" + active.session.clientSessionId;
  const body = { ...active.session, ownerId: owner.id };
  assert.equal((await call(path, "PUT", body, { Cookie })).status, 201);
  assert.equal((await call(path, "PUT", body, { Cookie })).status, 200);
  const exported = await (
    await call("/api/export", "GET", undefined, { Cookie })
  ).json();
  assert.equal(exported.sessions.length, 1);
  assert.equal(exported.sessions[0].source, "mobile");
  assert.equal(exported.plans.length, 1);
  assert.ok(!JSON.stringify(exported).includes("passwordHash"));
  const report = await (
    await call(
      "/api/reports/daily?day=" + dayKey(now, defaults.timezone),
      "GET",
      undefined,
      { Cookie },
    )
  ).json();
  assert.equal(report.reservedMs, 1000);
  assert.equal(report.completed, 1);
  assert.equal(report.trackedMs, 0);
  const analytics = await (
    await call(
      `/api/analytics?from=${now - 1000}&to=${Date.now() + 1}`,
      "GET",
      undefined,
      { Cookie },
    )
  ).json();
  assert.equal(analytics.length, 1);
  const assistant = await (
    await call(
      "/api/assistant",
      "POST",
      { goal: "Проверка публикации", useAI: false },
      { Cookie },
    )
  ).json();
  assert.equal(assistant.mode, "rules");
  console.log(
    "PASS Nazar 4 daily plans/cap/retry, report, analytics and labelled AI fallback",
  );
  console.log(
    "PASS persistent auth, Secure cookie, CSRF/Origin, MV3 pairing/replay, Bearer, session retry/export",
  );
} finally {
  assert.equal(
    (await call("/api/account", "DELETE", { password }, { Cookie })).status,
    200,
    "test account cleanup",
  );
  console.log("PASS removed own test account and test data");
}
