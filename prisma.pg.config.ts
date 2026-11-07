import "dotenv/config";
import { defineConfig } from "prisma/config";
export default defineConfig({
  schema: "apps/api/prisma-pg/schema.prisma",
  migrations: { path: "apps/api/prisma-pg/migrations" },
  datasource: {
    url:
      process.env.DIRECT_URL ||
      (/^postgres(?:ql)?:/.test(process.env.DATABASE_URL || "")
        ? process.env.DATABASE_URL
        : undefined) ||
      "postgresql://localhost:5432/nazar",
  },
});
