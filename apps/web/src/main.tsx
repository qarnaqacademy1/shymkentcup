import React, { useState, useEffect, useCallback } from "react";
import { createRoot } from "react-dom/client";
import {
  defaults,
  domainOf,
  type Settings,
  type Session,
  type HistorySnapshot,
} from "@nazar/shared";
import "./style.css";
import "./product.css";
import {
  Analytics,
  DailyReport,
  Assistant,
  SiteLimitsEditor,
  BlockedPage,
  Donut,
} from "./nazar4";
import {
  AttentionMap,
  MobileTimer,
  InstallPwa,
  WeeklyProgress,
  DemoMap,
} from "./product";
if ("serviceWorker" in navigator && import.meta.env.PROD)
  navigator.serviceWorker.register("/sw.js").catch(() => {});
type User = { id: string; email: string };
type Report = Session & {
  id: string;
  trackedMs: number;
  distractedMs: number;
  overBudgetMs: number;
};
type Stats = {
  trackedMs: number;
  distractedMs: number;
  sessions: number;
  completed: number;
  taskDone: number;
  withinBudget: number;
  mobileSessions: number;
  extensionSessions: number;
  warnings: number;
  exceptions: number;
  overBudgetMs: number;
  timezone: string;
  days: Record<string, { trackedMs: number; distractedMs: number }>;
};
async function api<T = any>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  let r: Response;
  try {
    r = await fetch("/api" + path, {
      method,
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-Nazar": "1" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw Error("Нет связи с сервером. Проверьте подключение и повторите.");
  }
  const data = await r.json();
  if (!r.ok) throw Error(data.error || "Не удалось выполнить запрос");
  return data;
}
const duration = (ms: number) =>
  ms < 60000
    ? `${Math.floor(ms / 1000)} сек`
    : `${Math.floor(ms / 3600000) ? Math.floor(ms / 3600000) + " ч " : ""}${Math.floor((ms % 3600000) / 60000)} мин`;
const date = (t: number, tz = "Asia/Almaty") =>
  new Intl.DateTimeFormat("ru", {
    timeZone: tz,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(t);
const labels: Record<string, string> = {
  overview: "Обзор",
  timer: "Smart Start",
  analytics: "Аналитика",
  report: "Отчёт за день",
  ai: "Nazar AI",
  sessions: "Мои сессии",
  settings: "Мои правила",
  install: "Расширение",
  account: "Аккаунт и данные",
};
function Icon({ name }: { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    timer: (
      <>
        <circle cx="12" cy="13" r="8" />
        <path d="M12 9v4l3 2M9 2h6" />
      </>
    ),
    analytics: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 3v9h9" />
      </>
    ),
    report: (
      <>
        <path d="M6 3h9l3 3v15H6ZM9 9h6M9 13h6M9 17h4" />
      </>
    ),
    ai: (
      <>
        <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z" />
      </>
    ),
    overview: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="2" />
        <rect x="14" y="3" width="7" height="7" rx="2" />
        <rect x="3" y="14" width="7" height="7" rx="2" />
        <rect x="14" y="14" width="7" height="7" rx="2" />
      </>
    ),
    sessions: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    settings: (
      <>
        <path d="M4 6h16M4 12h16M4 18h16" />
        <circle cx="8" cy="6" r="2" />
        <circle cx="16" cy="12" r="2" />
        <circle cx="10" cy="18" r="2" />
      </>
    ),
    install: (
      <>
        <path d="M8 4h8v5h4v11H4V9h4Z" />
        <path d="M12 11v6m-3-3 3 3 3-3" />
      </>
    ),
    account: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </>
    ),
    arrow: <path d="m7 17 10-10M7 7h10v10" />,
    leaf: (
      <>
        <path d="M5 19C0 6 11 3 20 4c0 10-3 18-15 15Z" />
        <path d="M5 19 15 9" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.arrow}
    </svg>
  );
}
function Brand() {
  return (
    <a className="brand" href="#overview" aria-label="Nazar — на главную">
      nazar<span>●</span>
    </a>
  );
}
function App() {
  const [user, setUser] = useState<User | null>(null),
    [loading, setLoading] = useState(true),
    [page, setPage] = useState(location.hash.slice(1) || "timer"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [stats, setStats] = useState<Stats | null>(null),
    [sessions, setSessions] = useState<Report[]>([]),
    [settings, setSettings] = useState<Settings>(defaults),
    [detail, setDetail] = useState<Report | null>(null),
    [busy, setBusy] = useState(false),
    [authMode, setAuthMode] = useState<"login" | "register" | null>(null),
    [history, setHistory] = useState<HistorySnapshot | null>(null),
    [devices, setDevices] = useState<any[]>([]),
    [code, setCode] = useState<{ code: string; expiresAt: string } | null>(
      null,
    ),
    [listPage, setListPage] = useState(0);
  const [period, setPeriod] = useState(30);
  useEffect(() => {
    const h = () => {
      setPage(location.hash.slice(1) || "timer");
      setDetail(null);
      setError("");
    };
    window.addEventListener("hashchange", h);
    return () => window.removeEventListener("hashchange", h);
  }, []);
  const load = useCallback(async () => {
    const now = Date.now();
    const [st, se, ru, hi, de] = await Promise.all([
      api<Stats>(`/stats?from=${now - period * 86400000}&to=${now + 1}`),
      api<Report[]>("/sessions?page=" + listPage),
      api<Settings>("/settings"),
      api<HistorySnapshot | null>("/history"),
      api<any[]>("/devices"),
    ]);
    setStats(st);
    setSessions(se);
    setSettings(ru);
    setHistory(hi);
    setDevices(de);
  }, [listPage, period]);
  useEffect(() => {
    void api<User>("/auth/me")
      .then(setUser)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (user) void load().catch((e) => setError(e.message));
  }, [user, load]);
  useEffect(() => {
    const offline = () =>
      setError("Нет сети. Ваши результаты в расширении сохраняются локально.");
    window.addEventListener("offline", offline);
    return () => window.removeEventListener("offline", offline);
  }, []);
  useEffect(() => {
    if (!authMode && !detail) return;
    const previous = document.activeElement as HTMLElement | null;
    const keydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setAuthMode(null);
        setDetail(null);
      }
      if (e.key !== "Tab") return;
      const modal = document.querySelector('[role="dialog"]');
      const items = Array.from(
        modal?.querySelectorAll<HTMLElement>(
          "button, input, a[href], textarea",
        ) || [],
      );
      const first = items[0],
        last = items.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      }
      if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      previous?.focus();
    };
  }, [authMode, detail]);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const navigate = (p: string) => {
    location.hash = p;
  };
  if (loading)
    return (
      <div className="loading">
        <Brand />
        <p role="status">Открываем ваше пространство…</p>
      </div>
    );
  if (page === "demo")
    return (
      <div className="public">
        <header className="public-nav">
          <Brand />
        </header>
        <DemoMap />
      </div>
    );
  if (!user)
    return (
      <div className="public">
        <header className="public-nav">
          <Brand />
          <a href="#how">Как это работает</a>
          <button className="plain" onClick={() => setAuthMode("login")}>
            Войти
          </button>
          <button onClick={() => setAuthMode("register")}>
            Начать бесплатно <span>↗</span>
          </button>
        </header>
        <InstallPwa />
        <main>
          <section className="hero">
            <div>
              <p className="eyebrow">
                <span className="dot" /> ВНИМАНИЕ ПО ТВОИМ ПРАВИЛАМ
              </p>
              <h1>
                Одна задача.
                <br />
                Твоё <em>внимание.</em>
              </h1>
              <p className="lead">
                Открываешь лекцию, а через полчаса листаешь ленту?
                <br className="desktop" /> Назар помогает заметить этот момент и
                вернуться к тому, что важно.
              </p>
              <button className="large" onClick={() => setAuthMode("register")}>
                Начать свою первую сессию <span>↗</span>
              </button>
              <p className="muted">
                Для учёбы за ноутбуком · Chrome · Без AI-ключей
              </p>
              <a className="text-link" href="#demo">
                Посмотреть пример решений и карты ↗
              </a>
            </div>
            <div
              className="hero-visual"
              aria-label="Цель, бюджет сайтов, осознанный выбор"
            >
              <div className="orbit o1" />
              <div className="orbit o2" />
              <div className="orbit o3" />
              <div className="focus-core">
                <Icon name="leaf" />
                <span>
                  Место для
                  <br />
                  <b>важного.</b>
                </span>
              </div>
              <span className="float f1">◎ Одна учебная цель</span>
              <span className="float f2">↗ Осознанный выбор</span>
              <span className="float f3">◷ Бюджет сайтов</span>
              <span className="visual-caption">
                Меньше автопилота. Больше намерения.
              </span>
            </div>
          </section>
          <section id="how" className="how">
            <div>
              <p className="eyebrow">ПРОСТОЙ РИТУАЛ</p>
              <h2>
                Ты решаешь, чему
                <br />
                посвятить время.
              </h2>
            </div>
            {[
              [
                "01",
                "Задай направление",
                "Выбери цель сессии, отвлекающие сайты и общий бюджет времени.",
              ],
              [
                "02",
                "Заметь переключение",
                "Расширение ограничит выбранные сайты. После лимита сделай осознанную паузу и вернись к цели.",
              ],
              [
                "03",
                "Посмотри на факты",
                "В отчёте — учтённое время на сайтах, твои решения и отметка о выполнении задачи.",
              ],
            ].map(([n, t, p]) => (
              <article key={n}>
                <span className="step">{n}</span>
                <h3>{t}</h3>
                <p>{p}</p>
              </article>
            ))}
          </section>
          <section className="privacy-strip">
            <Icon name="check" />
            <p>
              Твои правила. Твои данные.
              <small>
                Без рейтингов и оценок концентрации. Импорт истории — только по
                желанию.
              </small>
            </p>
            <button
              className="secondary"
              onClick={() => setAuthMode("register")}
            >
              Попробовать Nazar ↗
            </button>
          </section>
        </main>
        <footer>
          <Brand />
          <span>Сделано для осознанной учёбы. Казахстан, 2026.</span>
        </footer>
        {authMode && (
          <div className="modal-backdrop">
            <section
              className="auth-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="auth-title"
            >
              <button
                className="close"
                autoFocus
                onClick={() => setAuthMode(null)}
                aria-label="Закрыть"
              >
                ×
              </button>
              <p className="eyebrow">ТВОЁ ПРОСТРАНСТВО</p>
              <h2 id="auth-title">
                {authMode === "register" ? "Начнём с тебя." : "С возвращением."}
              </h2>
              <p className="muted">
                {authMode === "register"
                  ? "Один аккаунт для сайта и расширения."
                  : "Продолжим с того, что важно."}
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void run(async () => {
                    setUser(
                      await api<User>("/auth/" + authMode, "POST", {
                        email: f.get("email"),
                        password: f.get("password"),
                      }),
                    );
                    setAuthMode(null);
                    navigate("timer");
                  });
                }}
              >
                <label>
                  Email
                  <input
                    type="email"
                    name="email"
                    autoComplete="email"
                    required
                    placeholder="you@example.com"
                  />
                </label>
                <label>
                  Пароль
                  <input
                    type="password"
                    name="password"
                    minLength={10}
                    maxLength={128}
                    autoComplete={
                      authMode === "login" ? "current-password" : "new-password"
                    }
                    required
                    placeholder="Не менее 10 символов"
                  />
                </label>
                <button className="full" disabled={busy}>
                  {busy
                    ? "Подождите…"
                    : authMode === "register"
                      ? "Создать аккаунт →"
                      : "Войти →"}
                </button>
              </form>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <button
                className="text-button"
                onClick={() => {
                  setError("");
                  setAuthMode(authMode === "login" ? "register" : "login");
                }}
              >
                {authMode === "login"
                  ? "Нет аккаунта? Зарегистрироваться"
                  : "Уже есть аккаунт? Войти"}
              </button>
            </section>
          </div>
        )}
      </div>
    );
  return (
    <div className="workspace">
      <aside className="sidebar">
        <Brand />
        <div className="workspace-label">ЛИЧНОЕ ПРОСТРАНСТВО</div>
        <nav aria-label="Главная навигация">
          {Object.entries(labels).map(([key, label]) => (
            <a
              href={"#" + key}
              key={key}
              aria-current={page === key ? "page" : undefined}
              className={page === key ? "active" : ""}
            >
              <Icon name={key} />
              {label}
              {key === "install" && <span className="nav-badge">Chrome</span>}
            </a>
          ))}
        </nav>
        <div className="sidebar-note">
          <Icon name="leaf" />
          <h3>
            По чуть-чуть.
            <br />
            Но с намерением.
          </h3>
          <p>Следующая сессия — ещё одна возможность выбрать важное.</p>
        </div>
        <div className="profile">
          <span className="avatar">{user.email[0].toUpperCase()}</span>
          <div>
            <b>{user.email.split("@")[0]}</b>
            <small>Личный аккаунт</small>
          </div>
          <button
            className="plain"
            aria-label="Выйти"
            onClick={() =>
              void run(async () => {
                await api("/auth/logout", "POST");
                setUser(null);
                setStats(null);
                setSessions([]);
              })
            }
          >
            ↪
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span>
            Моё пространство <span className="slash">/</span>{" "}
            <b>{labels[page] || "Обзор"}</b>
          </span>
          <span className="top-date">
            {new Intl.DateTimeFormat("ru", {
              day: "numeric",
              month: "long",
              timeZone: settings.timezone,
            }).format(Date.now())}
            <span className="dot" /> Твой темп
          </span>
        </header>
        <main className="content">
          {error && (
            <div className="error" role="alert">
              {error}
              <button className="text-button" onClick={() => void run(load)}>
                Повторить
              </button>
            </div>
          )}
          {notice && (
            <p className="success" role="status">
              {notice}
            </p>
          )}
          {page === "overview" && (
            <>
              <div
                className="period-selector"
                role="group"
                aria-label="Период обзора"
              >
                {[
                  [1, "24 часа"],
                  [7, "Неделя"],
                  [30, "Месяц"],
                ].map(([n, label]) => (
                  <button
                    className={period === n ? "" : "secondary"}
                    aria-pressed={period === n}
                    key={n}
                    onClick={() => setPeriod(Number(n))}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">ВНИМАНИЕ НА ГЛАВНОМ</p>
                  <h1>
                    Хороший день, чтобы начать<span className="green">.</span>
                  </h1>
                  <p>Небольшая цель. Понятные границы. Время для важного.</p>
                </div>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => void run(load)}
                >
                  ↻ Обновить
                </button>
              </div>
              <section className="session-banner">
                <div>
                  <span className="pill">ТВОЯ СЛЕДУЮЩАЯ СЕССИЯ</span>
                  <h2>
                    Что сегодня
                    <br />
                    заслуживает внимания?
                  </h2>
                  <p>Задай цель в расширении. Остальное подождёт.</p>
                  <button className="light" onClick={() => navigate("install")}>
                    Начать Chrome-сессию <span>↗</span>
                  </button>
                </div>
                <div className="banner-art" aria-hidden="true">
                  <div />
                  <Icon name="leaf" />
                  <span>
                    одна цель
                    <br />
                    за раз
                  </span>
                </div>
              </section>
              <div className="section-heading">
                <h2>Твой ритм</h2>
                <span>
                  {period === 1
                    ? "Последние 24 часа"
                    : `Последние ${period} дней`}{" "}
                  · {settings.timezone}
                </span>
              </div>
              <section className="metric-grid">
                {[
                  [
                    duration(stats?.trackedMs || 0),
                    "Учтённое время на сайтах",
                    "sessions",
                  ],
                  [
                    duration(stats?.distractedMs || 0),
                    "На отвлекающих сайтах",
                    "overview",
                  ],
                  [String(stats?.completed || 0), "Завершено сессий", "check"],
                  [
                    String(stats?.taskDone || 0),
                    "Задач отмечено выполненными",
                    "leaf",
                  ],
                ].map(([value, label, icon]) => (
                  <article className="metric" key={label}>
                    <Icon name={icon} />
                    <strong>{value}</strong>
                    <span>{label}</span>
                  </article>
                ))}
              </section>
              <div className="analytics-strip">
                <span>
                  Chrome-сессии: <b>{stats?.extensionSessions || 0}</b>
                </span>
                <span>
                  Мобильный таймер: <b>{stats?.mobileSessions || 0}</b>
                </span>
                <span>
                  Предупреждения: <b>{stats?.warnings || 0}</b>
                </span>
                <span>
                  Исключения: <b>{stats?.exceptions || 0}</b>
                </span>
                <span>
                  Превышение: <b>{duration(stats?.overBudgetMs || 0)}</b>
                </span>
              </div>
              <WeeklyProgress
                target={settings.weeklyGoal || 0}
                fetchCount={async () => {
                  const now = Date.now();
                  const stats = await api<Stats>(
                    `/stats?from=${now - 7 * 86400000}&to=${now + 1}`,
                  );
                  return stats.completed;
                }}
              />
              <div className="overview-grid">
                <Analytics api={api} settings={settings} />
                <section className="panel rules-summary">
                  <p className="eyebrow">ТВОИ ГРАНИЦЫ</p>
                  <h2>Правила задаёшь ты.</h2>
                  <div className="rule-value">
                    <strong>{duration(settings.budgetMs)}</strong>
                    <span>общий бюджет на сессию</span>
                  </div>
                  <div className="chips">
                    {settings.domains.slice(0, 4).map((d) => (
                      <span key={d}>{d}</span>
                    ))}
                    {!settings.domains.length && <p>Список пока пуст</p>}
                  </div>
                  <p>
                    Нужен сайт для учёбы? Сделай исключение до конца текущей
                    сессии.
                  </p>
                  <a href="#settings" className="text-link">
                    Настроить мои правила ↗
                  </a>
                </section>
              </div>
              <div className="section-heading">
                <h2>Последние сессии</h2>
                <a className="text-link" href="#sessions">
                  Вся история ↗
                </a>
              </div>
              <SessionList
                sessions={sessions.slice(0, 3)}
                open={(id) =>
                  void run(async () => setDetail(await api("/sessions/" + id)))
                }
                install={() => navigate("install")}
              />
              {stats && stats.extensionSessions > 0 && (
                <p className="footnote">
                  В пределах бюджета: {stats.withinBudget} из{" "}
                  {stats.extensionSessions} сессий. Выполнение задачи отмечает
                  сам пользователь.
                </p>
              )}
            </>
          )}
          {page === "sessions" && (
            <>
              <PageTitle
                eyebrow="ОТ НАМЕРЕНИЯ К ФАКТАМ"
                title="Мои сессии"
                text="Каждая сессия — отдельная цель и снимок твоих правил."
              />
              <SessionList
                sessions={sessions}
                open={(id) =>
                  void run(async () => setDetail(await api("/sessions/" + id)))
                }
                install={() => navigate("install")}
              />
              <div className="pagination">
                <button
                  className="secondary"
                  disabled={listPage === 0}
                  onClick={() => setListPage((v) => v - 1)}
                >
                  ← Назад
                </button>
                <span>Страница {listPage + 1}</span>
                <button
                  className="secondary"
                  disabled={sessions.length < 30}
                  onClick={() => setListPage((v) => v + 1)}
                >
                  Далее →
                </button>
              </div>
              <button className="text-button" onClick={() => void run(load)}>
                Обновить результаты
              </button>
            </>
          )}
          {page === "settings" && (
            <>
              <PageTitle
                eyebrow="ОСОЗНАННЫЕ ГРАНИЦЫ"
                title="Мои правила"
                text="Изменения применятся после синхронизации. Текущая сессия сохранит свои правила."
              />
              <form
                className="panel settings-form"
                key={JSON.stringify(settings)}
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  const raw = String(f.get("domains"))
                    .split(/[\n,]+/)
                    .map((d) => d.trim())
                    .filter(Boolean);
                  const domains = raw.map(domainOf);
                  if (domains.some((d) => !d)) {
                    setError("Проверьте домены в списке");
                    return;
                  }
                  void run(async () => {
                    const v = await api<Settings>("/settings", "PUT", {
                      domains: [...new Set(domains)],
                      budgetMs: Math.round(Number(f.get("budget")) * 60000),
                      timezone: f.get("timezone"),
                      shareHistory: f.get("share") === "on",
                      weeklyGoal: Number(f.get("weeklyGoal")),
                      siteLimits: JSON.parse(
                        String(f.get("siteLimits") || "[]"),
                      ).map((r: any) => ({
                        ...r,
                        domain: domainOf(r.domain) ?? r.domain,
                      })),
                      allowExtraTime: f.get("allowExtraTime") === "on",
                    });
                    setSettings(v);
                    setNotice(
                      "Правила сохранены. Синхронизируйте расширение перед следующей сессией.",
                    );
                  });
                }}
              >
                <h2>Сайты, на которые легко отвлечься</h2>
                <p>
                  Укажите домены, по одному на строку. Правило включает
                  поддомены.
                </p>
                <label>
                  Отвлекающие сайты
                  <textarea
                    name="domains"
                    defaultValue={settings.domains.join("\n")}
                    rows={5}
                    placeholder="youtube.com"
                  />
                </label>
                <div className="form-grid">
                  <label>
                    Общий бюджет, минуты
                    <input
                      type="number"
                      name="budget"
                      min="0.016667"
                      max="1440"
                      step="any"
                      required
                      defaultValue={settings.budgetMs / 60000}
                    />
                  </label>
                  <label>
                    Часовой пояс
                    <input
                      name="timezone"
                      required
                      defaultValue={settings.timezone}
                      list="timezones"
                    />
                    <datalist id="timezones">
                      {[
                        "Asia/Almaty",
                        "Asia/Qyzylorda",
                        "Asia/Aqtau",
                        "Europe/Moscow",
                        "UTC",
                      ].map((z) => (
                        <option key={z}>{z}</option>
                      ))}
                    </datalist>
                  </label>
                </div>
                <div className="consent">
                  <label>
                    Добровольная цель на 7 дней, сессии
                    <input
                      type="number"
                      min="0"
                      max="100"
                      name="weeklyGoal"
                      defaultValue={settings.weeklyGoal || 0}
                    />
                  </label>
                  <p>0 — без цели. Без рейтингов и обязательных серий.</p>
                  <label>
                    <input
                      type="checkbox"
                      name="share"
                      defaultChecked={settings.shareHistory}
                    />{" "}
                    Разрешить сводку истории на сайте
                  </label>
                  <p>
                    Только домены, число локальных посещений и границы периода.
                    Импорт и отправка запускаются отдельно в расширении.
                    Отключение удалит серверную сводку.
                  </p>
                </div>
                <SiteLimitsEditor settings={settings} />
                <button disabled={busy}>
                  {busy ? "Сохраняем…" : "Сохранить мои правила →"}
                </button>
              </form>
            </>
          )}
          {page === "timer" && (
            <MobileTimer
              key={user.id}
              ownerId={user.id}
              settings={settings}
              upload={(s) =>
                api("/sessions/" + s.clientSessionId, "PUT", {
                  ...s,
                  ownerId: user.id,
                })
              }
              onSaved={() => void run(load)}
              reserve={(plan) =>
                api("/plans", "POST", { ...plan, source: "mobile" })
              }
              getBudget={() => api("/plans")}
            />
          )}
          {page === "analytics" && <Analytics api={api} settings={settings} />}
          {page === "report" && <DailyReport api={api} settings={settings} />}
          {page === "ai" && <Assistant api={api} />}
          {page === "install" && (
            <>
              <p className="muted">
                {import.meta.env.VITE_EXTENSION_MODE === "production"
                  ? "Production-расширение для этого HTTPS-сайта."
                  : "Локальное расширение для компьютера разработчика. Для публичного сервера скачивайте ZIP на его сайте."}
              </p>
              <PageTitle
                eyebrow="ОДИН РАЗ НАСТРОИТЬ. ДАЛЬШЕ — УЧИТЬСЯ."
                title="Твоё внимание — с тобой"
                text="Подключи Nazar в Chrome. Сессия работает, даже когда окно расширения закрыто."
              />
              <div className="install-grid">
                <section className="panel install-step">
                  <span className="step">01</span>
                  <h2>Установи расширение</h2>
                  <ol>
                    <li>Скачай ZIP и распакуй его в отдельную папку.</li>
                    <li>
                      Открой <code>chrome://extensions</code> в Chrome.
                    </li>
                    <li>
                      Включи режим разработчика, нажми «Загрузить распакованное
                      расширение» и выбери распакованную папку.
                    </li>
                    <li>Закрепи Nazar в панели расширений.</li>
                  </ol>
                  <a className="button" href="/downloads/nazar-extension.zip">
                    Скачать расширение ↓
                  </a>
                  <p className="footnote">
                    Chrome 120 или новее. ZIP нужно распаковать перед
                    установкой.
                  </p>
                </section>
                <section className="panel install-step">
                  <span className="step">02</span>
                  <h2>Подключи аккаунт</h2>
                  <p>
                    Создай одноразовый код и вставь его в Nazar в панели Chrome.
                  </p>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () =>
                        setCode(await api("/pair/code", "POST")),
                      )
                    }
                  >
                    Создать код подключения ↗
                  </button>
                  {code && (
                    <div className="pair-code">
                      <label>
                        Одноразовый код
                        <input
                          readOnly
                          value={code.code}
                          onFocus={(e) => e.target.select()}
                        />
                      </label>
                      <button
                        className="secondary"
                        onClick={() =>
                          void navigator.clipboard
                            .writeText(code.code)
                            .then(() => setNotice("Код скопирован"))
                            .catch(() =>
                              setNotice("Выделите код и скопируйте вручную"),
                            )
                        }
                      >
                        Копировать
                      </button>
                      <small>
                        Действует до{" "}
                        {date(
                          new Date(code.expiresAt).getTime(),
                          settings.timezone,
                        )}
                        . Только одно подключение.
                      </small>
                    </div>
                  )}
                  <div className="tip">
                    <Icon name="leaf" />
                    <p>
                      Готово? В расширении задай цель и нажми «Начать сессию».
                    </p>
                  </div>
                </section>
              </div>
              <section className="panel">
                <h2>Как устроены разрешения</h2>
                <p>
                  Для таймера нужны активная вкладка, фокус окна, простой
                  устройства, локальное хранение и уведомления. Доступ к
                  истории, вкладкам и HTTP/HTTPS-сайтам подтверждается при
                  установке или обновлении расширения. Анализ истории
                  запускается по кнопке; отправка сводки на сайт требует
                  отдельного согласия.
                </p>
                <p className="muted">
                  При отсутствии ввода 2 минуты учёт сайтов останавливается.
                  Чтение без ввода тоже может считаться простоем: это
                  ограничение измерения. Длительность сессии при этом
                  продолжается.
                </p>
              </section>
            </>
          )}
          {page === "account" && (
            <>
              <PageTitle
                eyebrow="ВСЁ ПОД ТВОИМ КОНТРОЛЕМ"
                title="Аккаунт и данные"
                text={user.email}
              />
              <button
                className="secondary bottom-logout"
                onClick={() =>
                  void run(async () => {
                    await api("/auth/logout", "POST");
                    setUser(null);
                    setSessions([]);
                    setStats(null);
                  })
                }
              >
                Выйти из аккаунта
              </button>
              <InstallPwa />
              <section className="panel">
                <h2>Центр приватности</h2>
                <p>
                  На сервере: аккаунт, правила, принятые сессии и только
                  согласованная сводка истории. На устройстве: состояние
                  расширения, очередь и самостоятельный мобильный таймер. Полные
                  URL и заголовки истории не отправляются.
                </p>
                <p>
                  Chrome: storage, tabs, history, idle, alarms, notifications и
                  declarativeNetRequest; доступ к HTTP/HTTPS-сайтам нужен для
                  перенаправления. Разрешения доступны на странице расширения в
                  Chrome. PWA не получает доступ к другим приложениям.
                </p>
                <div className="export-actions">
                  <a className="button secondary" href="/api/export">
                    Скачать свои данные JSON ↓
                  </a>
                  <a className="button secondary" href="/api/export?format=csv">
                    Сессии CSV ↓
                  </a>
                  <a className="text-link" href="#install">
                    Установка и разрешения Chrome ↗
                  </a>
                </div>
              </section>
              <section className="panel">
                <h2>Подключённые устройства</h2>
                {devices.length ? (
                  devices.map((d) => (
                    <div className="device" key={d.id}>
                      <Icon name="install" />
                      <div>
                        <b>{d.name}</b>
                        <small>
                          Доступ до{" "}
                          {date(
                            new Date(d.expiresAt).getTime(),
                            settings.timezone,
                          )}
                        </small>
                      </div>
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await api("/devices/" + d.id, "DELETE");
                            await load();
                            setNotice("Доступ устройства отозван");
                          })
                        }
                      >
                        Отозвать доступ
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="muted">
                    Устройств пока нет.{" "}
                    <a href="#install">Подключить расширение ↗</a>
                  </p>
                )}
              </section>
              <section className="panel">
                <h2>Посещения из истории</h2>
                <p>
                  Это число посещений, отдельно от времени, измеренного
                  расширением.
                </p>
                {history ? (
                  <>
                    <p>
                      Период: {date(history.from, settings.timezone)} —{" "}
                      {date(history.to, settings.timezone)}.{" "}
                      {history.complete
                        ? "Выборка в пределах лимитов."
                        : "Возможна неполнота выборки."}
                    </p>
                    <div className="chips">
                      {history.domains.map((d) => (
                        <span key={d.domain}>
                          {d.domain} · {d.visits} посещ.
                        </span>
                      ))}
                    </div>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await api("/history", "DELETE");
                          setHistory(null);
                          setNotice("Серверная сводка удалена");
                        })
                      }
                    >
                      Удалить сводку с сайта
                    </button>
                  </>
                ) : (
                  <div className="empty compact">
                    <h3>История остаётся на твоём устройстве</h3>
                    <p>
                      Чтобы увидеть сводку здесь, разреши её в «Моих правилах»,
                      затем импортируй и отправь её из расширения.
                    </p>
                  </div>
                )}
              </section>
              <section className="panel danger">
                <h2>Удалить аккаунт и данные Nazar</h2>
                <p>
                  Удалятся настройки, сессии, устройства и сводка истории.
                  История самого Chrome останется. Действие необратимо.
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    if (
                      confirm(
                        "Удалить аккаунт и все данные приложения без возможности восстановления?",
                      )
                    )
                      void run(async () => {
                        await api("/account", "DELETE", {
                          password: f.get("password"),
                        });
                        localStorage.removeItem("nazar-mobile-v1:" + user.id);
                        setUser(null);
                        setStats(null);
                        setSessions([]);
                      });
                  }}
                >
                  <label>
                    Подтвердите паролем
                    <input
                      type="password"
                      name="password"
                      autoComplete="current-password"
                      required
                    />
                  </label>
                  <button className="danger-button" disabled={busy}>
                    Удалить мои данные
                  </button>
                </form>
              </section>
            </>
          )}
          {detail && (
            <div className="modal-backdrop">
              <section
                className="report-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="report-title"
              >
                <button
                  className="close"
                  autoFocus
                  onClick={() => setDetail(null)}
                  aria-label="Закрыть отчёт"
                >
                  ×
                </button>
                <p className="eyebrow">
                  ОТЧЁТ О СЕССИИ ·{" "}
                  {detail.status === "interrupted" ? "ПРЕРВАНА" : "ЗАВЕРШЕНА"}
                </p>
                <h2 id="report-title">{detail.goal}</h2>
                <p>
                  {date(detail.startedAt, detail.rules.timezone)} ·{" "}
                  {detail.taskDone
                    ? "Задача отмечена выполненной"
                    : "Без отметки о выполнении"}
                </p>
                <div className="report-metrics">
                  {[
                    ["План", duration(detail.plannedMs)],
                    ["Длительность без пауз", duration(detail.elapsedMs)],
                    [
                      "Учтённое время сайтов",
                      detail.source === "mobile"
                        ? "Не измеряется"
                        : duration(detail.trackedMs),
                    ],
                    [
                      "На отвлекающих сайтах",
                      detail.source === "mobile"
                        ? "Не измеряется"
                        : duration(detail.distractedMs),
                    ],
                    [
                      "Бюджет",
                      detail.source === "mobile"
                        ? "Не применяется"
                        : duration(detail.rules.budgetMs),
                    ],
                    [
                      "Превышение",
                      detail.source === "mobile"
                        ? "Не применяется"
                        : duration(detail.overBudgetMs),
                    ],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <small>{k}</small>
                      <strong>{v}</strong>
                    </div>
                  ))}
                </div>
                <Donut intervals={detail.intervals} settings={detail.rules} />
                <AttentionMap session={detail} />
                {detail.source !== "mobile" && (
                  <>
                    <h3>Сайты этой сессии</h3>
                    {Object.entries(
                      detail.intervals.reduce(
                        (acc, i) => {
                          acc[i.domain] =
                            (acc[i.domain] || 0) + i.end - i.start;
                          return acc;
                        },
                        {} as Record<string, number>,
                      ),
                    ).map(([d, t]) => (
                      <div className="domain-row" key={d}>
                        <span>{d}</span>
                        <b>{duration(t)}</b>
                      </div>
                    ))}
                    {!detail.intervals.length && (
                      <p className="muted">
                        Подтверждённых интервалов сайтов нет.
                      </p>
                    )}
                    <h3>Твои решения</h3>
                    {detail.exceptions.map((e, i) => (
                      <p key={i}>
                        ↗ {e.domain} — нужен для задачи с{" "}
                        {date(e.at, detail.rules.timezone)}
                      </p>
                    ))}
                    {!detail.exceptions.length && (
                      <p className="muted">Исключений не было.</p>
                    )}
                    <h3>Напоминания</h3>
                    {detail.warnings.length ? (
                      detail.warnings.map((w, i) => (
                        <p key={i}>
                          Бюджет достигнут: {date(w.at, detail.rules.timezone)}
                        </p>
                      ))
                    ) : (
                      <p className="muted">Бюджет не достигнут.</p>
                    )}
                    <p className="footnote">
                      Снимок правил:{" "}
                      {detail.rules.domains.join(", ") || "пустой список"}.{" "}
                      {detail.status === "interrupted"
                        ? "Непроверенный разрыв не включён в учёт."
                        : ""}{" "}
                      Это учтённое время, а не оценка продуктивности.
                    </p>
                  </>
                )}
              </section>
            </div>
          )}
          <footer className="workspace-footer">
            <span>nazar · внимание по твоим правилам</span>
            <span>Одна цель за раз.</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
