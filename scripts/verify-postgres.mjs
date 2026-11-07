import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import pg from "pg";
import assert from "node:assert/strict";
const bin = process.env.POSTGRES_BIN || "C:/Program Files/PostgreSQL/18/bin";
const dir = resolve("artifacts/pg-" + randomUUID());
await mkdir(dir, { recursive: true });
const port = String(55400 + Math.floor(Math.random() * 100));
const options = { windowsHide: true, encoding: "utf8", stdio: "pipe" };
execFileSync(
  bin + "/initdb.exe",
  ["-D", dir, "-U", "nazar_test", "-A", "trust", "--no-locale", "-E", "UTF8"],
  options,
);
execFileSync(
  bin + "/pg_ctl.exe",
  [
    "-D",
    dir,
    "-l",
    dir + "/server.log",
    "-o",
    "-h 127.0.0.1 -p " + port + " -F",
    "-w",
    "start",
  ],
  { ...options, stdio: "ignore" },
);
try {
  const url = "postgresql://nazar_test@127.0.0.1:" + port + "/postgres";
  execFileSync(
    process.execPath,
    [
      "node_modules/prisma/build/index.js",
      "migrate",
      "deploy",
      "--config",
      "prisma.pg.config.ts",
    ],
    { ...options, env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url } },
  );
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const tables = await client.query(
    "SELECT tablename FROM pg_tables WHERE schemaname='public'",
  );
  assert.ok(tables.rows.some((r) => r.tablename === "RateLimit"));
  await client.end();
  execFileSync(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "scripts/verify-pg-api.ts"],
    {
      ...options,
      env: { ...process.env, DATABASE_URL: url, NODE_ENV: "development" },
    },
  );
  execFileSync(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "scripts/verify-serverless.ts"],
    {
      ...options,
      env: {
        ...process.env,
        DATABASE_URL: url,
        NODE_ENV: "production",
        VERCEL: "1",
        VERCEL_URL: "nazar-verification.invalid",
        VERCEL_PROJECT_PRODUCTION_URL: "nazar-verification.invalid",
        WEB_ORIGIN: "https://nazar-verification.invalid",
      },
    },
  );
  console.log(
    "PostgreSQL 18: real migration + HTTP auth/pairing/mobile/session/rate-limit PASS",
  );
} finally {
  execFileSync(
    bin + "/pg_ctl.exe",
    ["-D", dir, "-w", "stop", "-m", "fast"],
    options,
  );
}
