import "dotenv/config";
import { createApp } from "./app.ts";
import { db } from "./db.ts";
const port = Number(process.env.PORT || 3001);
const server = createApp().listen(port, "127.0.0.1", () =>
  console.log(`Nazar API + built web: http://localhost:${port}`),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(() => void db.$disconnect().then(() => process.exit(0))),
  );
