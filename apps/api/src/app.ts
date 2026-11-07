import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { hash as passwordHash, verify, Algorithm } from "@node-rs/argon2";
import { randomBytes, createHash } from "node:crypto";
import { z, ZodError } from "zod";
import {
  defaults,
  settingsSchema,
  sessionSchema,
  historySchema,
  totals,
  splitDays,
} from "@nazar/shared";
import { db } from "./db.ts";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { DatabaseRateLimitStore } from "./rate-limit.ts";
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const token = () => randomBytes(32).toString("base64url");
const production =
  process.env.NODE_ENV === "production" || !!process.env.VERCEL;
const deploymentHost = process.env.VERCEL_URL;
const origin =
  process.env.WEB_ORIGIN ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? "https://" + process.env.VERCEL_PROJECT_PRODUCTION_URL
    : "http://localhost:5173");
const allowedOrigins = new Set(
  production
    ? [origin, ...(deploymentHost ? ["https://" + deploymentHost] : [])]
    : [origin, "http://localhost:3001"],
);
const cookie = production ? "__Host-nazar" : "nazar";
type Auth = {
  userId: string;
  kind: string;
  id: string;
  instanceId: string | null;
};
type Authed = Request & { auth: Auth };
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const need = (v: unknown, status: number, msg: string) => {
  if (!v) throw new HttpError(status, msg);
};
export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  if (process.env.VERCEL) {
    app.set("trust proxy", 1);
    app.use((req, res, next) => {
      const hosts = [...allowedOrigins].map((v) => new URL(v).host);
      if (!hosts.includes(req.get("host") || ""))
        return res.status(400).json({ error: "Недопустимый хост" });
      next();
    });
  }
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          "script-src": ["'self'"],
          "img-src": ["'self'", "data:"],
          "style-src": ["'self'", "'unsafe-inline'"],
        },
      },
    }),
  );
  app.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (allowedOrigins.has(req.headers.origin || "")) {
      res.setHeader("Access-Control-Allow-Origin", req.headers.origin!);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Nazar");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE");
    }
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });
  app.use(express.json({ limit: "2mb" }), cookieParser());
  // Extensions use host_permissions, not the website's credentialed CORS grant.
  // An extension Origin is transport metadata, NOT authentication: only the
  // single-use code or a verified device bearer can authorize these routes.
  app.use("/api", (req, res, next) => {
    if (!["GET", "HEAD"].includes(req.method)) {
      if (req.headers["x-nazar"] !== "1")
        return res.status(403).json({ error: "Отсутствует защита запроса" });
      const requestOrigin = req.headers.origin;
      const webOrigin = allowedOrigins.has(requestOrigin || "");
      const extensionOrigin = /^chrome-extension:\/\/[a-p]{32}$/.test(
        requestOrigin || "",
      );
      const bearer = req.headers.authorization?.startsWith("Bearer ") === true;
      const extensionExchange =
        extensionOrigin &&
        req.method === "POST" &&
        req.path === "/pair/exchange";
      const deviceRoute =
        ["/settings", "/history", "/auth/logout"].includes(req.path) ||
        /^\/sessions\/[^/]+$/.test(req.path);
      const extensionDeviceRequest = extensionOrigin && bearer && deviceRoute;
      if (
        requestOrigin &&
        !webOrigin &&
        !extensionExchange &&
        !extensionDeviceRequest
      )
        return res.status(403).json({ error: "Недопустимый источник запроса" });
      if (req.cookies[cookie] && !bearer && !webOrigin && !extensionExchange)
        return res.status(403).json({ error: "Недопустимый источник запроса" });
    }
    next();
  });
  const authLimit = rateLimit({
    store: new DatabaseRateLimitStore("auth"),
    windowMs: 15 * 60000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Слишком много попыток. Повторите через 15 минут." },
  });
  app.use(
    "/api",
    rateLimit({
      store: new DatabaseRateLimitStore("api"),
      windowMs: 60000,
      limit: 240,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: "Слишком много запросов" },
    }),
  );
  const auth = async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const bearer = req.headers.authorization?.startsWith("Bearer ");
      const raw = bearer
        ? req.headers.authorization!.slice(7)
        : req.cookies[cookie];
      need(raw, 401, "Войдите в аккаунт");
      const c = await db.credential.findUnique({
        where: { hash: digest(raw) },
      });
      need(
        c && c.expiresAt > new Date() && c.kind === (bearer ? "device" : "web"),
        401,
        "Срок входа истёк. Подключитесь снова",
      );
      (req as Authed).auth = {
        userId: c!.userId,
        kind: c!.kind,
        id: c!.id,
        instanceId: c!.instanceId,
      };
      next();
    } catch (e) {
      next(e);
    }
  };
  const webOnly = (req: Request, _res: Response, next: NextFunction) => {
    if ((req as Authed).auth.kind !== "web")
      return next(
        new HttpError(403, "Это действие доступно в личном кабинете"),
      );
    next();
  };
  const userId = (req: Request) => (req as Authed).auth.userId;
  const credentials = z.object({
    email: z
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    password: z.string().min(10, "Минимум 10 символов").max(128),
  });
  async function login(res: Response, id: string) {
    const raw = token();
    await db.credential.create({
      data: {
        userId: id,
        hash: digest(raw),
        kind: "web",
        name: "Веб-сессия",
        expiresAt: new Date(Date.now() + 7 * 86400000),
      },
    });
    res.cookie(cookie, raw, {
      httpOnly: true,
      secure: production,
      sameSite: "strict",
      path: "/",
      maxAge: 7 * 86400000,
    });
  }
  app.get("/api/health", async (_req, res) => {
    await db.$queryRaw`SELECT 1`;
    res.json({ ok: true });
  });
  app.get("/api/config", (_req, res) =>
    res.json({
      extensionMode: process.env.VERCEL ? "production" : "development",
      mobileMonitoring: false,
    }),
  );
  app.post("/api/auth/register", authLimit, async (req, res) => {
    const v = credentials.parse(req.body);
    const p = await passwordHash(v.password, {
      algorithm: Algorithm.Argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
    try {
      const u = await db.user.create({
        data: {
          email: v.email,
          passwordHash: p,
          settings: JSON.stringify(defaults),
        },
      });
      await login(res, u.id);
      res.status(201).json({ id: u.id, email: u.email });
    } catch (e: any) {
      if (e.code === "P2002")
        throw new HttpError(409, "Этот email уже зарегистрирован");
      throw e;
    }
  });
  app.post("/api/auth/login", authLimit, async (req, res) => {
    const v = credentials.parse(req.body);
    const u = await db.user.findUnique({ where: { email: v.email } });
    need(
      u && (await verify(u.passwordHash, v.password)),
      401,
      "Неверный email или пароль",
    );
    await login(res, u!.id);
    res.json({ id: u!.id, email: u!.email });
  });
  app.get("/api/auth/me", auth, async (req, res) => {
    const u = await db.user.findUniqueOrThrow({ where: { id: userId(req) } });
    res.json({ id: u.id, email: u.email });
  });
  app.post("/api/auth/logout", auth, async (req, res) => {
    await db.credential.deleteMany({ where: { id: (req as Authed).auth.id } });
    res.clearCookie(cookie, {
      path: "/",
      secure: production,
      sameSite: "strict",
      httpOnly: true,
    });
    res.json({ ok: true });
  });
  app.post("/api/pair/code", auth, webOnly, authLimit, async (req, res) => {
    const code = randomBytes(12).toString("hex");
    const expiresAt = new Date(Date.now() + 5 * 60000);
    await db.$transaction([
      db.pairCode.deleteMany({ where: { userId: userId(req) } }),
      db.pairCode.create({
        data: { hash: digest(code), userId: userId(req), expiresAt },
      }),
    ]);
    res.json({ code, expiresAt });
  });
  app.post("/api/pair/exchange", authLimit, async (req, res) => {
    const v = z
      .object({
        code: z.string().regex(/^[a-f0-9]{24}$/),
        instanceId: z.uuid(),
      })
      .parse(req.body);
    const raw = token();
    const expiresAt = new Date(Date.now() + 30 * 86400000);
    const result = await db.$transaction(async (tx) => {
      const c = await tx.pairCode.findUnique({
        where: { hash: digest(v.code) },
      });
      need(
        c && c.expiresAt > new Date(),
        400,
        "Код неверен, истёк или уже использован",
      );
      const deleted = await tx.pairCode.deleteMany({
        where: { hash: digest(v.code), expiresAt: { gt: new Date() } },
      });
      need(deleted.count === 1, 400, "Код уже использован");
      const u = await tx.user.findUniqueOrThrow({ where: { id: c!.userId } });
      await tx.credential.create({
        data: {
          userId: u.id,
          hash: digest(raw),
          kind: "device",
          instanceId: v.instanceId,
          name: "Chrome / Nazar",
          expiresAt,
        },
      });
      return { id: u.id, email: u.email };
    });
    res.json({
      token: raw,
      expiresAt,
      ownerId: result.id,
      email: result.email,
      instanceId: v.instanceId,
    });
  });
  app.get("/api/devices", auth, webOnly, async (req, res) =>
    res.json(
      await db.credential.findMany({
        where: { userId: userId(req), kind: "device" },
        select: { id: true, name: true, expiresAt: true, createdAt: true },
      }),
    ),
  );
  app.delete("/api/devices/:id", auth, webOnly, async (req, res) => {
    await db.credential.deleteMany({
      where: { id: String(req.params.id), userId: userId(req), kind: "device" },
    });
    res.json({ ok: true });
  });
  app.get("/api/settings", auth, async (req, res) => {
    const u = await db.user.findUniqueOrThrow({ where: { id: userId(req) } });
    res.json(JSON.parse(u.settings));
  });
  app.put("/api/settings", auth, async (req, res) => {
    const v = settingsSchema.parse(req.body);
    await db.user.update({
      where: { id: userId(req) },
      data: {
        settings: JSON.stringify(v),
        ...(!v.shareHistory ? { history: null } : {}),
      },
    });
    res.json(v);
  });
  app.put("/api/sessions/:clientSessionId", auth, async (req, res) => {
    const v = sessionSchema.parse(req.body);
    if (v.source === "mobile")
      need(
        req.body.ownerId === userId(req),
        403,
        "Очередь принадлежит другому аккаунту",
      );
    need(
      v.clientSessionId === req.params.clientSessionId,
      400,
      "ID не совпадает",
    );
    need(
      v.source === "mobile"
        ? (req as Authed).auth.kind === "web"
        : (req as Authed).auth.kind === "device" &&
            (req as Authed).auth.instanceId === v.instanceId,
      403,
      "Сессия принадлежит другому устройству",
    );
    need(v.endedAt <= Date.now() + 60000, 400, "Сессия в будущем");
    const payload = JSON.stringify(v),
      payloadHash = digest(payload);
    const key = { userId: userId(req), clientSessionId: v.clientSessionId };
    const existing = await db.studySession.findUnique({
      where: { userId_clientSessionId: key },
    });
    if (existing) {
      need(
        existing.payloadHash === payloadHash,
        409,
        "Этот результат уже сохранён с другими данными",
      );
      res.json({ id: existing.id, synced: true });
      return;
    }
    try {
      const s = await db.studySession.create({
        data: {
          ...key,
          instanceId: v.instanceId,
          startedAt: new Date(v.startedAt),
          endedAt: new Date(v.endedAt),
          payload,
          payloadHash,
        },
      });
      res.status(201).json({ id: s.id, synced: true });
    } catch (e: any) {
      if (e.code !== "P2002") throw e;
      const s = await db.studySession.findUniqueOrThrow({
        where: { userId_clientSessionId: key },
      });
      need(
        s.payloadHash === payloadHash,
        409,
        "Конфликт сохранённого результата",
      );
      res.json({ id: s.id, synced: true });
    }
  });
  app.get("/api/sessions", auth, async (req, res) => {
    const page = z.coerce
      .number()
      .int()
      .min(0)
      .max(10000)
      .parse(req.query.page ?? 0);
    const rows = await db.studySession.findMany({
      where: { userId: userId(req) },
      orderBy: { startedAt: "desc" },
      skip: page * 30,
      take: 30,
    });
    res.json(
      rows.map((s) => ({
        id: s.id,
        ...JSON.parse(s.payload),
        ...totals(JSON.parse(s.payload)),
      })),
    );
  });
  app.get("/api/sessions/:id", auth, async (req, res) => {
    const s = await db.studySession.findFirst({
      where: { id: String(req.params.id), userId: userId(req) },
    });
    need(s, 404, "Сессия не найдена");
    res.json({
      id: s!.id,
      ...JSON.parse(s!.payload),
      ...totals(JSON.parse(s!.payload)),
    });
  });
  app.get("/api/stats", auth, async (req, res) => {
    const query = z
      .object({
        from: z.coerce.number().int().nonnegative(),
        to: z.coerce.number().int().nonnegative(),
      })
      .refine((v) => v.to > v.from && v.to - v.from <= 366 * 86400000)
      .parse(req.query);
    const u = await db.user.findUniqueOrThrow({ where: { id: userId(req) } });
    const tz = JSON.parse(u.settings).timezone;
    const rows = await db.studySession.findMany({
      where: {
        userId: userId(req),
        startedAt: { lt: new Date(query.to) },
        endedAt: { gte: new Date(query.from) },
      },
    });
    const days: Record<string, { trackedMs: number; distractedMs: number }> =
      {};
    let trackedMs = 0,
      distractedMs = 0;
    for (const row of rows) {
      const s = sessionSchema.parse(JSON.parse(row.payload));
      for (const i of s.intervals) {
        const clipped = {
          ...i,
          start: Math.max(query.from, i.start),
          end: Math.min(query.to, i.end),
        };
        if (clipped.end <= clipped.start) continue;
        for (const p of splitDays(clipped, tz)) {
          days[p.day] ??= { trackedMs: 0, distractedMs: 0 };
          days[p.day].trackedMs += p.ms;
          trackedMs += p.ms;
          if (p.distracting) {
            days[p.day].distractedMs += p.ms;
            distractedMs += p.ms;
          }
        }
      }
    }
    const sessions = rows
      .map((r) => sessionSchema.parse(JSON.parse(r.payload)))
      .filter((s) => s.endedAt >= query.from && s.endedAt < query.to);
    res.json({
      trackedMs,
      distractedMs,
      sessions: sessions.length,
      completed: sessions.filter((s) => s.status === "completed").length,
      taskDone: sessions.filter((s) => s.taskDone).length,
      withinBudget: sessions.filter(
        (s) =>
          s.source !== "mobile" && totals(s).distractedMs <= s.rules.budgetMs,
      ).length,
      timezone: tz,
      days,
      mobileSessions: sessions.filter((s) => s.source === "mobile").length,
      extensionSessions: sessions.filter((s) => s.source !== "mobile").length,
      warnings: sessions.reduce((n, s) => n + s.warnings.length, 0),
      exceptions: sessions.reduce((n, s) => n + s.exceptions.length, 0),
      overBudgetMs: sessions
        .filter((s) => s.source !== "mobile")
        .reduce((n, s) => n + totals(s).overBudgetMs, 0),
    });
  });
  app.get("/api/export", auth, webOnly, async (req, res) => {
    const u = await db.user.findUniqueOrThrow({ where: { id: userId(req) } });
    const rows = await db.studySession.findMany({
      where: { userId: u.id },
      orderBy: { startedAt: "desc" },
    });
    if (req.query.format === "csv") {
      // Prefix formula-like spreadsheet cells to prevent CSV formula injection.
      const cell = (v: unknown) => {
        let s = String(v ?? "");
        if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
        return '"' + s.replaceAll('"', '""') + '"';
      };
      const lines = [
        [
          "goal",
          "source",
          "startedAt",
          "endedAt",
          "elapsedMs",
          "trackedMs",
          "distractedMs",
          "taskDone",
          "note",
        ],
        ...rows.map((r) => {
          const s = sessionSchema.parse(JSON.parse(r.payload));
          const t = totals(s);
          return [
            s.goal,
            s.source || "extension",
            new Date(s.startedAt).toISOString(),
            new Date(s.endedAt).toISOString(),
            s.elapsedMs,
            t.trackedMs,
            t.distractedMs,
            s.taskDone,
            s.note || "",
          ];
        }),
      ];
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="nazar-sessions.csv"',
      );
      res
        .type("text/csv")
        .send("\ufeff" + lines.map((r) => r.map(cell).join(",")).join("\r\n"));
      return;
    }
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="nazar-data.json"',
    );
    res.json({
      exportedAt: new Date().toISOString(),
      user: { id: u.id, email: u.email },
      settings: JSON.parse(u.settings),
      history: u.history ? JSON.parse(u.history) : null,
      sessions: rows.map((r) => ({ id: r.id, ...JSON.parse(r.payload) })),
    });
  });
  app.get("/api/history", auth, async (req, res) => {
    const u = await db.user.findUniqueOrThrow({ where: { id: userId(req) } });
    res.json(u.history ? JSON.parse(u.history) : null);
  });
  app.put("/api/history", auth, async (req, res) => {
    const v = historySchema.parse(req.body);
    const u = await db.user.findUniqueOrThrow({ where: { id: userId(req) } });
    need(
      JSON.parse(u.settings).shareHistory,
      403,
      "Сначала разрешите сводку истории в настройках",
    );
    await db.user.update({
      where: { id: u.id },
      data: { history: JSON.stringify(v) },
    });
    res.json({ ok: true });
  });
  app.delete("/api/history", auth, async (req, res) => {
    await db.user.update({
      where: { id: userId(req) },
      data: { history: null },
    });
    res.json({ ok: true });
  });
  app.delete("/api/account", auth, webOnly, async (req, res) => {
    const v = z.object({ password: z.string().max(128) }).parse(req.body);
    const u = await db.user.findUniqueOrThrow({ where: { id: userId(req) } });
    need(await verify(u.passwordHash, v.password), 403, "Неверный пароль");
    await db.user.delete({ where: { id: u.id } });
    res.clearCookie(cookie, { path: "/" });
    res.json({ ok: true });
  });
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "Маршрут не найден" }),
  );
  const root = process.cwd().replace(/[\\/]apps[\\/]api$/, "");
  const web = resolve(root, "apps/web/dist");
  app.get("/downloads/nazar-extension.zip", (_req, res) =>
    res.download(resolve(root, "downloads/nazar-extension.zip")),
  );
  if (existsSync(web)) {
    app.use(express.static(web));
    app.get("/{*path}", (_req, res) =>
      res.sendFile(resolve(web, "index.html")),
    );
  }
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      res
        .status(400)
        .json({ error: err.issues.map((x) => x.message).join("; ") });
      return;
    }
    const status =
      err instanceof HttpError
        ? err.status
        : err.status === 413
          ? 413
          : err instanceof SyntaxError
            ? 400
            : 500;
    if (status === 500) console.error("API failure", err.code || err.name);
    res.status(status).json({
      error:
        status === 500
          ? "Ошибка сервера"
          : status === 413
            ? "Слишком большой запрос"
            : err.message,
    });
  });
  return app;
}
