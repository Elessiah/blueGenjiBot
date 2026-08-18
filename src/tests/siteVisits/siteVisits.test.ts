import test from "node:test";
import assert from "node:assert/strict";
import {
  parseSiteVisitStats,
  formatSnapshotAge,
  formatSiteVisitStats,
  type StoredSiteVisitStats,
} from "../../siteVisits/siteVisits.js";

const FULL_PAYLOAD = {
  totalVisits: 1240,
  uniqueVisitors: 310,
  visitsLast24h: 42,
  uniqueVisitorsLast24h: 20,
  visitsLast7Days: 260,
  uniqueVisitorsLast7Days: 95,
  visitsLast30Days: 900,
  uniqueVisitorsLast30Days: 240,
  identifiedVisitors: 58,
  firstVisitAt: "2026-01-05T10:00:00.000Z",
  lastVisitAt: "2026-08-18T09:30:00.000Z",
};

test("parseSiteVisitStats accepte un instantane complet", () => {
  const stats = parseSiteVisitStats(FULL_PAYLOAD);
  assert.deepEqual(stats, FULL_PAYLOAD);
});

test("parseSiteVisitStats complete les champs manquants a zero", () => {
  const stats = parseSiteVisitStats({ totalVisits: 7 });
  assert.ok(stats);
  assert.equal(stats.totalVisits, 7);
  assert.equal(stats.uniqueVisitors, 0);
  assert.equal(stats.visitsLast30Days, 0);
  assert.equal(stats.firstVisitAt, null);
});

test("parseSiteVisitStats neutralise les valeurs aberrantes", () => {
  const stats = parseSiteVisitStats({
    totalVisits: -12,
    uniqueVisitors: "42",
    visitsLast24h: "beaucoup",
    visitsLast7Days: 3.9,
    lastVisitAt: "   ",
  });
  assert.ok(stats);
  assert.equal(stats.totalVisits, 0, "un compteur negatif retombe a 0");
  assert.equal(stats.uniqueVisitors, 42, "une chaine numerique reste exploitable");
  assert.equal(stats.visitsLast24h, 0);
  assert.equal(stats.visitsLast7Days, 3, "un compteur est entier");
  assert.equal(stats.lastVisitAt, null, "une date vide vaut absente");
});

test("parseSiteVisitStats refuse un corps inexploitable", () => {
  assert.equal(parseSiteVisitStats(null), null);
  assert.equal(parseSiteVisitStats("1240"), null);
  assert.equal(parseSiteVisitStats([]), null);
  assert.equal(parseSiteVisitStats({}), null);
  assert.equal(parseSiteVisitStats({ autreChose: 3 }), null);
});

test("parseSiteVisitStats accepte un instantane vierge (site sans visite)", () => {
  const stats = parseSiteVisitStats({ totalVisits: 0, uniqueVisitors: 0 });
  assert.ok(stats);
  assert.equal(stats.totalVisits, 0);
});

test("formatSnapshotAge decrit l'anciennete en francais", () => {
  const now = new Date("2026-08-18T12:00:00.000Z");
  assert.equal(formatSnapshotAge("2026-08-18 11:59:30", now), "il y a moins d'une minute");
  assert.equal(formatSnapshotAge("2026-08-18 11:59:00", now), "il y a 1 minute");
  assert.equal(formatSnapshotAge("2026-08-18 11:30:00", now), "il y a 30 minutes");
  assert.equal(formatSnapshotAge("2026-08-18 09:00:00", now), "il y a 3 heures");
  assert.equal(formatSnapshotAge("2026-08-16 12:00:00", now), "il y a 2 jours");
});

test("formatSnapshotAge tolere une date absente ou illisible", () => {
  const now = new Date("2026-08-18T12:00:00.000Z");
  assert.equal(formatSnapshotAge(null, now), "date inconnue");
  assert.equal(formatSnapshotAge("pas une date", now), "date inconnue");
});

test("formatSnapshotAge ne renvoie jamais une anciennete negative", () => {
  const now = new Date("2026-08-18T12:00:00.000Z");
  // Horloges desynchronisees entre le site et le bot.
  assert.equal(formatSnapshotAge("2026-08-18 12:00:30", now), "il y a moins d'une minute");
});

test("formatSiteVisitStats expose les visites totales et uniques", () => {
  const stored: StoredSiteVisitStats = { ...FULL_PAYLOAD, updatedAt: "2026-08-18 11:55:00" };
  const message = formatSiteVisitStats(stored, new Date("2026-08-18T12:00:00.000Z"));

  assert.match(message, /Visites totales : 1240/);
  assert.match(message, /Visiteurs uniques : 310/);
  assert.match(message, /Dont comptes connectes : 58/);
  assert.match(message, /24 h : 42 visites \/ 20 uniques/);
  assert.match(message, /30 jours : 900 visites \/ 240 uniques/);
  assert.match(message, /il y a 5 minutes/);
});

test("formatSiteVisitStats explique l'absence d'instantane", () => {
  const message = formatSiteVisitStats(null);
  assert.match(message, /Aucune donnee de frequentation/);
});

test("formatSiteVisitStats reste lisible sans date de mise a jour", () => {
  const stored: StoredSiteVisitStats = { ...FULL_PAYLOAD, updatedAt: null };
  const message = formatSiteVisitStats(stored);
  assert.match(message, /date inconnue/);
});
