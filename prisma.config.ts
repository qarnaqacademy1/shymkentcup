import "dotenv/config";
import { defineConfig } from "prisma/config";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
const raw = process.env.DATABASE_URL || "file:./data/nazar.db";
const url = raw.startsWith("file:./")
  ? "file:" + resolve(raw.slice(5)).replaceAll("\\", "/")
  : raw;
if (raw.startsWith("file:./"))
  mkdirSync(resolve(raw.slice(5), ".."), { recursive: true });
export default defineConfig({
  schema: "apps/api/prisma/schema.prisma",
  migrations: { path: "apps/api/prisma/migrations" },
  datasource: { url },
});
