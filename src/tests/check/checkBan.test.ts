import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";

// Meme montage que `tests/bdd/rawMethod.test.ts` : une base jetable, designee
// **avant** l'import du module, puisque le singleton l'ouvre a son premier appel.
const TMP_DB = path.join(os.tmpdir(), `bgenji-ban-${randomUUID()}.sqlite`);
process.env.BDD_PATH = TMP_DB;
process.env.OWNER_ID = "owner-1";
process.env.INFO_SERV = "admin-channel-1";

import { getBddInstance, closeBddInstance } from "../../bdd/Bdd.js";
import { BAN_NOTICE_INTERVAL_MS, checkBan as checkBanNow, settleBanNotices } from "../../check/checkBan.js";
import type { Client } from "discord.js";

/** `checkBan`, puis l'attente de l'avis parti en arrière-plan. */
async function checkBan(...args: Parameters<typeof checkBanNow>): ReturnType<typeof checkBanNow> {
  const verdict = await checkBanNow(...args);
  await settleBanNotices();
  return verdict;
}

/** Ce que le faux client a recu, pour distinguer « pas appele » de « a echoue ». */
type Trace = { dms: string[]; logs: string[]; deleted: string[] };

/**
 * Faux client Discord.
 *
 * `failing` nomme l'appel qui doit lever, ce qui est tout l'objet de ces tests :
 * chacune de ces trois lectures echoue en exploitation ordinaire (compte
 * supprime, `INFO_SERV` mal renseigne, message de motif efface), et chacune
 * rendait autrefois « pas banni ».
 */
function fakeClient(
  failing: "none" | "user" | "channel" | "message",
  trace: Trace,
): Client {
  // `safeUser` envoie `{ content, files }`, `sendLog` une chaine nue : on
  // enregistre le texte dans les deux cas.
  const sendTo = (bucket: string[]) => async (payload: unknown) => {
    const text = typeof payload === "string"
      ? payload
      : String((payload as { content?: unknown })?.content ?? "");
    bucket.push(text);
    return { id: `msg-${bucket.length}` };
  };
  return {
    users: {
      fetch: async (id: string) => {
        // `sendLog` passe par ici aussi : seul le banni doit pouvoir echouer.
        if (failing === "user" && id !== process.env.OWNER_ID) {
          throw new Error("Unknown User");
        }
        return {
          id,
          send: sendTo(id === process.env.OWNER_ID ? trace.logs : trace.dms),
          createDM: async () => ({
            messages: { delete: async (messageId: string) => { trace.deleted.push(`${id}:${messageId}`); } },
          }),
        };
      },
    },
    channels: {
      fetch: async () => {
        if (failing === "channel") throw new Error("Unknown Channel");
        return {
          send: sendTo(trace.logs),
          messages: {
            fetch: async () => {
              if (failing === "message") throw new Error("Unknown Message");
              return { content: "Spam repete" };
            },
          },
        };
      },
    },
  } as unknown as Client;
}

function newTrace(): Trace {
  return { dms: [], logs: [], deleted: [] };
}

/** Faux client dont les messages privés au banni sont refusés (messages privés fermés). */
function closedDmClient(trace: Trace): Client {
  const base = fakeClient("none", trace) as unknown as { users: { fetch: (id: string) => Promise<unknown> } };
  return {
    ...base,
    users: {
      fetch: async (id: string) => {
        const user = await base.users.fetch(id) as Record<string, unknown>;
        return id === process.env.OWNER_ID ? user : { ...user, send: async () => { throw new Error("Cannot send messages to this user"); } };
      },
    },
  } as unknown as Client;
}

async function banRow(idUser: string): Promise<{ id_notice_user: string | null; notice_user_at: number | null }> {
  const bdd = await getBddInstance();
  const [row] = await bdd.raw<{ id_notice_user: string | null; notice_user_at: number | null }>(
    "SELECT id_notice_user, notice_user_at FROM Ban WHERE id_user = ?", [idUser]);
  return row;
}

const T0 = Date.parse("2026-11-04T10:00:00Z");

async function seedBan(idUser: string): Promise<void> {
  const bdd = await getBddInstance();
  await bdd.set("Ban", ["id_user", "id_moderator", "id_reason"], [idUser, "mod-1", "reason-msg-1"]);
}

test("rend NOT_BANNED quand aucune ligne ne vise le compte", async () => {
  const verdict = await checkBan(fakeClient("none", newTrace()), "libre-1", false);
  assert.equal(verdict, "NOT_BANNED");
});

