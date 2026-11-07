import "dotenv/config";
import { createClient } from "@libsql/client";
import { resolve, dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { backupDatabase } from "./backup-db.mjs";
const raw = process.env.DATABASE_URL || "file:./data/nazar.db";
await backupDatabase(raw);
const url = raw.startsWith("file:./")
  ? "file:" + resolve(raw.slice(5)).replaceAll("\\", "/")
  : raw;
if (raw.startsWith("file:./"))
  mkdirSync(dirname(resolve(raw.slice(5))), { recursive: true });
// Prisma's Windows schema engine requires the SQLite file to exist on this runtime.
const client = createClient({ url });
await client.execute("PRAGMA foreign_keys=ON");
client.close();
execFileSync(
  process.execPath,
  ["node_modules/prisma/build/index.js", "migrate", "deploy"],
  { stdio: "inherit", env: process.env },
);
