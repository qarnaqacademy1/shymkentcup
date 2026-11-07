import React, { useEffect, useState } from "react";
import {
  createActive,
  settle,
  pause,
  resume,
  sessionSchema,
  templates,
  coach,
  defaults,
  decide,
  dayKey,
  type Active,
  type Session,
} from "@nazar/shared";
import type { Settings } from "@nazar/shared";
import { Donut } from "./nazar4";
import { extensionRequest, type ExtensionState } from "./extensionBridge";
const time = (ms: number) =>
  `${Math.floor(Math.max(0, ms) / 60000)
    .toString()
    .padStart(
      2,
      "0",
    )}:${(Math.floor(Math.max(0, ms) / 1000) % 60).toString().padStart(2, "0")}`;
const labels: Record<string, string> = {
  return: "Вернуться к задаче",
  allow5: "Разрешить на 5 минут",
  "allow-session": "Нужен до конца сессии",
  details: "Подробнее",
  "focus-delay": "Осознанная пауза · 15 секунд",
  "chat-pass": "Chat Pass · до 10 минут",
};
export function AttentionMap({
  session: s,
  demo = false,
}: {
  session: Session;
  demo?: boolean;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [eventText, setEventText] = useState("");
  const wall = Math.max(1, s.endedAt - s.startedAt);
  const segments: Array<{
    start: number;
    end: number;
    domain?: string;
    distracting?: boolean;
  }> = [];
  let cursor = s.startedAt;
  for (const i of s.intervals) {
    if (i.start > cursor) segments.push({ start: cursor, end: i.start });
    segments.push(i);
    cursor = i.end;
  }
  if (cursor < s.endedAt) segments.push({ start: cursor, end: s.endedAt });
  const selectedSegment = selected === null ? null : segments[selected];
  const analysis = coach(s);
  return (
    <section className="attention-map">
      <h3>
        {s.source === "mobile" ? "Самостоятельная сессия" : "Attention Map"}
      </h3>
      <p className="muted">
        {demo
          ? "Контрольные интервалы для демонстрации, не измерение Chrome."
          : s.source === "mobile"
            ? "Источник: мобильный таймер. Сайты не измерялись."
            : "Источник: расширение Chrome. Нажмите интервал, чтобы увидеть данные."}
      </p>
      {s.source !== "mobile" && (
        <>
          <div
            className="timeline"
            role="group"
            aria-label="Временная карта сессии"
          >
            {segments.map((i, n) => (
              <button
                key={n}
                aria-label={`${i.domain || "Без измерения сайта"}: ${time(i.end - i.start)}`}
                aria-pressed={selected === n}
                className={
                  !i.domain ? "gap" : i.distracting ? "distracting" : "measured"
                }
                style={{
                  flexGrow: Math.max(0.2, ((i.end - i.start) / wall) * 100),
                }}
                onClick={() => setSelected(n)}
              />
            ))}
          </div>
          <div className="timeline-events" aria-label="События сессии">
            {[
              ...s.warnings.map((w) => ({
                at: w.at,
                label:
                  w.kind === "site-limit"
                    ? "Лимит сайта: " + w.domain
                    : "Предупреждение бюджета",
              })),
              ...(s.decisions || []).map((d) => ({
                at: d.at,
                label: labels[d.action],
              })),
            ]
              .sort((a, b) => a.at - b.at)
              .map((e, n) => (
                <button
                  key={n}
                  aria-label={`${e.label} · ${new Date(e.at).toLocaleTimeString("ru", { timeZone: s.rules.timezone })}`}
                  style={{
                    left:
                      Math.max(
                        0,
                        Math.min(97, ((e.at - s.startedAt) / wall) * 100),
                      ) + "%",
                  }}
                  onClick={() =>
                    setEventText(
                      e.label +
                        " · " +
                        new Date(e.at).toLocaleTimeString("ru", {
                          timeZone: s.rules.timezone,
                        }),
                    )
                  }
                >
                  ●
                </button>
              ))}
          </div>
          {eventText && <p className="selected-segment">{eventText}</p>}
          <p className="legend">
            Зелёный — другие сайты · песочный — отвлекающие · серый — без
            измерения сайта
          </p>
          {selectedSegment && (
            <p className="selected-segment">
              {selectedSegment.domain ||
                "Нет интервала сайта. Причина для этого периода не записана."}{" "}
              ·{" "}
              {new Date(selectedSegment.start).toLocaleTimeString("ru", {
                timeZone: s.rules.timezone,
              })}{" "}
              —{" "}
              {new Date(selectedSegment.end).toLocaleTimeString("ru", {
                timeZone: s.rules.timezone,
              })}{" "}
              · {time(selectedSegment.end - selectedSegment.start)}
            </p>
          )}
        </>
      )}
      <details>
        <summary>Как читать эти числа</summary>
        <p>
          План: {time(s.plannedMs)}. По часам от старта до подтверждённого
          конца: {time(wall)}. Длительность без пауз: {time(s.elapsedMs)}. Время
          сайтов — сумма подтверждённых интервалов. Пустые участки не доказывают
          отвлечение: причина не восстанавливается задним числом.
        </p>
        {s.interruption && (
          <p>
            Зафиксировано прерывание:{" "}
            {
              {
                "worker-restart": "новый запуск фонового процесса",
                "checkpoint-gap":
                  "разрыв между контрольными точками более 45 секунд",
                "clock-backwards": "перевод часов назад",
              }[s.interruption]
            }
            . Неподтверждённый разрыв не начислен сайту.
          </p>
        )}
      </details>
      {s.source !== "mobile" && (
        <>
          <h3>Decision Journal</h3>
          {s.decisions?.length ? (
            <ol className="journal">
              {s.decisions.map((d, n) => (
                <li key={n}>
                  <b>{labels[d.action]}</b> · {d.domain || "сайт не выбран"}
                  <small>
                    {new Date(d.at).toLocaleString("ru", {
                      timeZone: s.rules.timezone,
                    })}{" "}
                    ·{" "}
                    {d.kind === "budget"
                      ? "предупреждение бюджета"
                      : "контекстное решение"}
                    {d.expiresAt
                      ? " · до " +
                        new Date(d.expiresAt).toLocaleTimeString("ru", {
                          timeZone: s.rules.timezone,
                        })
                      : ""}
                  </small>
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted">
              В этой записи нет журнала решений. Старые события не
              реконструируются.
            </p>
          )}
        </>
      )}
      {s.note && <blockquote className="reflection">{s.note}</blockquote>}
      <div className="coach">
        <small>{analysis.mode}</small>
        <p>{analysis.text}</p>
        <b>{analysis.next}</b>
      </div>
      <button className="secondary no-print" onClick={() => window.print()}>
        Печать / сохранить отчёт PDF
      </button>
    </section>
  );
}
type StoredMobile = {
  ownerId: string;
  active: Active | null;
  queue: Session[];
  pendingPlan?: { id: string; goal: string; plannedMs: number; day: string };
};
export function MobileTimer({
  ownerId,
  settings,
  upload,
  onSaved,
  reserve,
  getBudget,
}: {
  ownerId: string;
  settings: Settings;
  upload: (s: Session) => Promise<void>;
  onSaved: () => void;
  reserve: (plan: {
    id: string;
    goal: string;
    plannedMs: number;
  }) => Promise<{ remainingMs: number; plannedMs: number }>;
  getBudget: () => Promise<{ remainingMs: number; plannedMs: number }>;
}) {
  const key = "nazar-mobile-v1:" + ownerId;
  const [data, setData] = useState<StoredMobile>(() => {
    try {
      const d = JSON.parse(localStorage.getItem(key) || "null");
      if (d?.ownerId === ownerId && Array.isArray(d.queue)) return d;
    } catch {}
    return { ownerId, active: null, queue: [] };
  });
  const [now, setNow] = useState(Date.now()),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [template, setTemplate] = useState("custom");
  const [goal, setGoal] = useState(""),
    [minutes, setMinutes] = useState(25),
    [note, setNote] = useState(""),
    [done, setDone] = useState(false);
  const [budget, setBudget] = useState<{
    remainingMs: number;
    plannedMs: number;
  } | null>(null);
  const [extension, setExtension] = useState<ExtensionState | null>(null),
    [extensionMode, setExtensionMode] = useState(false),
    [checkingExtension, setCheckingExtension] = useState(true),
    [bridgeInfo, setBridgeInfo] = useState("");
  useEffect(() => {
    let live = true;
    extensionRequest(ownerId, "state")
      .then((s) => {
        if (live) {
          setExtension(s);
          setExtensionMode(!data.active);
          setBridgeInfo("Расширение подключено к этому аккаунту.");
        }
      })
      .catch((e) => {
        if (live) setBridgeInfo(e.message);
      })
      .finally(() => {
        if (live) setCheckingExtension(false);
      });
    return () => {
      live = false;
    };
  }, [ownerId]);
  useEffect(() => {
    if (!extensionMode || busy) return;
    let live = true;
    const id = setInterval(() => {
      extensionRequest(ownerId, "state")
        .then((s) => {
          if (live) setExtension(s);
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    }, 2000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [ownerId, extensionMode, busy]);
  async function extensionAction(type: string, body: object = {}) {
    setBusy(true);
    setError("");
    try {
      setExtension(await extensionRequest(ownerId, type, body));
      setBudget(await getBudget());
      onSaved();
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    let live = true;
    getBudget()
      .then((b) => {
        if (live) setBudget(b);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  function save(next: StoredMobile) {
    localStorage.setItem(key, JSON.stringify(next));
    setData(next);
  }
  function finish() {
    if (extensionMode) {
      void extensionAction("finish", { done, note }).then((saved) => {
        if (saved) {
          setDone(false);
          setNote("");
        }
      });
      return;
    }
    if (!data.active) return;
    const a = structuredClone(data.active);
    settle(a, Date.now());
    a.session.note = note.slice(0, 500);
    a.session.taskDone = done;
    save({
      ...data,
      active: null,
      queue: [...data.queue, sessionSchema.parse(a.session)],
    });
    setNote("");
    setDone(false);
  }
  useEffect(() => {
    if (
      !extensionMode &&
      data.active &&
      data.active.pausedAt === null &&
      now >= data.active.deadline
    )
      finish();
  }, [now]);
  async function sync() {
    setBusy(true);
    setError("");
    let current = data;
    try {
      if (current.ownerId !== ownerId) throw Error("Другая учётная запись");
      for (const s of [...current.queue]) {
        await upload(s);
        current = {
          ...current,
          queue: current.queue.filter(
            (q) => q.clientSessionId !== s.clientSessionId,
          ),
        };
        save(current);
      }
      onSaved();
    } catch (e: any) {
      setError(
        e.message +
          " Результат остаётся на этом устройстве для этого аккаунта.",
      );
    } finally {
      setBusy(false);
    }
  }
  const a = extensionMode ? extension?.active : data.active;
  return (
    <section className="mobile-timer">
      <p className="eyebrow">NAZAR 4.0 · SMART START</p>
      <h1>Сколько времени вы планируете сегодня заниматься?</h1>
      <p>
        {extensionMode
          ? "Сессия работает в Chrome-расширении: оно учитывает активную вкладку и применяет правила сайтов, даже когда эта страница закрыта."
          : "Самостоятельный таймер не видит чужие вкладки и приложения. Для измерений откройте сайт в Chrome с подключённым расширением Nazar."}
      </p>
      <p className="v4-status">
        {checkingExtension ? "Проверяем расширение…" : bridgeInfo}
      </p>
      {extension && (
        <label>
          Режим сессии
          <select
            disabled={!!a || !!data.active || !!extension.active || busy}
            value={extensionMode ? "extension" : "mobile"}
            onChange={(e) => setExtensionMode(e.target.value === "extension")}
          >
            <option value="extension">Chrome · с учётом сайтов</option>
            <option value="mobile">Самостоятельный таймер</option>
          </select>
        </label>
      )}
      <p className="smart-budget">
        {budget
          ? `Запланировано сегодня: ${time(budget.plannedMs)}. Осталось: ${time(budget.remainingMs)} из 4 часов.`
          : "Проверяем суточный лимит…"}{" "}
        День планирования: Asia/Qyzylorda. Для нового старта нужна связь с
        сервером.
      </p>
      {a ? (
        <div className="panel">
          <h2>{a.session.goal}</h2>
          <div className="mobile-clock">
            {time(a.deadline - (a.pausedAt ?? now))}
          </div>
          <p>
            {a.pausedAt
              ? "На паузе"
              : extensionMode
                ? "До конца Chrome-сессии"
                : "До конца самостоятельной сессии"}
          </p>
          <div className="form-grid">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => {
                if (extensionMode) {
                  void extensionAction(
                    a.pausedAt === null ? "pause" : "resume",
                  );
                  return;
                }
                const next = structuredClone(data);
                if (next.active!.pausedAt === null)
                  pause(next.active!, Date.now());
                else resume(next.active!, Date.now());
                save(next);
              }}
            >
              {a.pausedAt ? "Продолжить" : "Пауза"}
            </button>
            <button disabled={busy} onClick={finish}>
              Завершить
            </button>
          </div>
          <label>
            <input
              type="checkbox"
              checked={done}
              onChange={(e) => setDone(e.target.checked)}
            />{" "}
            Задача выполнена
          </label>
          <label>
            Короткая заметка
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
            />
          </label>
        </div>
      ) : (
        <form
          className="panel"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!goal.trim() || busy) return;
            setBusy(true);
            setError("");
            try {
              if (
                !Number.isFinite(minutes) ||
                minutes < 1 / 60 ||
                minutes > 240
              )
                throw Error("Выберите от 1 секунды до 240 минут");
              const plannedMs = Math.round(minutes * 60000);
              if (extensionMode) {
                setExtension(
                  await extensionRequest(ownerId, "start", {
                    goal: goal.trim(),
                    minutes,
                  }),
                );
                setBudget(await getBudget());
                return;
              }
              const pending = data.pendingPlan;
              const day = dayKey(Date.now(), "Asia/Qyzylorda");
              const plan =
                pending?.goal === goal.trim() &&
                pending.plannedMs === plannedMs &&
                pending.day === day
                  ? pending
                  : {
                      id: crypto.randomUUID(),
                      goal: goal.trim(),
                      plannedMs,
                      day,
                    };
              save({ ...data, pendingPlan: plan });
              const b = await reserve(plan);
              setBudget(b);
              const active = createActive(
                plan.id,
                crypto.randomUUID(),
                goal.trim(),
                plannedMs,
                settings,
                Date.now(),
              );
              active.session.source = "mobile";
              save({ ...data, pendingPlan: undefined, active });
            } catch (e: any) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div
            className="smart-presets"
            role="group"
            aria-label="Выбрать длительность"
          >
            {[5, 15, 30, 60, 120].map((m) => (
              <button
                key={m}
                type="button"
                className="secondary"
                aria-pressed={minutes === m}
                onClick={() => setMinutes(m)}
              >
                {m} мин
              </button>
            ))}
          </div>
          <label>
            Шаблон
            <select
              value={template}
              onChange={(e) => {
                const t = templates.find((t) => t.id === e.target.value)!;
                setTemplate(t.id);
                setGoal(t.goal);
                setMinutes(t.minutes);
              }}
            >
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Цель
            <input
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              maxLength={200}
              required
            />
          </label>
          <label>
            Длительность, минуты
            <input
              type="number"
              min="1"
              max="240"
              required
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
            />
          </label>
          <p className="muted">
            {extensionMode
              ? `Правила аккаунта применятся после синхронизации. Общий бюджет: ${time(settings.budgetMs)}.`
              : "Правила сайтов для самостоятельного таймера не применяются."}
          </p>
          <button disabled={busy || checkingExtension}>
            {busy
              ? "Проверяем план…"
              : extensionMode
                ? "Начать Chrome-сессию →"
                : "Начать самостоятельную сессию →"}
          </button>
        </form>
      )}
      <div className="panel">
        <h3>Синхронизация</h3>
        {extensionMode && (
          <>
            <p>
              Chrome: {extension?.syncStatus}. В очереди:{" "}
              {extension?.queueCount ?? 0}.
            </p>
            <button
              disabled={busy}
              onClick={() => void extensionAction("sync")}
            >
              Синхронизировать расширение
            </button>
          </>
        )}
        <p>
          {data.queue.length
            ? `Сохранено на устройстве: ${data.queue.length}`
            : "Нет ожидающих результатов"}
        </p>
        <button
          disabled={busy || !data.queue.length}
          onClick={() => void sync()}
        >
          {busy ? "Отправляем…" : "Синхронизировать с аккаунтом"}
        </button>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <p className="muted">
          Очередь привязана к этому аккаунту. После входа в другой аккаунт эти
          результаты не отправляются.
        </p>
      </div>
    </section>
  );
}
export function InstallPwa() {
  const [prompt, setPrompt] = useState<any>(null),
    [help, setHelp] = useState(false),
    [installed, setInstalled] = useState(
      () => matchMedia("(display-mode: standalone)").matches,
    );
  useEffect(() => {
    const before = (e: Event) => {
      e.preventDefault();
      setPrompt(e);
    };
    const installed = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", before);
    window.addEventListener("appinstalled", installed);
    return () => {
      window.removeEventListener("beforeinstallprompt", before);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);
  return (
    <section className="pwa-install no-print">
      <button
        className="secondary"
        disabled={installed}
        onClick={async () => {
          if (prompt) {
            await prompt.prompt();
            setPrompt(null);
          } else setHelp((v) => !v);
        }}
      >
        {installed ? "Nazar установлен" : "Установить Nazar ↗"}
      </button>
      {help && (
        <p>
          Android: меню Chrome → «Установить приложение» / «Добавить на главный
          экран». iPhone: откройте Nazar в Safari → «Поделиться» → «На экран
          Домой». Автоматическое окно установки доступно только когда его
          предлагает браузер.
        </p>
      )}
    </section>
  );
}
export function WeeklyProgress({
  target,
  fetchCount,
}: {
  target: number;
  fetchCount: () => Promise<number>;
}) {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    fetchCount()
      .then((n) => {
        if (live) setCount(n);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [target]);
  if (!target) return null;
  return (
    <section className="weekly-progress">
      <h3>Личная цель на 7 дней</h3>
      <p>
        {count === null
          ? "Загружаем прогресс…"
          : `${count} из ${target} завершённых сессий`}
      </p>
      {count !== null && (
        <progress max={target} value={Math.min(target, count)} />
      )}
      <small>
        Добровольный ориентир. Без рейтингов и обязательных ежедневных серий.
      </small>
    </section>
  );
}
export function DemoMap() {
  const start = Date.parse("2026-11-07T03:00:00Z");
  const a = createActive(
    "00000000-0000-4000-8000-000000000031",
    "00000000-0000-4000-8000-000000000032",
    "Разобрать учебную лекцию",
    600000,
    { ...defaults, domains: ["youtube.com"], budgetMs: 30000 },
    start,
  );
  a.host = "youtube.com";
  decide(a, "allow5", "youtube.com", start + 40000);
  settle(a, start + 360000);
  decide(a, "allow-session", "youtube.com", start + 360000);
  settle(a, start + 400000);
  a.host = "docs.google.com";
  settle(a, start + 600000);
  a.session.note =
    "Контрольный пример для объяснения карты; не реальное измерение и не личная статистика.";
  return (
    <main className="demo-page">
      <p className="eyebrow">ОТДЕЛЬНЫЙ ДЕМОНСТРАЦИОННЫЙ РЕЖИМ</p>
      <h1>Nazar Decision → Attention Map</h1>
      <p className="warning-demo">
        Контрольный пример с заданными временными метками. Это не результат
        пользователя. Ничего не сохраняется в аккаунт и не попадает в
        статистику.
      </p>
      <AttentionMap session={a.session} demo />
      <section className="panel">
        <h2>Donut Analytics · контрольный пример</h2>
        <Donut intervals={a.session.intervals} settings={a.session.rules} />
      </section>
      <a className="button secondary" href="#overview">
        Вернуться в Nazar
      </a>
    </main>
  );
}
