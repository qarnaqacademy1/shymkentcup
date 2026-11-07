import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { unlink } from "node:fs/promises";
import { defaults } from "@nazar/shared";

test("MV3 pairing with extension Origin and website cookie; website CSRF/CORS remain protected", async () => {
  const filename = "data/pairing-" + randomUUID() + ".db";
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
  const extension = "chrome-extension://" + "a".repeat(32);
  const website = "http://localhost:5173";
  async function call(
    path: string,
    method: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    return fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Nazar": "1",
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  try {
    const registration = await call(
      "/auth/register",
      "POST",
      { email: "pairing@example.test", password: "pairing-test-password" },
      { Origin: website },
    );
    assert.equal(registration.status, 201);
    const user = await registration.json();
    const cookie = registration.headers.get("set-cookie")!.split(";")[0];
    const newCode = async () => {
      const res = await call(
        "/pair/code",
        "POST",
        {},
        { Origin: website, Cookie: cookie },
      );
      assert.equal(res.status, 200);
      return (await res.json()).code as string;
    };
    const code = await newCode(),
      instanceId = randomUUID();
    // Reject foreign websites even when no session cookie accompanies a valid code.
    const foreignHeaders: Record<string, string>[] = [
      { Origin: "https://evil.example" },
      { Origin: "https://evil.example", Cookie: cookie },
      { Origin: "chrome-extension://not-an-extension-id", Cookie: cookie },
      { Origin: extension + ".evil.example", Cookie: cookie },
    ];
    for (const headers of foreignHeaders) {
      const res = await call(
        "/pair/exchange",
        "POST",
        { code, instanceId },
        headers,
      );
      assert.equal(res.status, 403);
      assert.equal(res.headers.get("access-control-allow-origin"), null);
    }
    // Regression: an incidental website cookie must not turn code exchange into cookie auth.
    const connected = await call(
      "/pair/exchange",
      "POST",
      { code, instanceId },
      { Origin: extension, Cookie: cookie },
    );
    assert.equal(connected.status, 200);
    assert.equal(connected.headers.get("set-cookie"), null);
    assert.equal(connected.headers.get("access-control-allow-origin"), null);
    assert.equal(
      connected.headers.get("access-control-allow-credentials"),
      null,
    );
    const device = await connected.json();
    assert.equal(device.ownerId, user.id);
    assert.equal(device.instanceId, instanceId);
    assert.ok(device.token);
    assert.equal(
      (
        await call(
          "/pair/exchange",
          "POST",
          { code, instanceId },
          { Origin: extension },
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await call(
          "/pair/exchange",
          "POST",
          { code: "0".repeat(24), instanceId },
          { Origin: extension },
        )
      ).status,
      400,
    );
    // This is the new worker's credentials:omit transport: no Cookie, valid Chrome Origin.
    const credentialless = await call(
      "/pair/exchange",
      "POST",
      { code: await newCode(), instanceId },
      { Origin: extension },
    );
    assert.equal(credentialless.status, 200);
    assert.equal((await credentialless.json()).ownerId, user.id);
    // Device access still needs a verified bearer; extension Origin alone grants no cookie access.
    assert.equal(
      (
        await call("/settings", "PUT", defaults, {
          Origin: extension,
          Cookie: cookie,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await call("/settings", "PUT", defaults, {
          Origin: extension,
          Authorization: "Bearer invalid",
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await call("/settings", "PUT", defaults, {
          Origin: extension,
          Authorization: "Bearer " + device.token,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await call(
          "/pair/code",
          "POST",
          {},
          { Origin: extension, Cookie: cookie },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await call("/settings", "PUT", defaults, {
          Cookie: cookie,
          Authorization: "invalid",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await call("/settings", "PUT", defaults, {
          Origin: "https://evil.example",
          Authorization: "Bearer " + device.token,
        })
      ).status,
      403,
    );
    const noHeader = await fetch(base + "/pair/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: extension },
      body: JSON.stringify({ code, instanceId }),
    });
    assert.equal(noHeader.status, 403);
    const webPreflight = await call("/settings", "OPTIONS", undefined, {
      Origin: website,
      "Access-Control-Request-Method": "PUT",
      "Access-Control-Request-Headers": "content-type,x-nazar",
    });
    assert.equal(webPreflight.status, 204);
    assert.equal(
      webPreflight.headers.get("access-control-allow-origin"),
      website,
    );
    assert.equal(
      webPreflight.headers.get("access-control-allow-credentials"),
      "true",
    );
    for (const origin of ["https://evil.example", extension]) {
      const preflight = await call("/pair/exchange", "OPTIONS", undefined, {
        Origin: origin,
        "Access-Control-Request-Method": "POST",
      });
      assert.equal(preflight.headers.get("access-control-allow-origin"), null);
      assert.equal(
        preflight.headers.get("access-control-allow-credentials"),
        null,
      );
    }
    const me = await call("/auth/me", "GET", undefined, {
      Cookie: cookie,
      Origin: website,
    });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).id, user.id);
    assert.equal(
      (
        await call("/settings", "PUT", defaults, {
          Cookie: cookie,
          Origin: website,
        })
      ).status,
      200,
    );
  } finally {
    await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
    await db.$disconnect();
    await unlink(filename).catch(() => {});
  }
});
