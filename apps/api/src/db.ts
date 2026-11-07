import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client.ts";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient as PgClient } from "../generated-pg/prisma/client.ts";
import { PrismaPg } from "@prisma/adapter-pg";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
// Always resolve relative database paths from repository root, including workspace dev.
const root = process.cwd().replace(/[\\/]apps[\\/]api$/, "");
const url = process.env.DATABASE_URL || "file:./data/nazar.db";
if (process.env.VERCEL && !/^postgres(?:ql)?:\/\//.test(url))
  throw Error("Vercel requires persistent PostgreSQL DATABASE_URL");
if (url.startsWith("file:./"))
  mkdirSync(resolve(root, url.slice(5), ".."), { recursive: true });
const sqlite = () =>
  new PrismaClient({
    adapter: new PrismaLibSql({
      url: url.startsWith("file:./")
        ? "file:" + resolve(root, url.slice(5)).replaceAll("\\", "/")
        : url,
    }),
  });
// Both clients are generated from the same models, with separate database providers.
export const db: ReturnType<typeof sqlite> = /^postgres(?:ql)?:\/\//.test(url)
  ? (new PgClient({
      adapter: new PrismaPg({ connectionString: url, max: 3 }),
    }) as unknown as ReturnType<typeof sqlite>)
  : sqlite();
