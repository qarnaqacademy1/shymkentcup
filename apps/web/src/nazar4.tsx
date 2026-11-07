import React, { useEffect, useState } from "react";
import {
  dayKey,
  domainBreakdown,
  domainOf,
  siteLimit,
  splitDays,
  type Session,
  type Settings,
  type dailyReport,
} from "@nazar/shared";
import "./nazar4.css";
type Api = <T = any>(
  path: string,
  method?: string,
  body?: unknown,
) => Promise<T>;
const duration = (ms: number) =>
  `${Math.floor(ms / 60000)} мин ${Math.floor(ms / 1000) % 60} сек`;
const colors = [
  "#286447",
  "#d2aa61",
  "#688fbb",
  "#b27892",
  "#8a89bc",
  "#88a886",
  "#c18161",
  "#879590",
];

export function Donut({
  intervals,
  settings,
}: {
  intervals: Session["intervals"];
  settings?: Settings;
}) {
  const rows = domainBreakdown(intervals);
  const total = rows.reduce((n, r) => n + r.ms, 0);
  const [selected, setSelected] = useState<string | null>(null);
  let offset = 0;
  const chosen = rows.find((r) => r.domain === selected);
  return (
    <div className="donut-layout">
      <div className="donut-wrap">
        <svg
          className="donut-svg"
          viewBox="0 0 240 240"
          aria-label="Учтённое время по сайтам"
        >
          <circle
            cx="120"
            cy="120"
            r="88"
            fill="none"
            stroke="#e7ece4"
            strokeWidth="27"
          />
          {rows.map((r, n) => {
            const size = (r.ms / total) * 100;
            const start = offset;
            offset += size;
            return (
              <circle
                key={r.domain}
                cx="120"
                cy="120"
                r="88"
                fill="none"
                stroke={colors[n]}
                strokeWidth={selected === r.domain ? 33 : 27}
                pathLength="100"
                strokeDasharray={`${size} ${100 - size}`}
                strokeDashoffset={-start}
                transform="rotate(-90 120 120)"
                role="button"
                tabIndex={0}
                aria-label={`${r.domain}, ${duration(r.ms)}, ${size.toFixed(1)}%`}
                onClick={() => setSelected(r.domain)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelected(r.domain);
                  }
                }}
              >
                <title>
                  {r.domain}: {duration(r.ms)}
                </title>
              </circle>
            );
          })}
        </svg>
        <div className="donut-center">
          <strong>{Math.floor(total / 60000)}</strong>
          <span>минут учтено</span>
        </div>
      </div>
      <div className="donut-legend">
        {!total ? (
          <p className="muted">
            Пока нет измерений сайтов. Завершите сессию с расширением Chrome.
            Мобильный таймер не создаёт эти данные.
          </p>
        ) : (
          rows.map((r, n) => (
            <button
              type="button"
              key={r.domain}
              className="donut-row"
              aria-pressed={selected === r.domain}
              onClick={() => setSelected(r.domain)}
            >
              <i style={{ background: colors[n] }} />
              <span>{r.domain}</span>
              <b>{duration(r.ms)}</b>
            </button>
          ))
        )}
        {chosen && (
          <p className="selected-segment" role="status">
            {chosen.domain} · {duration(chosen.ms)} ·{" "}
            {((chosen.ms / total) * 100).toFixed(1)}%
            {settings && chosen.domain !== "Другие"
              ? ` · Лимит: ${siteLimit(settings, chosen.domain)?.limitMs === 0 ? "полный запрет" : siteLimit(settings, chosen.domain) ? duration(siteLimit(settings, chosen.domain)!.limitMs) : "общий бюджет " + duration(settings.budgetMs)}`
              : ""}
          </p>
        )}
      </div>
    </div>
  );
}

