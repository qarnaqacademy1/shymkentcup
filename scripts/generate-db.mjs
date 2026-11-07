import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
const schema = await readFile("apps/api/prisma/schema.prisma", "utf8");
await mkdir("apps/api/prisma-pg/migrations/202611070001_initial", {
  recursive: true,
});
await writeFile(
  "apps/api/prisma-pg/schema.prisma",
  schema
    .replace('provider = "sqlite"', 'provider = "postgresql"')
    .replace(
      'output = "../generated/prisma"',
      'output = "../generated-pg/prisma"',
    ),
);
const initial = await readFile(
  "apps/api/prisma/migrations/202611060001_initial/migration.sql",
  "utf8",
);
const rate = await readFile(
  "apps/api/prisma/migrations/202611070001_rate_limits/migration.sql",
  "utf8",
);
await writeFile(
  "apps/api/prisma-pg/migrations/202611070001_initial/migration.sql",
  (initial.replace("PRAGMA foreign_keys=ON;", "") + "\n" + rate).replaceAll(
    "DATETIME",
    "TIMESTAMP(3)",
  ),
);
await writeFile(
  "apps/api/prisma-pg/migrations/migration_lock.toml",
  'provider = "postgresql"\n',
);
for (const config of ["prisma.config.ts", "prisma.pg.config.ts"])
  execFileSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "generate", "--config", config],
    { stdio: "inherit" },
  );
