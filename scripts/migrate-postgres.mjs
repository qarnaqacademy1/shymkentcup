import "dotenv/config";
import { execFileSync } from "node:child_process";
if (
  !/^postgres(?:ql)?:\/\//.test(
    process.env.DIRECT_URL || process.env.DATABASE_URL || "",
  )
)
  throw Error(
    "Explicit PostgreSQL DIRECT_URL or DATABASE_URL required; SQLite will not be modified",
  );
execFileSync(
  process.execPath,
  [
    "node_modules/prisma/build/index.js",
    "migrate",
    "deploy",
    "--config",
    "prisma.pg.config.ts",
  ],
  { stdio: "inherit", env: process.env },
);
