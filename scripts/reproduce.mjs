import { cp, mkdir, writeFile, copyFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { execFileSync } from "node:child_process";
const root = process.cwd();
const target = join(root, "artifacts", "clean-" + Date.now());
await mkdir(target, { recursive: true });
const skip = new Set([
  "node_modules",
  ".git",
  "data",
  "artifacts",
  "dist",
  "generated",
  "generated-pg",
  "dist-production",
  "downloads",
  ".env",
]);
for (const name of [
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "prisma.config.ts",
  "prisma.pg.config.ts",
  "api",
  "vercel.json",
  "apps",
  "packages",
  "scripts",
  "tests",
  ".env.example",
]) {
  await cp(join(root, name), join(target, name), {
    recursive: true,
    filter: (p) =>
      !relative(root, p)
        .split(/[\\/]/)
        .some((s) => skip.has(s)),
  });
}
await copyFile(join(target, ".env.example"), join(target, ".env"));
const npm = process.env.npm_execpath;
if (!npm) throw Error("Run through npm run verify:clean");
let log = "";
for (const args of [
  ["ci"],
  ["run", "db:generate"],
  ["run", "db:migrate"],
  ["run", "typecheck"],
  ["test"],
  ["run", "build"],
]) {
  console.log("Clean workspace:", args.join(" "));
  try {
    log += execFileSync(process.execPath, [npm, ...args], {
      cwd: target,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    log += "\n" + e.stdout + "\n" + e.stderr;
    await writeFile(join(root, "artifacts", "clean-install.log"), log);
    throw e;
  }
}
await writeFile(join(root, "artifacts", "clean-install.log"), log);
console.log("Clean install/build/tests passed:", target);