test("rend BANNED sans rien notifier quand alertUser est false", async () => {
  const trace = newTrace();
  await seedBan("banni-1");
  const verdict = await checkBan(fakeClient("none", trace), "banni-1", false);
  assert.equal(verdict, "BANNED");
  assert.deepEqual(trace.dms, []);
});

test("notifie le banni avec le motif relu au salon d'administration", async () => {
  const trace = newTrace();
  await seedBan("banni-2");
  const verdict = await checkBan(fakeClient("none", trace), "banni-2");
  assert.equal(verdict, "BANNED");
  assert.equal(trace.dms.length, 1);
  assert.match(trace.dms[0], /Spam repete/);
});

// --- Le defaut corrige : la notification ne decide pas du bannissement. ---

test("reste BANNED quand le message de motif a ete efface", async () => {
  // Le cas le plus atteignable des trois : un menage dans le salon
  // d'administration levait les bannissements qu'on venait d'y motiver.
  const trace = newTrace();
  await seedBan("banni-3");
  const verdict = await checkBan(fakeClient("message", trace), "banni-3");
  assert.equal(verdict, "BANNED");
  assert.deepEqual(trace.dms, []);
});

test("reste BANNED quand le compte du banni n'existe plus", async () => {
  const trace = newTrace();
  await seedBan("banni-4");
  const verdict = await checkBan(fakeClient("user", trace), "banni-4");
  assert.equal(verdict, "BANNED");
});

test("reste BANNED quand le salon d'administration est injoignable", async () => {
  const trace = newTrace();
  await seedBan("banni-5");
  const verdict = await checkBan(fakeClient("channel", trace), "banni-5");
  assert.equal(verdict, "BANNED");
});

// --- Le second etat : « on n'a pas pu savoir » n'est pas « pas banni ». ---

test("rend UNKNOWN quand la lecture du verdict echoue", async () => {
  // La table devient introuvable : proxy de la fenetre reelle ou la base est
  // indisponible (verrou de la sauvegarde nocturne, fichier deplace).
  //
  // Un renommage, et non un `DROP` : la table revient **a l'identique** sans
  // qu'on ait a recopier son DDL ici — une copie aurait derive de celle de
  // `Bdd.ts` au premier changement de schema. Et le `finally` retire la
  // dependance a l'ordre des tests : celui-ci abimait la base pour tous les
  // suivants, ce qu'un simple commentaire « a garder en dernier » ne tient pas.
  const bdd = await getBddInstance();
  await bdd.raw("ALTER TABLE Ban RENAME TO Ban_indisponible", []);
  try {
    const verdict = await checkBan(fakeClient("none", newTrace()), "banni-1", false);
    assert.equal(verdict, "UNKNOWN");
  } finally {
    await bdd.raw("ALTER TABLE Ban_indisponible RENAME TO Ban", []);
  }
});

test("retrouve un verdict une fois la base revenue", async () => {
  // Corollaire du test precedent : `UNKNOWN` est un etat passager, pas une
  // panne definitive. Si cette assertion echoue, c'est que la restauration
  // ci-dessus n'a pas eu lieu — donc que l'ordre des tests compte a nouveau.
  const verdict = await checkBan(fakeClient("none", newTrace()), "banni-1", false);
  assert.equal(verdict, "BANNED");
});

test("checkBan_firstAttempt_storesNoticeIdAndTime", async () => {
  const trace = newTrace();
  await seedBan("banni-6");
  await checkBan(fakeClient("none", trace), "banni-6", true, T0);
  assert.deepEqual(await banRow("banni-6"), { id_notice_user: "msg-1", notice_user_at: T0 });
});

test("checkBan_withinInterval_noSecondNotice", async () => {
  const trace = newTrace();
  await seedBan("banni-7");
  await checkBan(fakeClient("none", trace), "banni-7", true, T0);
  const verdict = await checkBan(fakeClient("none", trace), "banni-7", true, T0 + BAN_NOTICE_INTERVAL_MS - 1);
  assert.equal(verdict, "BANNED");
  assert.equal(trace.dms.length, 1);
});

test("checkBan_afterInterval_newNoticeAndPreviousDeleted", async () => {
  const trace = newTrace();
  await seedBan("banni-8");
  await checkBan(fakeClient("none", trace), "banni-8", true, T0);
  await checkBan(fakeClient("none", trace), "banni-8", true, T0 + BAN_NOTICE_INTERVAL_MS);
  assert.equal(trace.dms.length, 2);
  assert.deepEqual(trace.deleted, ["banni-8:msg-1"]);
  assert.deepEqual(await banRow("banni-8"), { id_notice_user: "msg-2", notice_user_at: T0 + BAN_NOTICE_INTERVAL_MS });
});

