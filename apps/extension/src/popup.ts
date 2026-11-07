import { matches, exceptionApplies, templates } from "@nazar/shared";
declare const __WEB_URL__: string;
const app = document.querySelector<HTMLElement>("#app")!;
const error = document.querySelector<HTMLElement>("#error")!;
(document.querySelector("#dashboard") as HTMLAnchorElement).href =
  __WEB_URL__ + "/#install";
const esc = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const clock = (ms: number) =>
  `${Math.floor(Math.max(0, ms) / 60000)
    .toString()
    .padStart(
      2,
      "0",
    )}:${Math.floor(Math.max(0, ms) / 1000) % 60 < 10 ? "0" : ""}${Math.floor(Math.max(0, ms) / 1000) % 60}`;
let state: any,
  busy = false;
async function send(type: string, data: object = {}) {
  const r = await chrome.runtime.sendMessage({ type, ...data });
  if (!r.ok) throw Error(r.error);
  return r.state;
}
async function action(type: string, data: object = {}) {
  busy = true;
  error.textContent = "";
  try {
    state = await send(type, data);
    render();
  } catch (e: any) {
    error.textContent = e.message;
  } finally {
    busy = false;
  }
}
function render() {
  if (!state.auth) {
    app.innerHTML = `<small>ВНИМАНИЕ ПО ТВОИМ ПРАВИЛАМ</small><h2>Одна цель.<br>Меньше случайных вкладок.</h2><p>Создайте код подключения в личном кабинете и вставьте сюда. Код действует 5 минут.</p><form id="connect"><label>Код подключения<input name="code" required autocomplete="off" maxlength="24"></label><button class="primary">Подключить аккаунт</button></form>`;
    document.querySelector("#connect")!.addEventListener("submit", (e) => {
      e.preventDefault();
      void action("connect", {
        code: new FormData(e.target as HTMLFormElement).get("code"),
      });
    });
    return;
  }
  const a = state.active;
  const current = state.currentHost;
  app.innerHTML = `<small>${esc(state.auth.email)}</small>${a ? `<h2>${esc(a.session.goal)}</h2><div class="timer" id="clock"></div><p class="muted" style="text-align:center">${a.pausedAt ? "На паузе" : "До конца сессии"}</p><div class="card"><p>Бюджет сайтов <strong id="budget">${clock(state.totals.distractedMs)} / ${clock(a.session.rules.budgetMs)}</strong></p><progress value="${state.totals.distractedMs}" max="${a.session.rules.budgetMs}"></progress><small id="tracked">Учтённое время: ${clock(state.totals.trackedMs)}</small></div>${a.session.warnings.length ? `<section class="warning"><b>Nazar Decision</b><p>Цель: ${esc(a.session.goal)}</p><p>Бюджет достигнут. Выберите следующий шаг.</p><button data-decision="return">Вернуться к задаче</button><button data-decision="allow5" ${!a.host || a.pausedAt ? "disabled" : ""}>Разрешить сайт на 5 минут</button><button data-decision="allow-session" ${!a.host || a.pausedAt ? "disabled" : ""}>Нужен до конца сессии</button><button data-decision="details">Подробнее</button></section>` : ""}<p>Текущий сайт: <b>${esc(current || "нет активного сайта")}</b></p><small>${current ? (a.session.exceptions.some((e: any) => exceptionApplies(e, current, Date.now())) ? "Нужен для задачи" : a.session.rules.domains.some((d: string) => matches(current, d)) ? "Отвлекающий сайт" : "Вне списка отвлечений") : "Учёт сайтов остановлен"}</small><button id="except" ${!a.host || a.pausedAt ? "disabled" : ""}>Этот сайт нужен для задачи</button><div class="row"><button id="pause">${a.pausedAt ? "Продолжить" : "Пауза"}</button><button id="finish">Завершить</button></div><label><input id="done" type="checkbox"> Задача выполнена</label><label>Заметка<textarea id="note" maxlength="500" placeholder="Что помогло вернуться к задаче?"></textarea></label>` : `<h2>Чему посвятим время?</h2><form id="start"><label>Шаблон<select id="mode">${templates.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join("")}</select></label><label>Цель сессии<input name="goal" maxlength="200" placeholder="Разобраться с производными" required></label><label>Длительность, минуты<input name="minutes" type="number" min="0.016667" max="240" step="any" value="25" required></label><div class="card"><small>Бюджет: ${clock(state.settings.budgetMs)}. Сайты: ${esc(state.settings.domains.join(", ") || "список пуст")}</small><label><input type="checkbox" required> Подтверждаю сайты и бюджет</label></div><button class="primary">Начать сессию →</button></form>${state.lastResult ? `<p class="card">${state.lastResult.status === "interrupted" ? "Сессия прервана. Сохранены подтверждённые интервалы." : "Результат сохранён."}</p>` : ""}`}<div class="status"><b>${esc(state.syncStatus)}</b><br><small>В очереди: ${state.queueCount}${state.foreignQueueCount ? " · Есть изолированные данные другого аккаунта" : ""}<br>Последняя синхронизация: ${state.lastSync ? esc(new Date(state.lastSync).toLocaleTimeString("ru")) : "ещё не было"}</small><div class="row"><button id="sync">Синхронизировать</button><button id="disconnect" ${a ? "disabled" : ""}>Отключить</button></div></div>${state.notificationBlocked ? '<p class="warning">Системные уведомления отключены. Предупреждение доступно здесь.</p>' : ""}<details><summary>Предложения из истории</summary><p class="muted">Читаем локальные посещения за 7 дней: до 500 страниц и 50 000 посещений. Обрабатываем на устройстве. URL и заголовки не отправляются. По отдельной кнопке можно отправить сводку доменов на сайт. Отказ не влияет на таймер.</p><button id="history">Проанализировать последние 7 дней</button>${
    state.history
      ? `<p>${state.history.complete ? "Выборка в пределах лимитов" : "Выборка может быть неполной"} · только посещения, без времени просмотра</p><form id="choose">${state.history.domains
          .slice(0, 40)
          .map(
            (d: any) =>
              `<label><input type="checkbox" name="domain" value="${esc(d.domain)}"> ${esc(d.domain)} · ${d.visits}</label>`,
          )
          .join(
            "",
          )}<button>Добавить выбранные сайты</button></form><button id="share">Отправить сводку на сайт</button>`
      : ""
  }<button id="clear">Удалить локальные результаты и сводку</button><small>История Chrome останется. Неотправленные результаты этого аккаунта будут удалены.</small></details>`;
  document.querySelector("#start")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(e.target as HTMLFormElement);
    void action("start", { goal: f.get("goal"), minutes: f.get("minutes") });
  });
  for (const [id, type] of [
    ["except", "except"],
    ["pause", a?.pausedAt ? "resume" : "pause"],
    ["sync", "sync"],
    ["disconnect", "disconnect"],
    ["share", "shareHistory"],
  ] as const)
    document
      .getElementById(id)
      ?.addEventListener("click", () => void action(type));
  document.getElementById("finish")?.addEventListener(
    "click",
    () =>
      void action("finish", {
        done: (document.getElementById("done") as HTMLInputElement).checked,
        note:
          (document.getElementById("note") as HTMLTextAreaElement)?.value || "",
      }),
  );
  document.getElementById("history")?.addEventListener("click", async () => {
    try {
      const granted = await chrome.permissions.request({
        permissions: ["history"],
      });
      if (granted) await action("history");
      else
        error.textContent = "Доступ не предоставлен. Основной таймер работает.";
    } catch (e: any) {
      error.textContent = e.message;
    }
  });
  document.querySelector("#choose")?.addEventListener("submit", (e) => {
    e.preventDefault();
    void action("chooseDomains", {
      domains: new FormData(e.target as HTMLFormElement).getAll("domain"),
    });
  });
  document.getElementById("clear")?.addEventListener("click", () => {
    if (
      confirm(
        "Удалить локальную сводку и неотправленные результаты этого аккаунта?",
      )
    )
      void action("clearLocal");
  });
  document
    .querySelectorAll<HTMLButtonElement>("[data-decision]")
    .forEach((b) =>
      b.addEventListener(
        "click",
        () => void action("decision", { action: b.dataset.decision }),
      ),
    );
  document.getElementById("mode")?.addEventListener("change", (e) => {
    const t = templates.find(
      (t) => t.id === (e.target as HTMLSelectElement).value,
    )!;
    (document.querySelector("input[name=goal]") as HTMLInputElement).value =
      t.goal;
    (document.querySelector("input[name=minutes]") as HTMLInputElement).value =
      String(t.minutes);
  });
  tick();
}
function tick() {
  const a = state?.active;
  if (a) {
    const clockEl = document.getElementById("clock");
    if (clockEl)
      clockEl.textContent = clock(a.deadline - (a.pausedAt ?? Date.now()));
  }
}
setInterval(tick, 250);
setInterval(async () => {
  if (busy) return;
  try {
    const next = await send("state");
    const changed =
      !!state.active !== !!next.active ||
      state.syncStatus !== next.syncStatus ||
      state.active?.session.warnings.length !==
        next.active?.session.warnings.length ||
      state.currentHost !== next.currentHost ||
      state.active?.session.intervals.at(-1)?.distracting !==
        next.active?.session.intervals.at(-1)?.distracting;
    state = next;
    const budget = document.getElementById("budget");
    const tracked = document.getElementById("tracked");
    if (budget && next.active)
      budget.textContent =
        clock(next.totals.distractedMs) +
        " / " +
        clock(next.active.session.rules.budgetMs);
    if (tracked && next.totals)
      tracked.textContent = "Учтённое время: " + clock(next.totals.trackedMs);
    const progress = document.querySelector("progress");
    if (progress && next.totals) progress.value = next.totals.distractedMs;
    if (changed) render();
  } catch {}
}, 2000);
void action("state");