function PageTitle({
  eyebrow,
  title,
  text,
}: {
  eyebrow: string;
  title: string;
  text: string;
}) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>
          {title}
          <span className="green">.</span>
        </h1>
        <p>{text}</p>
      </div>
    </div>
  );
}
function SessionList({
  sessions,
  open,
  install,
}: {
  sessions: Report[];
  open: (id: string) => void;
  install: () => void;
}) {
  return sessions.length ? (
    <div className="session-list">
      {sessions.map((s) => (
        <button className="session-row" key={s.id} onClick={() => open(s.id)}>
          <span className="session-icon">
            <Icon name={s.taskDone ? "check" : "sessions"} />
          </span>
          <span className="session-name">
            <b>{s.goal}</b>
            <small>
              {s.source === "mobile" ? "Мобильный таймер" : "Расширение Chrome"}{" "}
              · {date(s.startedAt, s.rules.timezone)} ·{" "}
              {s.status === "interrupted" ? "Прервана" : "Завершена"}
            </small>
          </span>
          <span>
            <b>{duration(s.source === "mobile" ? s.elapsedMs : s.trackedMs)}</b>
            <small>{s.source === "mobile" ? "таймер" : "учтено"}</small>
          </span>
          <span className="session-arrow">↗</span>
        </button>
      ))}
    </div>
  ) : (
    <div className="empty">
      <span className="empty-icon">
        <Icon name="sessions" />
      </span>
      <div>
        <h3>Первая сессия ещё впереди</h3>
        <p>
          Начни с одной понятной задачи. Результат появится здесь после
          синхронизации.
        </p>
      </div>
      <button className="secondary" onClick={install}>
        Открыть инструкцию ↗
      </button>
    </div>
  );
}
function Root() {
  const [blocked, setBlocked] = useState(location.hash.startsWith("#blocked?"));
  useEffect(() => {
    const update = () => setBlocked(location.hash.startsWith("#blocked?"));
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return blocked ? <BlockedPage /> : <App />;
}
createRoot(document.getElementById("root")!).render(<Root />);