export function Analytics({ api, settings }: { api: Api; settings: Settings }) {
  const [period, setPeriod] = useState("today"),
    [sessions, setSessions] = useState<Session[]>([]),
    [selected, setSelected] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    setLoading(true);
    const now = Date.now();
    api<Session[]>(`/analytics?from=${now - 31 * 86400000}&to=${now + 1}`)
      .then((s) => {
        if (live) {
          setSessions(s);
          setError("");
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [api]);
  const now = Date.now(),
    today = dayKey(now, settings.timezone);
  const from = now - (period === "week" ? 7 : 30) * 86400000;
  const intervals =
    period === "session"
      ? (sessions.find((s) => s.clientSessionId === selected)?.intervals ?? [])
      : sessions.flatMap((s) =>
          s.intervals.flatMap((i) => {
            if (period === "today") {
              let cursor = i.start;
              return splitDays(i, settings.timezone).flatMap((p) => {
                const start = cursor;
                cursor += p.ms;
                return p.day === today ? [{ ...i, start, end: cursor }] : [];
              });
            }
            return i.end > from
              ? [{ ...i, start: Math.max(i.start, from) }]
              : [];
          }),
        );
  return (
    <section className="panel">
      <div className="v4-heading">
        <div>
          <p className="eyebrow">DONUT ANALYTICS</p>
          <h2>Куда ушло цифровое время</h2>
        </div>
        <select
          aria-label="Период аналитики"
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
        >
          <option value="today">Сегодня</option>
          <option value="week">7 дней</option>
          <option value="month">30 дней</option>
          <option value="session">Отдельная сессия</option>
        </select>
      </div>
      {period === "session" && (
        <label>
          Учебная сессия
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">Выберите сессию</option>
            {sessions.map((s) => (
              <option key={s.clientSessionId} value={s.clientSessionId}>
                {s.goal} ·{" "}
                {new Date(s.startedAt).toLocaleDateString("ru", {
                  timeZone: settings.timezone,
                })}
              </option>
            ))}
          </select>
        </label>
      )}
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : loading ? (
        <p>Загружаем измерения…</p>
      ) : (
        <Donut
          key={period + selected}
          intervals={intervals}
          settings={
            period === "session"
              ? sessions.find((s) => s.clientSessionId === selected)?.rules
              : settings
          }
        />
      )}
      <small className="muted">
        Только подтверждённые интервалы Chrome. Лимиты действуют в учебной
        сессии; полный запрет — пока расширение подключено. {settings.timezone}.
      </small>
    </section>
  );
}

type Daily = ReturnType<typeof dailyReport> & {
  reservedMs: number;
  planningTimezone: string;
};
export function DailyReport({
  api,
  settings,
}: {
  api: Api;
  settings: Settings;
}) {
  const [day, setDay] = useState(() => dayKey(Date.now(), settings.timezone)),
    [report, setReport] = useState<Daily | null>(null),
    [previous, setPrevious] = useState<Daily | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setReport(null);
    setPrevious(null);
    setError("");
    const prev = new Date(Date.parse(day + "T12:00:00Z") - 86400000)
      .toISOString()
      .slice(0, 10);
    Promise.all([
      api<Daily>("/reports/daily?day=" + day),
      api<Daily>("/reports/daily?day=" + prev),
    ])
      .then(([r, p]) => {
        if (live) {
          setReport(r);
          setPrevious(p);
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [day, api]);
  const download = () => {
    if (!report) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `nazar-report-${day}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <>
      <p className="eyebrow">NAZAR DAILY REPORT</p>
      <h1>Ваш день в цифрах.</h1>
      <div className="v4-toolbar">
        <label>
          День отчёта
          <input
            type="date"
            value={day}
            max={dayKey(Date.now(), settings.timezone)}
            onChange={(e) => {
              if (e.target.value) setDay(e.target.value);
            }}
          />
        </label>
        <button className="secondary" disabled={!report} onClick={download}>
          Сохранить JSON
        </button>
        <button className="secondary" onClick={() => window.print()}>
          Печать / PDF
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {report ? (
        <>
          <div className="v4-metrics">
            {[
              ["Зарезервировано сегодня", duration(report.reservedMs)],
              ["План сохранённых сессий", duration(report.plannedMs)],
              ["Длительность завершённых записей", duration(report.elapsedMs)],
              ["Учтено на сайтах", duration(report.trackedMs)],
              ["Отвлекающие сайты", duration(report.distractedMs)],
              [
                "В пределах лимитов",
                `${report.withinBudget} / ${report.extensionSessions}`,
              ],
              ["Предупреждения", report.warnings],
              ["Chat Pass", report.chatPasses],
              ["Завершённые сессии", report.completed],
              ["Задача выполнена · самооценка", report.taskDone],
            ].map(([label, value]) => (
              <div className="panel" key={label}>
                <small>{label}</small>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          {previous && (
            <section className="panel">
              <h2>Сравнение с {previous.day}</h2>
              <p>
                Сайты: {duration(previous.trackedMs)} →{" "}
                {duration(report.trackedMs)}. Учебные сессии:{" "}
                {duration(previous.elapsedMs)} → {duration(report.elapsedMs)}.
                Завершено: {previous.completed} → {report.completed}.
              </p>
              <small className="muted">
                Нулевые значения могут означать отсутствие измерений.
              </small>
            </section>
          )}
          <section className="panel">
            <h2>Учтённые сайты</h2>
            {report.domains.length ? (
              report.domains.map((r) => (
                <p className="report-domain" key={r.domain}>
                  <b>{r.domain}</b>
                  <span>{duration(r.ms)}</span>
                </p>
              ))
            ) : (
              <p className="muted">В этот день нет измерений сайтов.</p>
            )}
          </section>
          <p className="muted">
            Сравните дни с помощью выбора даты. Сайты делятся точно по полуночи
            в {report.timezone}. План относится к дню старта, длительность без
            пауз — целиком ко дню завершения записи. Суточные резервы считаются
            в {report.planningTimezone}; незавершённые планы также расходуют
            лимит. Мобильные приложения не измеряются.
          </p>
        </>
      ) : (
        !error && <p>Готовим отчёт…</p>
      )}
    </>
  );
}

export function Assistant({ api }: { api: Api }) {
  const [goal, setGoal] = useState(""),
    [useAI, setUseAI] = useState(false),
    [busy, setBusy] = useState(false),
    [answer, setAnswer] = useState<{
      label: string;
      text: string;
      reason: string;
    } | null>(null),
    [error, setError] = useState("");
  return (
    <section className="panel assistant">
      <p className="eyebrow">NAZAR AI</p>
      <h2>Подготовим следующее занятие.</h2>
      <p>
        План, привычки и рекомендации по доступной истории за 7 дней. Настройки
        меняете только вы.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            setAnswer(await api("/assistant", "POST", { goal, useAI }));
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Чему хотите посвятить время?
          <textarea
            maxLength={500}
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="Мне нужно подготовиться к экзамену по физике"
          />
        </label>
        <label className="ai-consent">
          <input
            type="checkbox"
            checked={useAI}
            onChange={(e) => setUseAI(e.target.checked)}
          />
          Использовать серверный AI: отправить цель и агрегаты отчётов
          провайдеру модели
        </label>
        <button disabled={busy}>
          {busy ? "Готовим рекомендации…" : "Получить план и анализ"}
        </button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {answer && (
        <div className="assistant-answer" aria-live="polite">
          <small>{answer.label}</small>
          <p>{answer.text}</p>
          <small className="muted">{answer.reason}</small>
        </div>
      )}
    </section>
  );
}

export function SiteLimitsEditor({ settings }: { settings: Settings }) {
  const [rows, setRows] = useState(() => settings.siteLimits ?? []);
  return (
    <fieldset className="site-limits">
      <legend>Smart Break · правила отдельных сайтов</legend>
      <p>
        0 минут — полный запрет. Другие лимиты считаются по измеренному времени
        сайта в каждой сессии.
      </p>
      <input type="hidden" name="siteLimits" value={JSON.stringify(rows)} />
      {rows.map((r, n) => (
        <div className="limit-row" key={n}>
          <label>
            Домен
            <input
              required
              value={r.domain}
              placeholder="instagram.com"
              onChange={(e) =>
                setRows(
                  rows.map((v, i) =>
                    i === n ? { ...v, domain: e.target.value } : v,
                  ),
                )
              }
            />
          </label>
          <label>
            Лимит, мин
            <input
              type="number"
              required
              min="0"
              max="1440"
              step="any"
              value={r.limitMs / 60000}
              onChange={(e) =>
                setRows(
                  rows.map((v, i) =>
                    i === n
                      ? {
                          ...v,
                          limitMs: Math.round(Number(e.target.value) * 60000),
                        }
                      : v,
                  ),
                )
              }
            />
          </label>
          <button
            type="button"
            className="secondary"
            aria-label={`Удалить правило ${r.domain}`}
            onClick={() => setRows(rows.filter((_, i) => i !== n))}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="secondary"
        disabled={rows.length >= 100}
        onClick={() => setRows([...rows, { domain: "", limitMs: 300000 }])}
      >
        Добавить сайт
      </button>
      <label className="ai-consent">
        <input
          type="checkbox"
          name="allowExtraTime"
          defaultChecked={settings.allowExtraTime === true}
        />
        Разрешить дополнительные 5 минут после Focus Delay
      </label>
      <small>
        Chat Pass: до 10 минут один раз для Instagram Direct и Facebook Messages
        в сессии. Полный запрет исключений не допускает. Выделение переписки
        экспериментальное и зависит от устройства сайта.
      </small>
    </fieldset>
  );
}

export function BlockedPage() {
  const params = new URLSearchParams(location.hash.split("?")[1] ?? "");
  const domain = domainOf(params.get("domain") ?? ""),
    extension = params.get("extension") ?? "";
  const [state, setState] = useState<any>(null),
    [error, setError] = useState(""),
    [now, setNow] = useState(Date.now()),
    [busy, setBusy] = useState(false);
  async function send(type: string) {
    setBusy(true);
    setError("");
    try {
      if (
        !domain ||
        !/^[a-p]{32}$/.test(extension) ||
        !globalThis.chrome?.runtime?.sendMessage
      )
        throw Error(
          "Откройте эту страницу через актуальное расширение Nazar в Chrome.",
        );
      const r = await chrome.runtime.sendMessage(extension, { type, domain });
      if (!r?.ok)
        throw Error(
          r?.error ??
            "Расширение не отвечает. Обновите Nazar в chrome://extensions.",
        );
      if (r.state.navigate) {
        const url = new URL(r.state.navigate);
        if (url.protocol === "https:" && domainOf(url.href) === domain)
          location.assign(url.href);
      } else setState(r.state);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void send("focus");
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  const remaining = state?.readyAt
    ? Math.max(0, Math.ceil((state.readyAt - now) / 1000))
    : 15;
  return (
    <main className="blocked-page">
      <a className="brand" href="#overview">
        nazar<span>●</span>
      </a>
      <section className="panel">
        <p className="eyebrow">FOCUS DELAY · ОСОЗНАННАЯ ПАУЗА</p>
        <h1>Вернёмся к важному?</h1>
        <p>Ваше время закончилось. Пора вернуться к запланированной задаче.</p>
        <p>
          <b>{domain}</b>
          {state?.hard ? " · Вы выбрали полный запрет" : ""}
        </p>
        <blockquote>{state?.goal ?? "Вспомните цель занятия."}</blockquote>
        <div
          className="focus-countdown"
          role="timer"
          aria-label="Секунд до решения"
        >
          {remaining ? `${remaining} сек` : "Можно выбрать"}
        </div>
        <p>
          Вам действительно необходимо продолжить использование этого сайта?
        </p>
        <div className="blocked-actions">
          <button
            disabled={busy || remaining > 0}
            onClick={() => void send("return")}
          >
            Вернуться к учебной задаче
          </button>
          {state?.canChat && (
            <button
              className="secondary"
              disabled={busy || remaining > 0}
              onClick={() => void send("chat")}
            >
              Chat Pass · до 10 минут
            </button>
          )}
          {state?.canExtra && (
            <button
              className="secondary"
              disabled={busy || remaining > 0}
              onClick={() => void send("extra")}
            >
              Дополнительные 5 минут
            </button>
          )}
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <p className="muted">
          Chat Pass доступен один раз на сайт за сессию. Новые сообщения не
          продлевают время. После истечения срока доступ снова ограничивается.
        </p>
        <a href="#timer">Открыть планирование Nazar →</a>
      </section>
    </main>
  );
}
