import "dotenv/config";
import { build } from "esbuild";
import { mkdir, copyFile, writeFile, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { zipSync } from "fflate";
import { readdir } from "node:fs/promises";
const mode = process.argv.includes("--production")
  ? "production"
  : "development";
const productionOrigin =
  process.env.NAZAR_PUBLIC_ORIGIN ||
  process.env.WEB_ORIGIN ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? "https://" + process.env.VERCEL_PROJECT_PRODUCTION_URL
    : "");
const api =
  mode === "production"
    ? productionOrigin
    : process.env.NAZAR_API_URL || "http://localhost:3001";
const web =
  mode === "production"
    ? productionOrigin
    : process.env.NAZAR_WEB_URL || "http://localhost:5173";
if (
  mode === "production" &&
  (!api ||
    new URL(api).protocol !== "https:" ||
    ["localhost", "127.0.0.1"].includes(new URL(api).hostname))
)
  throw Error("Production extension requires a real HTTPS NAZAR_PUBLIC_ORIGIN");
const extensionDir =
  mode === "production"
    ? "apps/extension/dist-production"
    : "apps/extension/dist";
if (!/^https?:$/.test(new URL(api).protocol))
  throw Error("HTTP(S) API required");
const pkg = JSON.parse(await readFile("package.json", "utf8"));
await build({
  entryPoints: ["apps/api/src/server.ts"],
  outfile: "apps/api/dist/server.js",
  bundle: true,
  platform: "node",
  format: "esm",
  external: [
    ...Object.keys(pkg.dependencies).filter((k) => k !== "@nazar/shared"),
    "ai",
  ],
});
await build({
  entryPoints: ["apps/api/src/handler.ts"],
  outfile: "apps/api/dist/handler.js",
  bundle: true,
  platform: "node",
  format: "esm",
  external: [
    ...Object.keys(pkg.dependencies).filter((k) => k !== "@nazar/shared"),
    "ai",
  ],
});
execFileSync(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "build", "apps/web"],
  { stdio: "inherit", env: { ...process.env, VITE_EXTENSION_MODE: mode } },
);
await mkdir(extensionDir, { recursive: true });
await mkdir("downloads", { recursive: true });
await build({
  entryPoints: [
    "apps/extension/src/worker.ts",
    "apps/extension/src/popup.ts",
    "apps/extension/src/bridge.ts",
  ],
  outdir: extensionDir,
  bundle: true,
  format: "esm",
  target: "chrome120",
  define: {
    __API_URL__: JSON.stringify(api),
    __WEB_URL__: JSON.stringify(web),
  },
});
for (const name of ["popup.html", "popup.css", "icon.png"])
  await copyFile("apps/extension/public/" + name, extensionDir + "/" + name);
await writeFile(
  extensionDir + "/manifest.json",
  JSON.stringify(
    {
      manifest_version: 3,
      name: "Nazar — внимание по твоим правилам",
      version: "0.4.0",
      minimum_chrome_version: "120",
      description: "Учебные сессии, бюджет сайтов и осознанные исключения.",
      permissions: [
        "storage",
        "tabs",
        "history",
        "idle",
        "alarms",
        "notifications",
        "declarativeNetRequest",
      ],
      host_permissions: ["http://*/*", "https://*/*"],
      externally_connectable: { matches: [new URL(web).origin + "/*"] },
      content_scripts: [
        {
          matches: [new URL(web).origin + "/*"],
          js: ["bridge.js"],
          run_at: "document_start",
        },
      ],
      background: { service_worker: "worker.js", type: "module" },
      action: { default_popup: "popup.html", default_title: "Nazar" },
      icons: { 128: "icon.png" },
    },
    null,
    2,
  ),
);
const files = {};
for (const name of await readdir(extensionDir))
  files[name] = new Uint8Array(await readFile(extensionDir + "/" + name));
const archive = zipSync(files);
await writeFile(`downloads/nazar-extension-${mode}.zip`, archive);
await writeFile("downloads/nazar-extension.zip", archive);
await mkdir("apps/web/dist/downloads", { recursive: true });
await writeFile("apps/web/dist/downloads/nazar-extension.zip", archive);
await writeFile(`apps/web/dist/downloads/nazar-extension-${mode}.zip`, archive);
console.log(
  `Extension ${mode}: ${extensionDir}; ZIP: downloads/nazar-extension-${mode}.zip`,
);
