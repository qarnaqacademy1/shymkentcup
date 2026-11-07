import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  defaults,
  createActive,
  settle,
  pause,
  resume,
  except,
  totals,
  matches,
  domainOf,
  splitDays,
  countVisits,
  canUpload,
  sessionSchema,
} from "@nazar/shared";
const make = () =>
  createActive(
    randomUUID(),
    randomUUID(),
    "Лекция",
    60000,
    { ...defaults, domains: ["youtube.com"], budgetMs: 5000 },
    100000,
  );
test("one active host, tab/domain switches and unfocused window never overlap", () => {
  const a = make();
  a.host = "youtube.com";
  settle(a, 103000);
  a.host = "docs.google.com";
  settle(a, 107000);
  a.host = null;
  settle(a, 120000);
  a.host = "m.youtube.com";
  settle(a, 122000);
  assert.deepEqual(totals(a.session), {
    trackedMs: 9000,
    distractedMs: 5000,
    overBudgetMs: 0,
  });
  assert.equal(a.session.elapsedMs, 22000);
  assert.equal(a.session.warnings.length, 1);
  settle(a, 123000);
  assert.equal(a.session.warnings.length, 1);
  assert.ok(sessionSchema.safeParse(a.session).success);
});
test("pause stops both counters and moves deadline; focus/idle stop only websites", () => {
  const a = make();
  a.host = "youtube.com";
  pause(a, 105000);
  settle(a, 115000);
  resume(a, 125000);
  assert.equal(a.deadline, 180000);
  a.host = null;
  settle(a, 140000);
  assert.equal(a.session.elapsedMs, 20000);
  assert.equal(totals(a.session).trackedMs, 5000);
});
test("late alarm clips at deadline; repeated observation does not double-count", () => {
  const a = make();
  a.host = "youtube.com";
  settle(a, 200000);
  settle(a, 220000);
  assert.equal(totals(a.session).trackedMs, 60000);
  assert.equal(a.session.elapsedMs, 60000);
  assert.equal(a.session.intervals[0].end, 160000);
});
test("exception changes future intervals only, including subdomains", () => {
  const a = make();
  a.host = "youtube.com";
  except(a, "youtube.com", 110000);
  settle(a, 120000);
  a.host = "m.youtube.com";
  settle(a, 130000);
  assert.equal(totals(a.session).distractedMs, 10000);
  assert.equal(totals(a.session).trackedMs, 30000);
  assert.ok(sessionSchema.safeParse(a.session).success);
});
test("rules snapshot independent from settings mutation and boundary-safe domains", () => {
  const settings = { ...defaults, domains: ["youtube.com"] };
  const a = createActive(
    randomUUID(),
    randomUUID(),
    "Test",
    60000,
    settings,
    0,
  );
  settings.domains.push("example.com");
  assert.deepEqual(a.session.rules.domains, ["youtube.com"]);
  assert.ok(matches("m.youtube.com", "youtube.com"));
  assert.ok(!matches("notyoutube.com", "youtube.com"));
  assert.equal(domainOf("https://WWW.YouTube.com/a?q=x"), "youtube.com");
  assert.equal(domainOf("chrome://extensions"), null);
});
test("local midnight and DST split without losing milliseconds", () => {
  const start = Date.parse("2026-11-06T18:59:50Z");
  const parts = splitDays(
    { start, end: start + 20000, domain: "example.com", distracting: true },
    "Asia/Almaty",
  );
  assert.deepEqual(
    parts.map((p) => [p.day, p.ms]),
    [
      ["2026-11-06", 10000],
      ["2026-11-07", 10000],
    ],
  );
  const p = splitDays(
    {
      start: Date.parse("2026-03-08T05:00Z"),
      end: Date.parse("2026-03-09T04:00Z"),
      domain: "example.com",
      distracting: false,
    },
    "America/New_York",
  );
  assert.equal(p.length, 1);
  assert.equal(p[0].ms, 23 * 3600000);
});
test("history counts local visits in half-open period, never total visitCount", () => {
  const visits = Array.from({ length: 100 }, (_, i) => ({
    visitTime: i < 3 ? 110 : 1,
    isLocal: true,
  }));
  assert.equal(countVisits(visits, 100, 200), 3);
  assert.equal(
    countVisits(
      [
        ...visits,
        { visitTime: 150, isLocal: false },
        { visitTime: 200, isLocal: true },
      ],
      100,
      200,
    ),
    3,
  );
  const snapshot = { visits: countVisits(visits, 100, 200) };
  snapshot.visits = countVisits(visits, 100, 200);
  assert.equal(snapshot.visits, 3);
});
test("queue bound to account AND extension instance; expired auth retains data", () => {
  const item = { ownerId: "A", instanceId: "chrome1" };
  assert.ok(canUpload(item, { ownerId: "A", instanceId: "chrome1" }));
  assert.ok(!canUpload(item, { ownerId: "B", instanceId: "chrome1" }));
  assert.ok(!canUpload(item, { ownerId: "A", instanceId: "chrome2" }));
  assert.ok(!canUpload(item, null));
});
test("server schema rejects overlaps, retrospective exceptions and invented totals", () => {
  const a = make();
  a.host = "youtube.com";
  settle(a, 110000);
  a.session.intervals.push({ ...a.session.intervals[0] });
  assert.ok(!sessionSchema.safeParse(a.session).success);
  const b = make();
  b.host = "youtube.com";
  settle(b, 110000);
  b.session.exceptions.push({ domain: "youtube.com", at: 105000 });
  assert.ok(!sessionSchema.safeParse(b.session).success);
});