test("checkBan_concurrentMessages_singleNotice", async () => {
  const trace = newTrace();
  await seedBan("banni-9");
  await Promise.all([
    checkBan(fakeClient("none", trace), "banni-9", true, T0),
    checkBan(fakeClient("none", trace), "banni-9", true, T0),
  ]);
  assert.equal(trace.dms.length, 1);
});

test("checkBan_dmRefused_attemptStillThrottled", async () => {
  const trace = newTrace();
  await seedBan("banni-10");
  await checkBan(closedDmClient(trace), "banni-10", true, T0);
  assert.deepEqual(await banRow("banni-10"), { id_notice_user: null, notice_user_at: T0 });
  const logsAfterFirst = trace.logs.length;
  await checkBan(closedDmClient(trace), "banni-10", true, T0 + 1000);
  // Aucun nouvel essai (ni les trois envois de `safeUser`, ni leur journal).
  assert.equal(trace.logs.length, logsAfterFirst);
});

test("checkBan_unbannedDuringSend_freshNoticeDeleted", async () => {
  const trace = newTrace();
  await seedBan("banni-12");
  const base = fakeClient("none", trace) as unknown as { users: { fetch: (id: string) => Promise<Record<string, unknown>> } };
  const client = {
    ...base,
    users: {
      fetch: async (id: string) => {
        const user = await base.users.fetch(id);
        if (id === process.env.OWNER_ID) { return user; }
        const send = user.send as (payload: unknown) => Promise<{ id: string }>;
        // `/unban` passe pendant l'envoi : la ligne disparait avant l'enregistrement.
        return { ...user, send: async (payload: unknown) => {
          const bdd = await getBddInstance();
          await bdd.raw("DELETE FROM Ban WHERE id_user = ?", ["banni-12"]);
          return send(payload);
        } };
      },
    },
  } as unknown as Client;
  await checkBan(client, "banni-12", true, T0);
  assert.equal(trace.dms.length, 1);
  assert.deepEqual(trace.deleted, ["banni-12:msg-1"]);
});

test("checkBan_recentNoticeInDatabase_noNotice", async () => {
  // Un autre message a déjà réservé l'avis : la réservation conditionnelle refuse.
  const trace = newTrace();
  await seedBan("banni-13");
  const bdd = await getBddInstance();
  await bdd.raw("UPDATE Ban SET notice_user_at = ? WHERE id_user = ?", [T0 - 1000, "banni-13"]);
  await checkBan(fakeClient("none", trace), "banni-13", true, T0);
  assert.deepEqual(trace.dms, []);
});

test("checkBan_notice_datePrintedInParisTime", async () => {
  const trace = newTrace();
  const bdd = await getBddInstance();
  await bdd.set("Ban", ["id_user", "id_moderator", "id_reason", "date"], ["banni-11", "mod-1", "reason-msg-1", "2026-10-26 13:03:00"]);
  await checkBan(fakeClient("none", trace), "banni-11", true, T0);
  assert.match(trace.dms[0], /depuis le 26 octobre 2026 à 14:03 :/);
  assert.doesNotMatch(trace.dms[0], /GMT/);
});

test.after(async () => {
  await closeBddInstance();
  await new Promise((resolve) => setTimeout(resolve, 100));
  try { fs.unlinkSync(TMP_DB); } catch { /* deja parti */ }
});

test("checkBan_noticeRunsInBackground_verdictNotBlocked", async () => {
  const trace = newTrace();
  await seedBan("banni-14");
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const base = fakeClient("none", trace) as unknown as { users: { fetch: (id: string) => Promise<Record<string, unknown>> } };
  const client = {
    ...base,
    users: { fetch: async (id: string) => { await gate; return base.users.fetch(id); } },
  } as unknown as Client;
  const verdict = await checkBanNow(client, "banni-14", true, T0);
  assert.equal(verdict, "BANNED");
  assert.equal(trace.dms.length, 0);
  release();
  await settleBanNotices();
  assert.equal(trace.dms.length, 1);
});

test("checkBan_noticeInstantInFuture_treatedAsStale", async () => {
  const trace = newTrace();
  await seedBan("banni-15");
  const bdd = await getBddInstance();
  // Horloge reculée ou valeur erronée : l'instant gardé est postérieur à « maintenant ».
  await bdd.raw("UPDATE Ban SET notice_user_at = ? WHERE id_user = ?", [T0 + 10 * BAN_NOTICE_INTERVAL_MS, "banni-15"]);
  await checkBan(fakeClient("none", trace), "banni-15", true, T0);
  assert.equal(trace.dms.length, 1);
  assert.deepEqual(await banRow("banni-15"), { id_notice_user: "msg-1", notice_user_at: T0 });
});
