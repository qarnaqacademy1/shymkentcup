// Explicit, optional cutover. Never runs from build, migration or deployment.
import "dotenv/config";
import { PrismaClient as LocalClient } from "../apps/api/generated/prisma/client.ts";
import { PrismaClient as PgClient } from "../apps/api/generated-pg/prisma/client.ts";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaPg } from "@prisma/adapter-pg";
import { resolve } from "node:path";
import { backupDatabase } from "./backup-db.mjs";
const source = process.env.LOCAL_DATABASE_URL || "file:./data/nazar.db";
if (!source.startsWith("file:")) throw Error("Source must remain local SQLite");
const target = process.env.PRODUCTION_DATABASE_URL;
if (!target || !/^postgres(?:ql)?:/.test(target))
  throw Error(
    "Set PRODUCTION_DATABASE_URL privately; never pass credentials as arguments",
  );
const host = new URL(target).host;
if (
  process.argv.includes("--apply") &&
  !process.argv.includes("--confirm-target=" + host)
)
  throw Error("Explicit --confirm-target=" + host + " required for transfer");
const local = new LocalClient({
  adapter: new PrismaLibSql({
    url: source.startsWith("file:./")
      ? "file:" + resolve(source.slice(5)).replaceAll("\\", "/")
      : source,
  }),
});
const pg = new PgClient({
  adapter: new PrismaPg({ connectionString: target, max: 2 }),
});
const models = ["user", "credential", "pairCode", "studySession"];
try {
  const data = {};
  for (const model of models) data[model] = await local[model].findMany();
  console.log(
    "Source counts:",
    Object.fromEntries(models.map((m) => [m, data[m].length])),
  );
  if (!process.argv.includes("--apply")) {
    console.log(
      "Dry run only. No personal data sent. Explicit target confirmation required.",
    );
    process.exitCode = 0;
  } else {
    await backupDatabase(source);
    await pg.$transaction(
      async (tx) => {
        for (const model of models)
          for (const row of data[model]) {
            const where =
              model === "pairCode" ? { hash: row.hash } : { id: row.id };
            const existing = await tx[model].findUnique({ where });
            if (existing && JSON.stringify(existing) !== JSON.stringify(row))
              throw Error(
                "Target conflict in " + model + "; transaction rolled back",
              );
            if (!existing) await tx[model].create({ data: row });
          }
        for (const model of models) {
          const keys = data[model].map((r) =>
            model === "pairCode" ? r.hash : r.id,
          );
          const count = await tx[model].count({
            where:
              model === "pairCode"
                ? { hash: { in: keys } }
                : { id: { in: keys } },
          });
          if (count !== keys.length)
            throw Error("Count verification failed; rollback");
        }
      },
      { timeout: 120000 },
    );
    console.log(
      "Transfer verified. SQLite unchanged. Repeating is idempotent. Cutover/rollback uses environment configuration.",
    );
  }
} finally {
  await local.$disconnect();
  await pg.$disconnect();
}
