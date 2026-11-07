// Local HTTP + real PostgreSQL, with Vercel environment semantics. Not a cloud deploy.
import assert from "node:assert/strict";
import { createApp } from "../apps/api/src/app.ts";
import { db } from "../apps/api/src/db.ts";
import { randomUUID } from "node:crypto";
import {request} from 'node:http';
const server = createApp().listen(0, "127.0.0.1");
await new Promise<void>((r) => server.once("listening", r));
const base = "http://127.0.0.1:" + (server.address() as { port: number }).port;
try {
  const origin = "https://nazar-verification.invalid";
  const host = new URL(origin).host;
  const call = (
    path: string,
    method = "GET",
    body?: unknown,
    extra: Record<string, string> = {},
  ):Promise<Response> =>new Promise((resolve,reject)=>{
    const r=request(base+'/api'+path,{method,headers:{
        Host: host,
        Origin: origin,
        "Content-Type": "application/json",
        "X-Nazar": "1",
        ...extra,
      }},res=>{const chunks:Buffer[]=[];res.on('data',b=>chunks.push(b));res.on('end',()=>{const headers=new Headers();for(const [k,v] of Object.entries(res.headers))if(v!==undefined)headers.set(k,Array.isArray(v)?v.join(', '):v);resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers}));});});r.on('error',reject);if(body!==undefined)r.write(JSON.stringify(body));r.end();});
  assert.equal(
    (await call("/health", "GET", undefined, { Host: "attacker.invalid" }))
      .status,
    400,
  );
  assert.equal(
    (
      await call(
        "/auth/register",
        "POST",
        { email: "bad@example.test", password: "serverless-test-pass" },
        { Origin: "https://evil.invalid" },
      )
    ).status,
    403,
  );
  const reg = await call("/auth/register", "POST", {
    email: "serverless@example.test",
    password: "serverless-test-pass",
  });
  assert.equal(reg.status, 201);
  const cookieHeader = reg.headers.get("set-cookie")!;
  assert.match(cookieHeader, /__Host-nazar=/);
  assert.match(cookieHeader, /Secure/);
  assert.match(cookieHeader, /HttpOnly/);
  assert.match(cookieHeader, /SameSite=Strict/);
  assert.equal(reg.headers.get("access-control-allow-origin"), origin);
  const Cookie = cookieHeader.split(";")[0];
  assert.equal(
    (await call("/settings", "GET", undefined, { Cookie })).status,
    200,
  );
  const code = await call("/pair/code", "POST", {}, { Cookie });
  assert.equal(code.status, 200);
  const exchange = await call(
    "/pair/exchange",
    "POST",
    { code: (await code.json()).code, instanceId: randomUUID() },
    { Origin: "chrome-extension://" + "c".repeat(32), Cookie },
  );
  assert.equal(exchange.status, 200);
  assert.equal(exchange.headers.get("access-control-allow-origin"), null);
  assert.equal(exchange.headers.get("set-cookie"), null);
  assert.ok((await db.rateLimit.count()) > 0);
} finally {
  await new Promise<void>((r) => server.close(() => r()));
  await db.$disconnect();
}
