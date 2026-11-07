import { z } from "zod";
export function domainOf(value: string): string | null {
  try {
    const u = new URL(
      value.includes("://") ? value : "https://" + value.trim(),
    );
    if (!["http:", "https:"].includes(u.protocol)) return null;
    const h = u.hostname
      .toLowerCase()
      .replace(/\.$/, "")
      .replace(/^www\./, "");
    return h && !h.includes(" ") ? h : null;
  } catch {
    return null;
  }
}
const domain = z
  .string()
  .max(253)
  .refine(
    (v) => domainOf(v) === v,
    "Укажите домен без пути, например youtube.com",
  );
export const settingsSchema = z.object({
  domains: z.array(domain).max(100),
  budgetMs: z.number().int().min(1000).max(86400000),
  timezone: z.string().refine((v) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: v });
      return true;
    } catch {
      return false;
    }
  }, "Неизвестный часовой пояс"),
  shareHistory: z.boolean(),
  weeklyGoal: z.number().int().min(0).max(100).optional(),
});
export type Settings = z.infer<typeof settingsSchema>;
export const defaults: Settings = {
  domains: ["youtube.com", "instagram.com", "tiktok.com"],
  budgetMs: 300000,
  timezone: "Asia/Almaty",
  shareHistory: false,
};
export function matches(host: string, rule: string) {
  return host === rule || host.endsWith("." + rule);
}
export const intervalSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  domain,
  distracting: z.boolean(),
});
const exceptionSchema = z.object({
  domain,
  at: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative().optional(),
  until: z.enum(["time", "session"]).optional(),
});
export const decisionSchema = z.object({
  domain: domain.optional(),
  at: z.number().int().nonnegative(),
  kind: z.enum(["budget", "context"]),
  action: z.enum(["return", "allow5", "allow-session", "details"]),
  expiresAt: z.number().int().nonnegative().optional(),
});
export const sessionSchema = z
  .object({
    clientSessionId: z.uuid(),
    instanceId: z.uuid(),
    goal: z.string().trim().min(1).max(200),
    startedAt: z.number().int().nonnegative(),
    endedAt: z.number().int().nonnegative(),
    plannedMs: z.number().int().min(1000).max(14400000),
    elapsedMs: z.number().int().nonnegative(),
    status: z.enum(["completed", "interrupted"]),
    taskDone: z.boolean(),
    source: z.enum(["extension", "mobile"]).optional(),
    note: z.string().trim().max(500).optional(),
    decisions: z.array(decisionSchema).max(200).optional(),
    interruption: z
      .enum(["worker-restart", "checkpoint-gap", "clock-backwards"])
      .optional(),
    rules: settingsSchema,
    intervals: z.array(intervalSchema).max(20000),
    exceptions: z.array(exceptionSchema).max(200),
    warnings: z
      .array(z.object({ at: z.number().int(), kind: z.literal("budget") }))
      .max(1),
  })
  .superRefine((s, ctx) => {
    const issue = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    if (
      s.endedAt < s.startedAt ||
      s.elapsedMs > s.plannedMs ||
      s.elapsedMs > s.endedAt - s.startedAt
    )
      issue("Некорректная длительность");
    let last = s.startedAt,
      total = 0;
    for (const i of s.intervals) {
      if (i.start < last || i.end <= i.start || i.end > s.endedAt)
        issue("Пересекающиеся или некорректные интервалы");
      last = i.end;
      total += i.end - i.start;
      const expected =
        s.rules.domains.some((d) => matches(i.domain, d)) &&
        !s.exceptions.some((e) => exceptionApplies(e, i.domain, i.start));
      if (
        i.distracting !== expected ||
        s.exceptions.some(
          (e) =>
            matches(i.domain, e.domain) &&
            ((e.at > i.start && e.at < i.end) ||
              (e.expiresAt !== undefined &&
                e.expiresAt > i.start &&
                e.expiresAt < i.end)),
        )
      )
        issue("Интервал не соответствует снимку правил");
    }
    if (total > s.elapsedMs) issue("Время сайтов превышает время сессии");
    if (s.exceptions.some((e) => e.at < s.startedAt || e.at > s.endedAt))
      issue("Исключение вне сессии");
    if (s.warnings.some((w) => w.at < s.startedAt || w.at > s.endedAt))
      issue("Предупреждение вне сессии");
    if (
      s.exceptions.some(
        (e) =>
          e.expiresAt !== undefined &&
          (e.expiresAt <= e.at ||
            e.expiresAt > s.endedAt + (s.plannedMs - s.elapsedMs)),
      )
    )
      issue("Некорректный срок исключения");
    if (s.decisions?.some((e) => e.at < s.startedAt || e.at > s.endedAt))
      issue("Решение вне сессии");
    if (
      s.source === "mobile" &&
      (s.intervals.length ||
        s.exceptions.length ||
        s.warnings.length ||
        s.decisions?.length)
    )
      issue("Мобильный таймер не измеряет сайты");
  });
