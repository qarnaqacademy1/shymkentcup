import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

test("website bridge discovers and controls session without exposing history or credentials", async () => {
  const scripts = await Promise.all([
    build({
      entryPoints: ["apps/extension/src/bridge.ts"],
      bundle: true,
      write: false,
      format: "iife",
    }),
    build({
      entryPoints: ["apps/web/src/extensionBridge.ts"],
      bundle: true,
      write: false,
      format: "iife",
      globalName: "client",
    }),
  ]);
  const handlers = new Set<Function>(),
    sent: any[] = [],
    commands: any[] = [];
  const window = {
    addEventListener: (_type: string, f: Function) => handlers.add(f),
    removeEventListener: (_type: string, f: Function) => handlers.delete(f),
    postMessage: (data: any) => {
      sent.push(data);
      for (const f of [...handlers])
        void f({ source: window, origin: "https://nazar.test", data });
    },
  };
  const chrome = {
    runtime: {
      sendMessage: async (msg: any) => {
        commands.push(msg);
        return {
          ok: true,
          state: {
            active: { session: { goal: "Экзамен" } },
            queueCount: 0,
            syncStatus: "ok",
            history: { private: true },
            auth: { token: "secret" },
            settings: { private: true },
          },
        };
      },
    },
  };
  const context = vm.createContext({
    window,
    location: { origin: "https://nazar.test" },
    chrome,
    crypto: webcrypto,
    setTimeout,
    clearTimeout,
    console,
  });
  for (const s of scripts)
    vm.runInContext(
      new TextDecoder().decode(s.outputFiles[0].contents),
      context,
    );
  const result = await (context as any).client.extensionRequest(
    "owner-A",
    "start",
    { goal: "Экзамен", minutes: 5 },
  );
  assert.equal(commands[0].webOwnerId, "owner-A");
  assert.equal(commands[0].type, "start");
  assert.equal(result.active.session.goal, "Экзамен");
  assert.equal(result.auth, undefined);
  assert.equal(result.history, undefined);
  assert.equal(result.settings, undefined);
  const count = commands.length;
  for (const f of [...handlers])
    await f({
      source: window,
      origin: "https://nazar.test",
      data: {
        channel: "nazar4-request",
        requestId: "x",
        type: "history",
        ownerId: "owner-A",
      },
    });
  assert.equal(
    commands.length,
    count,
    "website cannot import browsing history through the bridge",
  );
  for (const f of [...handlers])
    await f({
      source: {},
      origin: "https://evil.test",
      data: {
        channel: "nazar4-request",
        requestId: "x",
        type: "start",
        ownerId: "owner-A",
      },
    });
  assert.equal(commands.length, count);
  assert.ok(!JSON.stringify(sent).includes("secret"));
});
