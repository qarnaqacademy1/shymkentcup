// Optional authoring tool: uses Codex's bundled artifact runtime, not an app dependency.
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
const runtime =
  process.env.ARTIFACT_RUNTIME ||
  "C:/Users/user/.cache/codex-runtimes/codex-primary-runtime/dependencies";
process.env.RUNTIME_NODE_MODULES = path.join(runtime, "node/node_modules");
process.env.RUNTIME_NODE = path.join(runtime, "node/bin/node.exe");
const skill =
  process.env.PRESENTATIONS_SKILL_DIR ||
  "C:/Users/user/.codex/plugins/cache/openai-primary-runtime/presentations/26.1030.10813/skills/presentations";
const { Presentation, PresentationFile, FileBlob } = await import(
  pathToFileURL(
    path.join(
      runtime,
      "node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs",
    ),
  ).href
);
const root = process.cwd(),
  tmp = path.join(root, "artifacts/pitch-v31");
await fs.mkdir(tmp, { recursive: true });
if (process.argv.includes("--pdf")) {
  const p = await PresentationFile.importPptx(
    await FileBlob.load(path.join(root, "docs/pitch-deck-v3.1.pptx")),
  );
  const blob = await p.export({ format: "pdf" });
  await fs.writeFile(
    "docs/pitch-deck.pdf",
    new Uint8Array(await blob.arrayBuffer()),
  );
  console.log("PDF exported");
  process.exit(0);
}
const p = Presentation.create({ slideSize: { width: 1280, height: 720 } });
const C = {
  bg: "#F5F7EF",
  ink: "#294735",
  green: "#286447",
  muted: "#77836D",
  pale: "#C9D9B7",
};
function text(s, value, x, y, w, h, size = 28, color = C.ink, bold = false) {
  const sh = s.shapes.add({
    geometry: "textbox",
    position: { left: x, top: y, width: w, height: h },
    fill: "none",
    line: { fill: "none", width: 0 },
  });
  sh.text = value;
  sh.text.style = {
    typeface: "Segoe UI",
    fontSize: size,
    color,
    bold,
    verticalAlignment: "top",
  };
  return sh;
}
function slide(title, notes = "", dark = false) {
  const s = p.slides.add();
  s.background.fill = dark ? C.green : C.bg;
  if (title)
    text(s, title, 72, 56, 1120, 100, 46, dark ? "#F5F7EF" : C.ink, true);
  text(
    s,
    String(p.slides.items.length).padStart(2, "0"),
    1170,
    666,
    45,
    22,
    15,
    dark ? C.pale : C.muted,
  );
  s.speakerNotes.text = notes;
  return s;
}
async function image(s, name, x, y, w, h) {
  const b = await fs.readFile(path.join(root, "docs/screenshots", name));
  s.images.add({
    blob: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
    contentType: "image/png",
    alt: "Реальный скриншот локального Nazar: " + name,
    fit: "contain",
    position: { left: x, top: y, width: w, height: h },
  });
}
const slides = [
  {
    title: "nazar 3.1",
    body: "Внимание по твоим правилам\nWeb · Chrome Extension · Mobile PWA",
    cover: true,
    notes:
      "Кейс №4 The Attention Economy. National Founder Cup Shymkent 2026. По условиям из условия.txt. Основной продукт работает без AI API.",
  },
  {
    title: "Один студент. Одна боль.",
    body: "Открывает ноутбук, чтобы учиться.\n\nАвтоматически переключается\nна привычные сайты —\nи замечает это слишком поздно.",
    notes:
      "Сценарий пользователя из задания. Интервью, размер рынка и процент эффекта не измерялись.",
  },
  {
    title: "Nazar Decision",
    body: "После выбранного бюджета — осознанное решение:\n\nВернуться к задаче\nРазрешить сайт на 5 минут\nНужен до конца сессии\nПодробнее\n\nПрошлые интервалы остаются неизменными.",
    notes:
      "Реализованы expiry и журнал. Shared decide/settle и MV3 worker/popup. Ручной Chrome-прогон ещё требуется.",
  },
  {
    title: "Attention Map и Decision Journal",
    image: "v31-attention-map-demo.png",
    wide: true,
    caption:
      "Контрольный пример: не измерение пользователя и не личная статистика",
    notes:
      "Реальный скриншот локального работающего /#demo. Временные метки заданы для объяснения. Никаких записей в аккаунт/статистику.",
  },
  {
    title: "Честный отчёт о сессии",
    body: "Реальная тестовая\nмобильная сессия\n\n15 секунд до завершения.\nПосле reload остаток восстановился.\nРезультат появился в аккаунте.\n\nСайты не измерялись —\nэто прямо указано в отчёте.",
    image: "v31-mobile-report.png",
    notes:
      "Локальная отдельная SQLite browser-v31.db. Настоящие браузерные действия: таймер/reload/заметка/самоотметка/sync. Мобильные секунды не являются измерением чужих приложений.",
  },
  {
    title: "Web, Chrome и мобильная PWA",
    body: "Компьютер + Chrome\nИзмеренные интервалы активных сайтов,\nконтекстные решения и отчёты.\n\nМобильная PWA\nАккаунт, правила, отчёты, личный таймер.\nБез мониторинга других приложений.",
    image: "v31-mobile-timer.png",
    notes:
      "Manifest, SW, icons 192/512/maskable, safe-area и bottom nav реализованы. Физическая установка на телефон и публичный HTTPS ещё не проверены.",
  },
  {
    title: "Архитектура и постоянное хранение",
    body: "Web / PWA / Chrome → единый Express API\nОбщие контракты Zod и TypeScript\n\nLocal: SQLite, существующие данные сохранены\nProduction: подготовлен PostgreSQL + Vercel Node API\n\nПеред SQLite-миграцией — проверенный ZIP backup.",
    notes:
      "Отдельные Prisma schema/client/migrations. Реальная проверка PostgreSQL 18 пройдена в временном локальном кластере. Cloud deployment/перенос личных данных не выполнялись.",
  },
  {
    title: "Приватность и надёжность",
    body: "Argon2id · HttpOnly/Secure cookie · хеши токенов\nCookie сайта не передаётся в расширение\n\nОчередь привязана к аккаунту и устройству\nПовтор PUT не создаёт второй отчёт\n\nAPI и личные отчёты не кешируются PWA\nЭкспорт JSON/CSV, отзыв устройства, удаление данных",
    notes:
      "HTTP/SQLite и PostgreSQL проверяют реальные API. Origin/CSRF/pairing сохранены. Rate limit общий в БД, не память отдельной Functions.",
  },
  {
    title: "Фактические проверки",
    body: "19 автоматических тестов прошли\n\nЧистый npm ci → миграции → typecheck → сборка\nНастоящие SQLite + HTTP и PostgreSQL 18\nБраузер: таймер, reload, sync, мобильный отчёт\nDecision expiry, deadline, owner isolation, pairing, PWA cache",
    notes:
      "Подробности docs/test-report.md. Публичные HTTPS проверки и физическая установка не выполнялись: требуется Vercel team grant.",
  },
  {
    title: "Экономика — проверяемая гипотеза",
    body: "Бесплатные базовые сессии.\nПлатные расширенные личные отчёты.\n\nСоциальные показатели:\nсоблюдение собственного бюджета,\nзавершённые сессии,\nсамоотмеченное выполнение задачи.",
    notes:
      "Спрос, выручка, интервью и эффект на здоровье/оценки не заявляются. Платежей в MVP нет. Hobby только для личного некоммерческого использования.",
  },
  {
    title: "Что осталось перед публичным демо",
    body: "Подтвердить доступ Vercel к team amin-038b\n\nЗатем: отдельный Nazar → Postgres → preview → production\nКонфигурация и проверяемые сборки подготовлены\n\nСледом: испытания со студентами, Android/iPhone, RU/KZ\n\nПубличный URL не выдуман. Qarnaq Academy не изменён.",
    notes:
      "Vercel API 403 missing team grant; CLI loggedIn:false. Проект, имя и публичный адрес не созданы/не подтверждены. Следующий шаг — authorize_team_access.",
  },
  {
    title: "Команда и сдача",
    body: "Команда: заполнить реальные имена, роли и контакты\n\nДо 9 ноября 2026, 23:59:\nкод в назначенный репозиторий hackathon.kz,\nPDF pitch и доступное live-демо или открытое видео.\n\nREADME · docs/deployment.md · docs/demo-script.md",
    notes:
      "Состав команды, видео, Git-история и даты авторства не фабриковались. Инструменты AI в разработке указаны в provenance.",
  },
];
for (const data of slides) {
  const s = slide(data.cover ? "" : data.title, data.notes, data.cover);
  if (data.cover) {
    text(s, data.title, 72, 100, 1100, 150, 100, "#F5F7EF", true);
    text(s, data.body, 78, 300, 1100, 180, 38, C.pale);
    text(
      s,
      "National Founder Cup Shymkent 2026 · Digital Economy & Future Tech",
      78,
      620,
      1120,
      45,
      20,
      C.pale,
    );
  } else if (data.wide) {
    await image(s, data.image, 72, 157, 1130, 460);
    text(s, data.caption, 72, 635, 1120, 40, 21, C.muted);
  } else {
    text(
      s,
      data.body,
      72,
      190,
      data.image ? 760 : 1130,
      440,
      data.image ? 29 : 30,
    );
    if (data.image) await image(s, data.image, 890, 165, 285, 490);
  }
}
for (let i = 0; i < p.slides.items.length; i++) {
  const png = await p.export({
    slide: p.slides.items[i],
    format: "png",
    scale: 1,
  });
  await fs.writeFile(
    path.join(tmp, `slide-${i + 1}.png`),
    new Uint8Array(await png.arrayBuffer()),
  );
}
await (
  await PresentationFile.exportPptx(p)
).save(path.join(tmp, "candidate.pptx"));
const { finalizePresentation } = await import(
  pathToFileURL(path.join(skill, "container_tools/artifact_tool_utils.mjs"))
    .href
);
const result = await finalizePresentation({
  workspaceDir: root,
  candidatePath: path.join(tmp, "candidate.pptx"),
  finalPath: path.join(root, "docs/pitch-deck-v3.1.pptx"),
  pythonExecutable: path.join(runtime, "python/python.exe"),
  integrityValidatorPath: path.join(
    skill,
    "container_tools/inspect_presentation_package_integrity.py",
  ),
  layoutValidatorPath: path.join(
    skill,
    "container_tools/inspect_presentation_layout_geometry.py",
  ),
  layoutArgs: [
    "--expected-slide-size-emu",
    "12192000,6858000",
    "--validate-bullet-geometry",
    "--validate-heading-fit",
  ],
  fontPolicy: { basis: "design", families: ["Segoe UI"] },
  explicitTotalSlideCount: 12,
  requiredNativeTableOwnerSlides: [],
  requiredNativeChartOwnerSlides: [],
  verifyArtifactToolImport: true,
  receiptPath: path.join(tmp, "validation.json"),
});
console.log(JSON.stringify(result));
