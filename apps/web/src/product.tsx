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
  type Active,
  type Session,
} from "@nazar/shared";
import type { Settings } from "@nazar/shared";
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
                label: "Предупреждение бюджета",
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
};
export function MobileTimer({
  ownerId,
  settings,
  upload,
  onSaved,
}: {
  ownerId: string;
  settings: Settings;
  upload: (s: Session) => Promise<void>;
  onSaved: () => void;
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
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  function save(next: StoredMobile) {
    localStorage.setItem(key, JSON.stringify(next));
    setData(next);
  }
  function finish() {
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
  const a = data.active;
  return (
    <section className="mobile-timer">
      <p className="eyebrow">МОБИЛЬНЫЙ ТАЙМЕР · САМООТМЕТКА</p>
      <h1>Одна цель за раз.</h1>
      <p>
        Этот режим не видит чужие вкладки и приложения. Для учёта сайтов
        используйте Nazar в Chrome на компьютере.
      </p>
      {a ? (
        <div className="panel">
          <h2>{a.session.goal}</h2>
          <div className="mobile-clock">
            {time(a.deadline - (a.pausedAt ?? now))}
          </div>
          <p>{a.pausedAt ? "На паузе" : "До конца самостоятельной сессии"}</p>
          <div className="form-grid">
            <button
              className="secondary"
              onClick={() => {
                const next = structuredClone(data);
                if (next.active!.pausedAt === null)
                  pause(next.active!, Date.now());
                else resume(next.active!, Date.now());
                save(next);
              }}
            >
              {a.pausedAt ? "Продолжить" : "Пауза"}
            </button>
            <button onClick={finish}>Завершить</button>
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
          onSubmit={(e) => {
            e.preventDefault();
            if (!goal.trim()) return;
            const active = createActive(
              crypto.randomUUID(),
              crypto.randomUUID(),
              goal.trim(),
              minutes * 60000,
              settings,
              Date.now(),
            );
            active.session.source = "mobile";
            save({ ...data, active });
          }}
        >
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
            Правила сайтов для таймера не применяются. На компьютере подтвердите
            список и бюджет перед стартом.
          </p>
          <button>Начать самостоятельную сессию →</button>
        </form>
      )}
      <div className="panel">
        <h3>Синхронизация</h3>
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
      <a className="button secondary" href="#overview">
        Вернуться в Nazar
      </a>
    </main>
  );
}
