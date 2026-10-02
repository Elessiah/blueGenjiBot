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
 * (`SCHEMA_STEPS`), qui ne devait rien changer.
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
  // 29 `exec` (25 créations ou réglages, PRAGMA et ALTER de ChannelPartner,
  // 2 ALTER de Ban), 3 `get` (une colonne vérifiée chacun), puis un `all` et
  // un `run` par service et par rang semés.
  assert.equal(calls.filter(([m]) => m === "all").length, services.length + ranks.length);
  assert.equal(calls.filter(([m]) => m === "run").length, services.length + ranks.length);
  assert.equal(calls.length, 29 + 3 + 2 * (services.length + ranks.length));
  assert.equal(sha256(calls), "8af07e7317c444d4661255e43ab9748e578a93dac41148a8b5d09af577f3ef80");
});

test("chaque étape en échec : son libellé, dans l'ordre, une fois", async (t) => {
  const { calls, errors } = await play(t, true);
  assert.deepEqual(errors.map((parts) => parts[0]), [
    "secure_delete error: ", "busy_timeout error: ", "OGMsg :", "MessageService : ", "DPMsg : ",
    "ChannelPartner : ", "Service&Co", "ChannelPartnerService : ", "Ban : ", "Error rank filter : ",
    "ChannelPartnerRank: ", "AdhesionInterval error: ", "RoleAdmin error: ", "ServerModule error: ",
    "FeedEvent error: ", "DailySnapshot error: ", "Scrim error: ", "Recrute error: ", "UserLink error: ",
    "ServerModule oauth cleanup error: ", "ServerInvite error: ", "RefereeRole error: ", "SiteVisit error: ",
    "ActivityDaily error: ", "BotOwner error: ",
  ]);
  // Seule l'étape des services joint l'erreur entière à son message.
  assert.deepEqual(errors.map((parts) => parts.length), errors.map((parts) => (parts[0] === "Service&Co" ? 3 : 2)));
  assert.ok(errors.every((parts) => parts[1] === "exec refusé"));
  // Une étape qui échoue s'arrête à sa première instruction.
  assert.deepEqual(calls.map(([m]) => m), errors.map(() => "exec"));
  assert.equal(sha256(calls), "e00ad08d0d747be7ab072e382a16e873ed9e71ac1f93d518680ddf8836e42745");
});