export type Session = z.infer<typeof sessionSchema>;
export type Interval = z.infer<typeof intervalSchema>;
export const historySchema = z
  .object({
    from: z.number().int(),
    to: z.number().int(),
    complete: z.boolean(),
    domains: z
      .array(
        z.object({
          domain,
          visits: z.number().int().nonnegative().max(1000000),
        }),
      )
      .max(1000),
  })
  .refine(
    (s) => s.to > s.from && s.to - s.from <= 7 * 86400000,
    "Период не больше 7 дней",
  );
export type HistorySnapshot = z.infer<typeof historySchema>;
export function totals(s: Pick<Session, "intervals" | "rules">) {
  const trackedMs = s.intervals.reduce((a, i) => a + i.end - i.start, 0);
  const distractedMs = s.intervals
    .filter((i) => i.distracting)
    .reduce((a, i) => a + i.end - i.start, 0);
  return {
    trackedMs,
    distractedMs,
    overBudgetMs: Math.max(0, distractedMs - s.rules.budgetMs),
  };
}
export function dayKey(t: number, tz: string) {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(t);
  return ["year", "month", "day"]
    .map((k) => p.find((x) => x.type === k)!.value)
    .join("-");
}
// Find each local midnight by binary search: also works on 23/25-hour DST days.
export function splitDays(
  i: Interval,
  tz: string,
): Array<{ day: string; ms: number; distracting: boolean }> {
  const out = [];
  let at = i.start;
  while (at < i.end) {
    const day = dayKey(at, tz);
    let end = i.end;
    if (dayKey(i.end - 1, tz) !== day) {
      let lo = at + 1,
        hi = i.end;
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (dayKey(mid, tz) === day) lo = mid + 1;
        else hi = mid;
      }
      end = lo;
    }
    out.push({ day, ms: end - at, distracting: i.distracting });
    at = end;
  }
  return out;
}
export function countVisits(
  visits: Array<{ visitTime?: number; isLocal?: boolean }>,
  from: number,
  to: number,
) {
  return visits.filter(
    (v) =>
      v.isLocal === true &&
      v.visitTime !== undefined &&
      v.visitTime >= from &&
      v.visitTime < to,
  ).length;
}
export function canUpload(
  item: { ownerId: string; instanceId: string },
  auth: { ownerId: string; instanceId: string } | null,
) {
  return (
    !!auth &&
    item.ownerId === auth.ownerId &&
    item.instanceId === auth.instanceId
  );
}
export interface Active {
  session: Session;
  deadline: number;
  pausedAt: number | null;
  cursor: number;
  host: string | null;
  lastCheckpoint: number;
  taskTabId?: number;
}
export function createActive(
  id: string,
  instanceId: string,
  goal: string,
  plannedMs: number,
  rules: Settings,
  now: number,
): Active {
  return {
    session: {
      clientSessionId: id,
      instanceId,
      goal,
      plannedMs,
      rules: structuredClone(rules),
      startedAt: now,
      endedAt: now,
      elapsedMs: 0,
      status: "completed",
      taskDone: false,
      source: "extension",
      note: "",
      decisions: [],
      intervals: [],
      exceptions: [],
      warnings: [],
    },
    deadline: now + plannedMs,
    pausedAt: null,
    cursor: now,
    host: null,
    lastCheckpoint: now,
  };
}
// One writer calls settle BEFORE changing active host, pause, or exceptions.
export function settle(a: Active, now: number) {
  const end = Math.max(a.cursor, Math.min(now, a.deadline));
  if (a.pausedAt === null) {
    const dt = end - a.cursor;
    a.session.elapsedMs = Math.min(
      a.session.plannedMs,
      a.session.elapsedMs + dt,
    );
    if (a.host && dt > 0) {
      const boundaries = [
        a.cursor,
        ...a.session.exceptions.flatMap((e) =>
          e.expiresAt !== undefined &&
          e.expiresAt > a.cursor &&
          e.expiresAt < end
            ? [e.expiresAt]
            : [],
        ),
        end,
      ].sort((a, b) => a - b);
      for (let n = 0; n < boundaries.length - 1; n++) {
        const start = boundaries[n],
          stop = boundaries[n + 1];
        if (stop <= start) continue;
        const distracting =
          a.session.rules.domains.some((d) => matches(a.host!, d)) &&
          !a.session.exceptions.some((e) =>
            exceptionApplies(e, a.host!, start),
          );
        const last = a.session.intervals.at(-1);
        if (
          last &&
          last.domain === a.host &&
          last.distracting === distracting &&
          last.end === start &&
          !a.session.exceptions.some(
            (e) =>
              matches(a.host!, e.domain) &&
              (e.at === start || e.expiresAt === start),
          )
        )
          last.end = stop;
        else
          a.session.intervals.push({
            start,
            end: stop,
            domain: a.host,
            distracting,
          });
      }
    }
  }
  a.cursor = end;
  a.lastCheckpoint = now;
  a.session.endedAt = end;
  if (
    !a.session.warnings.length &&
    totals(a.session).distractedMs >= a.session.rules.budgetMs
  )
    a.session.warnings.push({ kind: "budget", at: end });
  return a;
}
export function pause(a: Active, now: number) {
  settle(a, now);
  if (a.pausedAt === null) a.pausedAt = now;
  a.host = null;
}
export function resume(a: Active, now: number) {
  if (a.pausedAt !== null) {
    const shift = now - a.pausedAt;
    a.deadline += shift;
    for (const e of a.session.exceptions)
      if (e.until === "session" && e.expiresAt !== undefined)
        e.expiresAt += shift;
    for (const e of a.session.decisions || [])
      if (e.action === "allow-session" && e.expiresAt !== undefined)
        e.expiresAt += shift;
    a.pausedAt = null;
    a.cursor = now;
    a.lastCheckpoint = now;
  }
}
export function except(a: Active, host: string, now: number) {
  decide(a, "allow-session", host, now);
}
export function exceptionApplies(
  e: z.infer<typeof exceptionSchema>,
  host: string,
  at: number,
) {
  return (
    matches(host, e.domain) &&
    e.at <= at &&
    (e.expiresAt === undefined || at < e.expiresAt)
  );
}
export function decide(
  a: Active,
  action: z.infer<typeof decisionSchema>["action"],
  host: string | null,
  now: number,
) {
  settle(a, now);
  const at = Math.min(now, a.deadline);
  if (
    a.pausedAt !== null ||
    at < a.session.startedAt ||
    (a.session.decisions && a.session.decisions.length >= 200)
  )
    return;
  const expiresAt =
    action === "allow5"
      ? Math.min(a.deadline, at + 300000)
      : action === "allow-session"
        ? a.deadline
        : undefined;
  if (expiresAt !== undefined && host && expiresAt > at)
    a.session.exceptions.push({
      domain: host,
      at,
      expiresAt,
      until: action === "allow5" ? "time" : "session",
    });
  (a.session.decisions ??= []).push({
    ...(host ? { domain: host } : {}),
    at,
    kind: a.session.warnings.length ? "budget" : "context",
    action,
    ...(expiresAt !== undefined ? { expiresAt } : {}),
  });
}
export function coach(s: Session) {
  const t = totals(s);
  if (s.source === "mobile")
    return {
      mode: "Анализ по правилам",
      text: "Это самостоятельный таймер: время других приложений не измеряется.",
      next: "Выберите одну конкретную цель для следующей сессии.",
    };
  const domains: Record<string, number> = {};
  for (const i of s.intervals)
    if (i.distracting)
      domains[i.domain] = (domains[i.domain] || 0) + i.end - i.start;
  const top = Object.entries(domains).sort((a, b) => b[1] - a[1])[0];
  return {
    mode: "Анализ по правилам",
    text: top
      ? `Больше всего учтённого отвлекающего времени: ${top[0]} (${Math.round(top[1] / 1000)} сек). ${t.overBudgetMs ? `Бюджет превышен на ${Math.round(t.overBudgetMs / 1000)} сек.` : "Вы остались в выбранном бюджете."}`
      : "Учтённых интервалов отвлекающих сайтов нет.",
    next: top
      ? "Перед следующей сессией решите, нужен ли этот домен для цели."
      : "Сохраните понятную цель и проверьте, подходят ли выбранные сайты.",
  };
}
export const templates = [
  {
    id: "code",
    name: "Программирование",
    goal: "Реализовать и проверить одну функцию",
    minutes: 45,
  },
  {
    id: "exam",
    name: "Экзамен",
    goal: "Решить один блок заданий",
    minutes: 25,
  },
  {
    id: "language",
    name: "Язык",
    goal: "Разобрать текст и выписать новые слова",
    minutes: 20,
  },
  {
    id: "read",
    name: "Чтение",
    goal: "Прочитать и законспектировать одну главу",
    minutes: 25,
  },
  {
    id: "lecture",
    name: "Лекция",
    goal: "Посмотреть лекцию и записать три вывода",
    minutes: 40,
  },
  { id: "custom", name: "Своя задача", goal: "", minutes: 25 },
];
