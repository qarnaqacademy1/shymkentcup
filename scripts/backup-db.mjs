import "dotenv/config";
import { createClient } from "@libsql/client";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { zipSync, unzipSync } from "fflate";
export async function backupDatabase(
  raw = process.env.DATABASE_URL || "file:./data/nazar.db",
) {
  if (!raw.startsWith("file:")) throw Error("SQLite backup requires file: URL");
  const file = resolve(raw.slice(5));
  try {
    await readFile(file);
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
  const dir = resolve("data/backups");
  await mkdir(dir, { recursive: true });
  const stem =
      "nazar-" + Date.now() + "-" + Math.random().toString(16).slice(2),
    snapshot = resolve(dir, stem + ".db");
  const client = createClient({ url: "file:" + file.replaceAll("\\", "/") });
  try {
    await client.execute({
      sql: "VACUUM INTO ?",
      args: [snapshot.replaceAll("\\", "/")],
    });
  } finally {
    client.close();
  }
  const verify = createClient({
    url: "file:" + snapshot.replaceAll("\\", "/"),
  });
  let counts = {};
  try {
    const check = await verify.execute("PRAGMA integrity_check");
    if (check.rows[0].integrity_check !== "ok")
      throw Error("Backup integrity failed");
    for (const table of ["User", "Credential", "PairCode", "StudySession"]) {
      const exists = await verify.execute({
        sql: "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        args: [table],
      });
      if (exists.rows.length)
        counts[table] = Number(
          (await verify.execute('SELECT COUNT(*) AS n FROM "' + table + '"'))
            .rows[0].n,
        );
    }
  } finally {
    verify.close();
  }
  const bytes = new Uint8Array(await readFile(snapshot));
  const manifest = {
    createdAt: new Date().toISOString(),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    counts,
  };
  const archive = resolve(dir, stem + ".zip");
  const zip = zipSync({
    "nazar.db": bytes,
    "manifest.json": new TextEncoder().encode(
      JSON.stringify(manifest, null, 2),
    ),
  });
  await writeFile(archive, zip);
  const reopened = unzipSync(new Uint8Array(await readFile(archive)));
  if (
    createHash("sha256").update(reopened["nazar.db"]).digest("hex") !==
    manifest.sha256
  )
    throw Error("Backup ZIP checksum failed");
  await unlink(snapshot).catch((e) => {
    if (e.code !== "EBUSY") throw e;
  });
  console.log("Verified private backup:", archive);
  return archive;
}
if (process.argv[1]?.endsWith("backup-db.mjs")) await backupDatabase();
