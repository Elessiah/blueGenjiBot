import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { Bdd } from "../../bdd/Bdd.js";
import { ranks, services } from "../../utils/globals.js";

/**
 * Caractérisation, à l'octet près, de ce que `Bdd.initDatabase` envoie à
 * SQLite : chaque instruction, dans l'ordre, avec ses paramètres, et le
 * libellé de chaque étape. Une base factice enregistre les appels ; les
 * empreintes ont été relevées avant la mise en commun des étapes du schéma
 * (`Bdd.schemaSteps()`), qui ne devait rien changer.
 */

type Call = [method: string, sql: string, params?: unknown];

/** Base factice : enregistre chaque appel ; `failExec` fait échouer tout `exec`. */
function recorder(calls: Call[], failExec = false) {
  return {
    exec: async (sql: string) => {
      calls.push(["exec", sql]);
      if (failExec) throw new TypeError("exec refusé");
    },
    get: async (sql: string, params?: unknown) => { calls.push(["get", sql, params]); return undefined; },
    all: async (sql: string, params?: unknown) => { calls.push(["all", sql, params]); return []; },
    run: async (sql: string, params?: unknown) => { calls.push(["run", sql, params]); },
  };
}

/** Joue `initDatabase` sur la base factice, console relevée. */
async function play(t: test.TestContext, failExec = false): Promise<{ calls: Call[]; errors: unknown[][] }> {
  const calls: Call[] = [];
  const errors: unknown[][] = [];
  t.mock.method(console, "log", () => {});
  t.mock.method(console, "error", (...parts: unknown[]) => { errors.push(parts); });
  const bdd = new Bdd(":memory:");
  Object.assign(bdd, { Database: recorder(calls, failExec) });
  await bdd.initDatabase();
  t.mock.restoreAll();
  return { calls, errors };
}

const sha256 = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");

test("instructions envoyées : mêmes textes, même ordre, mêmes paramètres", async (t) => {
  const { calls, errors } = await play(t);
  assert.deepEqual(errors, []);
  // 34 `exec` (28 créations ou réglages, PRAGMA et ALTER de ChannelPartner,
  // 4 ALTER de Ban), 5 `get` (une colonne vérifiée chacun), puis un `all` et
  // un `run` par service et par rang semés, et le `run` qui remet au texte
  // bilingue les rappels d'adhésion à l'ancien texte par défaut.
  assert.equal(calls.filter(([m]) => m === "all").length, services.length + ranks.length);
  assert.equal(calls.filter(([m]) => m === "run").length, services.length + ranks.length + 1);
  assert.equal(calls.length, 34 + 5 + 2 * (services.length + ranks.length) + 1);
  // Empreintes du jeu d'instructions (EF-14 : colonnes d'avis de Ban, remise des rappels d'adhésion ; la table des avis à retirer, créée en dernier, est hors du préfixe).
  assert.equal(sha256(calls.slice(0, -1)), "d50f6914cdf1a6ebb1d099ff102d1dc250204769c1d7cc973532d2a3faab7059");
  assert.equal(sha256(calls), "eac38ac2ffd5d7c31385bca57e586763941d8974fefe2221e12efe788bfe2b5d");
});

test("chaque étape en échec : son libellé, dans l'ordre, une fois", async (t) => {
  const { calls, errors } = await play(t, true);
  assert.deepEqual(errors.map((parts) => parts[0]), [
    "secure_delete error: ", "busy_timeout error: ", "OGMsg :", "MessageService : ", "DPMsg : ",
    "ChannelPartner : ", "Service&Co", "ChannelPartnerService : ", "Ban : ", "Error rank filter : ",
    "ChannelPartnerRank: ", "AdhesionInterval error: ", "RoleAdmin error: ", "ServerModule error: ",
    "FeedEvent error: ", "DailySnapshot error: ", "Scrim error: ", "Recrute error: ", "UserLink error: ",
    "ServerModule oauth cleanup error: ", "ServerInvite error: ", "RefereeRole error: ", "SiteVisit error: ",
    "ActivityDaily error: ", "BotOwner error: ", "TournamentLink error: ",
    "MatchVoiceChannel error: ", "BanNoticeWithdrawal error: ",
  ]);
  // Seule l'étape des services joint l'erreur entière à son message.
  assert.deepEqual(errors.map((parts) => parts.length), errors.map((parts) => (parts[0] === "Service&Co" ? 3 : 2)));
  assert.ok(errors.every((parts) => parts[1] === "exec refusé"));
  // Une étape qui échoue s'arrête à sa première instruction ; la remise au
  // texte bilingue des rappels d'adhésion (un `run`, que la base factice ne
  // refuse pas) passe entre AdhesionInterval et RoleAdmin.
  const expected = errors.map(() => "exec");
  expected.splice(12, 0, "run");
  assert.deepEqual(calls.map(([m]) => m), expected);
  assert.equal(sha256(calls.slice(0, -1)), "d63ac99e69ab95e7ae46e38d95fd0dbeead8c0c9aa6f638556cd702fd2bc5b9d");
  assert.equal(sha256(calls), "353b7aadb9f96bbf0149437d65b5025190340a67a8e95cbe2233b45ceb2e4d00");
});
