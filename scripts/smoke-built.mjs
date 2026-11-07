import { spawn, execFileSync } from "node:child_process";
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import assert from "node:assert/strict";
import { unzipSync, strFromU8 } from "fflate";
const filename = "data/smoke-" + randomUUID() + ".db";
const env = {
  ...process.env,
  DATABASE_URL: "file:./" + filename,
  PORT: "3002",
  WEB_ORIGIN: "http://localhost:3002",
  NODE_ENV: "development",
};
execFileSync(process.execPath, ["scripts/migrate.mjs"], { env, stdio: "pipe" });
const child = spawn(process.execPath, ["apps/api/dist/server.js"], {
  env,
  stdio: "pipe",
});
let logs = "";
child.stderr.on("data", (b) => (logs += b));
child.stdout.on("data", (b) => (logs += b));
try {
  let ready = false;
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch("http://localhost:3002/api/health");
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(ready, logs);
  const html = await fetch("http://localhost:3002/");
  assert.equal(html.status, 200);
  assert.match(await html.text(), /Nazar/);
  const zip = await fetch(
    "http://localhost:3002/downloads/nazar-extension.zip",
  );
  assert.equal(zip.status, 200);
  const files = unzipSync(new Uint8Array(await zip.arrayBuffer()));
  const manifest = JSON.parse(strFromU8(files["manifest.json"]));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.optional_permissions, ["history"]);
  assert.ok(!manifest.permissions.includes("history"));
  assert.ok(!manifest.host_permissions.includes("<all_urls>"));
  assert.deepEqual(manifest.host_permissions, [
    new URL(
      process.env.NAZAR_PUBLIC_ORIGIN ||
        process.env.NAZAR_API_URL ||
        "http://localhost:3001",
    ).origin + "/*",
  ]);
  assert.ok(files["worker.js"] && files["popup.js"] && files["icon.png"]);
  assert.match(strFromU8(files["worker.js"]), /credentials:\s*["']omit["']/);
  const reg = await fetch("http://localhost:3002/api/auth/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Nazar": "1",
      Origin: "http://localhost:3002",
    },
    body: JSON.stringify({
      email: "built@example.test",
      password: "test-built-password",
    }),
  });
  assert.equal(reg.status, 201);
  const cookie = reg.headers.get("set-cookie").split(";")[0];
  const settings = await fetch("http://localhost:3002/api/settings", {
    headers: { Cookie: cookie },
  });
  assert.equal(settings.status, 200);
  const pairingCode = await fetch("http://localhost:3002/api/pair/code", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Nazar": "1",
      Origin: "http://localhost:3002",
      Cookie: cookie,
    },
    body: "{}",
  });
  assert.equal(pairingCode.status, 200);
  const extensionOrigin = "chrome-extension://" + "b".repeat(32);
  const connection = await fetch("http://localhost:3002/api/pair/exchange", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Nazar": "1",
      Origin: extensionOrigin,
      Cookie: cookie,
    },
    body: JSON.stringify({
      code: (await pairingCode.json()).code,
      instanceId: randomUUID(),
    }),
  });
  assert.equal(connection.status, 200);
  assert.equal(connection.headers.get("set-cookie"), null);
  const device = await connection.json();
  const deviceSettings = await fetch("http://localhost:3002/api/settings", {
    headers: {
      Origin: extensionOrigin,
      Authorization: "Bearer " + device.token,
    },
  });
  assert.equal(deviceSettings.status, 200);
  console.log(
    "Built API + static web + ZIP + registration + settings + MV3 pairing: PASS",
  );
} finally {
  child.kill();
  await new Promise((r) => child.once("exit", r));
  await unlink(filename).catch(() => {});
}
