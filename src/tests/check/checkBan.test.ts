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
import {
  BAN_NOTICE_INTERVAL_MS,
  BAN_VERDICT_CACHE_MS,
  MAX_QUEUED_BAN_NOTICES,
  checkBan as checkBanNow,
  forgetBanVerdict,
  settleBanNotices,
  stopBanNotices,
} from "../../check/checkBan.js";
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
  // Le verdict gardé pour le relais est oublié avec la ligne.
  assert.equal(await checkBan(client, "banni-12", true, T0 + 1000), "NOT_BANNED");
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

// --- File des avis et verdict gardé pour le relais (EF-14, revue sécurité) ---

/** Faux client dont l'avis de `gatedId` attend `gate` avant de lire le compte. */
function gatedClient(trace: Trace, gatedId: string, gate: Promise<void>): Client {
  const base = fakeClient("none", trace) as unknown as { users: { fetch: (id: string) => Promise<unknown> } };
  return {
    ...base,
    users: {
      fetch: async (id: string) => {
        if (id === gatedId) { await gate; }
        return base.users.fetch(id);
      },
    },
  } as unknown as Client;
}

/** Ouvre une barrière : la promesse et sa levée. */
function newGate(): { gate: Promise<void>; release: () => void } {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  return { gate, release };
}

test("checkBan_manyBannedUsers_noticesSentOneAtATime", async () => {
  const trace = newTrace();
  let active = 0;
  let maxActive = 0;
  const base = fakeClient("none", trace) as unknown as { users: { fetch: (id: string) => Promise<Record<string, unknown>> } };
  // Un avis est « en cours » de la lecture du compte jusqu'à l'envoi du message privé.
  const client = {
    ...base,
    users: {
      fetch: async (id: string) => {
        const user = await base.users.fetch(id);
        if (id === process.env.OWNER_ID) { return user; }
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        const send = user.send as (payload: unknown) => Promise<{ id: string }>;
        return { ...user, send: async (payload: unknown) => { active -= 1; return send(payload); } };
      },
    },
  } as unknown as Client;
  await seedBan("seq-1");
  await seedBan("seq-2");
  await seedBan("seq-3");
  await Promise.all([
    checkBanNow(client, "seq-1", true, T0),
    checkBanNow(client, "seq-2", true, T0),
    checkBanNow(client, "seq-3", true, T0),
  ]);
  await settleBanNotices();
  assert.equal(trace.dms.length, 3);
  assert.equal(maxActive, 1);
});

test("checkBan_queueFull_extraNoticeNotClaimed", async () => {
  const trace = newTrace();
  const { gate, release } = newGate();
  const client = gatedClient(trace, "cap-0", gate);
  for (let index = 0; index < MAX_QUEUED_BAN_NOTICES; index += 1) {
    await seedBan(`cap-${index}`);
    await checkBanNow(client, `cap-${index}`, true, T0);
  }
  await seedBan("cap-extra");

  const verdict = await checkBanNow(client, "cap-extra", true, T0);

  assert.equal(verdict, "BANNED");
  assert.deepEqual(await banRow("cap-extra"), { id_notice_user: null, notice_user_at: null });
  release();
  await settleBanNotices();
  assert.equal(trace.dms.length, MAX_QUEUED_BAN_NOTICES);
  // File dégagée : l'avis non réservé part au message suivant.
  await checkBan(client, "cap-extra", true, T0 + 1000);
  assert.equal(trace.dms.length, MAX_QUEUED_BAN_NOTICES + 1);
  assert.deepEqual(await banRow("cap-extra"), { id_notice_user: `msg-${MAX_QUEUED_BAN_NOTICES + 1}`, notice_user_at: T0 + 1000 });
});

/** Exclu déjà vu par le relais à `T0`, puis ligne effacée directement en base (hors `/unban`). */
async function cachedThenRemoved(idUser: string): Promise<Client> {
  const client = fakeClient("none", newTrace());
  await seedBan(idUser);
  await checkBan(client, idUser, true, T0);
  const bdd = await getBddInstance();
  await bdd.raw("DELETE FROM Ban WHERE id_user = ?", [idUser]);
  return client;
}

test("checkBan_cachedVerdict_noDatabaseRead", async () => {
  const client = await cachedThenRemoved("cache-1");
  assert.equal(await checkBan(client, "cache-1", true, T0 + BAN_VERDICT_CACHE_MS - 1), "BANNED");
});

test("checkBan_cacheExpired_rereadsDatabase", async () => {
  const client = await cachedThenRemoved("cache-2");
  assert.equal(await checkBan(client, "cache-2", true, T0 + BAN_VERDICT_CACHE_MS), "NOT_BANNED");
});

test("checkBan_clockMovedBack_cacheIgnored", async () => {
  const client = await cachedThenRemoved("cache-3");
  assert.equal(await checkBan(client, "cache-3", true, T0 - 1), "NOT_BANNED");
});

test("checkBan_alertUserFalse_neverCached", async () => {
  // `/ban` et les interactions relisent toujours la base.
  const client = await cachedThenRemoved("cache-4");
  assert.equal(await checkBan(client, "cache-4", false, T0 + 1000), "NOT_BANNED");
});

test("forgetBanVerdict_afterUnban_nextCheckNotBanned", async () => {
  const client = await cachedThenRemoved("cache-5");
  forgetBanVerdict("cache-5");
  assert.equal(await checkBan(client, "cache-5", true, T0 + 1000), "NOT_BANNED");
});

test("checkBan_noticeClaimFails_cacheForgotten", async () => {
  const trace = newTrace();
  const { gate, release } = newGate();
  const client = gatedClient(trace, "claim-a", gate);
  await seedBan("claim-a");
  await seedBan("claim-b");
  await checkBanNow(client, "claim-a", true, T0);
  // En file derrière « claim-a » : sa ligne disparaît avant sa réservation.
  await checkBanNow(client, "claim-b", true, T0);
  const bdd = await getBddInstance();
  await bdd.raw("DELETE FROM Ban WHERE id_user = ?", ["claim-b"]);
  release();
  await settleBanNotices();
  assert.equal(trace.dms.length, 1);
  assert.equal(await checkBan(client, "claim-b", true, T0 + 1000), "NOT_BANNED");
});

// --- Revue sécurité EF-14 : avis jamais perdus de vue, cache fidèle à la base ---

/** Faux client dont l'effacement des messages privés lève `error`. */
function failingDeleteClient(trace: Trace, error: Error & { code?: number }): Client {
  const base = fakeClient("none", trace) as unknown as { users: { fetch: (id: string) => Promise<Record<string, unknown>> } };
  return {
    ...base,
    users: {
      fetch: async (id: string) => {
        const user = await base.users.fetch(id);
        return { ...user, createDM: async () => ({ messages: { delete: async () => { throw error; } } }) };
      },
    },
  } as unknown as Client;
}

test("checkBan_previousNoticeNotDeletable_queuedAndNewNoticeSent", async () => {
  // Un effacement durablement refusé ne bloque plus l'avis du jour : l'ancien
  // est remis à la purge de nuit, qui le réessaie.
  const trace = newTrace();
  await seedBan("prev-1");
  const bdd = await getBddInstance();
  await bdd.raw("UPDATE Ban SET id_notice_user = ?, notice_user_at = ? WHERE id_user = ?", ["old-notice", T0 - BAN_NOTICE_INTERVAL_MS, "prev-1"]);

  await checkBan(failingDeleteClient(trace, Object.assign(new Error("Service Unavailable"), { code: 0 })), "prev-1", true, T0);

  assert.equal(trace.dms.length, 1);
  assert.deepEqual(await banRow("prev-1"), { id_notice_user: "msg-1", notice_user_at: T0 });
  assert.deepEqual(await bdd.raw("SELECT id_message FROM BanNoticeWithdrawal WHERE id_user = ?", ["prev-1"]), [{ id_message: "old-notice" }]);
});

test("checkBan_previousNoticeAlreadyGone_newNoticeSent", async () => {
  const trace = newTrace();
  await seedBan("prev-2");
  const bdd = await getBddInstance();
  await bdd.raw("UPDATE Ban SET id_notice_user = ?, notice_user_at = ? WHERE id_user = ?", ["old-notice", T0 - BAN_NOTICE_INTERVAL_MS, "prev-2"]);

  await checkBan(failingDeleteClient(trace, Object.assign(new Error("Unknown Message"), { code: 10008 })), "prev-2", true, T0);

  assert.equal(trace.dms.length, 1);
  assert.deepEqual(await banRow("prev-2"), { id_notice_user: "msg-1", notice_user_at: T0 });
});

test("checkBan_forgottenDuringRead_verdictNotCached", async () => {
  const client = fakeClient("none", newTrace());
  await seedBan("race-1");
  const bdd = await getBddInstance();
  const originalGet = bdd.get;
  // `/unban` passe pendant la lecture : la ligne lue est déjà levée.
  bdd.get = (async (...args: Parameters<typeof originalGet>) => {
    const rows = await originalGet.apply(bdd, args);
    await bdd.raw("DELETE FROM Ban WHERE id_user = ?", ["race-1"]);
    forgetBanVerdict("race-1");
    return rows;
  }) as typeof originalGet;
  try {
    assert.equal(await checkBan(client, "race-1", true, T0), "BANNED");
  } finally {
    bdd.get = originalGet;
  }

  assert.equal(await checkBan(client, "race-1", true, T0 + 1000), "NOT_BANNED");
});

test("checkBan_simultaneousReads_singleCachedRowKeptInSync", async () => {
  const trace = newTrace();
  const client = fakeClient("none", trace);
  await seedBan("twin-1");
  await Promise.all([
    checkBanNow(client, "twin-1", true, T0),
    checkBanNow(client, "twin-1", true, T0),
  ]);
  await settleBanNotices();
  const bdd = await getBddInstance();
  const originalWrite = bdd.write;
  let writes = 0;
  bdd.write = (async (...args: Parameters<typeof originalWrite>) => {
    writes += 1;
    return originalWrite.apply(bdd, args);
  }) as typeof originalWrite;
  try {
    await checkBan(client, "twin-1", true, T0 + 1000);
  } finally {
    bdd.write = originalWrite;
  }

  // Le verdict gardé porte l'essai du jour : aucune réservation de plus.
  assert.equal(writes, 0);
  assert.equal(trace.dms.length, 1);
});

// --- Revue sécurité EF-14, cycle 2 ---

test("checkBan_rebannedWithNewReason_queuedOldNoticeNotStored", async () => {
  const trace = newTrace();
  const { gate, release } = newGate();
  const client = gatedClient(trace, "reban-gate", gate);
  await seedBan("reban-gate");
  await seedBan("reban-1");
  await checkBanNow(client, "reban-gate", true, T0);
  await checkBanNow(client, "reban-1", true, T0);
  // `/unban` puis `/ban` pendant l'attente : nouvelle exclusion, nouveau motif.
  const bdd = await getBddInstance();
  await bdd.raw("UPDATE Ban SET id_reason = ? WHERE id_user = ?", ["reason-new", "reban-1"]);

  release();
  await settleBanNotices();

  assert.equal(trace.dms.length, 1);
  assert.deepEqual(await banRow("reban-1"), { id_notice_user: null, notice_user_at: null });
});

test("checkBan_noticeTimeSlightlyInFuture_treatedAsRecent", async () => {
  const trace = newTrace();
  await seedBan("soon-1");
  const bdd = await getBddInstance();
  // Un message plus récent, traité plus vite, a déjà réservé l'avis.
  await bdd.raw("UPDATE Ban SET notice_user_at = ? WHERE id_user = ?", [T0 + 30 * 60 * 1000, "soon-1"]);

  await checkBan(fakeClient("none", trace), "soon-1", true, T0);

  assert.deepEqual(trace.dms, []);
});

test("checkBan_storeWriteThrows_sentNoticeDeleted", async () => {
  const trace = newTrace();
  await seedBan("store-1");
  const bdd = await getBddInstance();
  const originalWrite = bdd.write;
  bdd.write = (async (...args: Parameters<typeof originalWrite>) => {
    if (args[0].startsWith("UPDATE Ban SET id_notice_user")) { throw new Error("SQLITE_BUSY: database is locked"); }
    return originalWrite.apply(bdd, args);
  }) as typeof originalWrite;
  try {
    await checkBan(fakeClient("none", trace), "store-1", true, T0);
  } finally {
    bdd.write = originalWrite;
  }

  assert.equal(trace.dms.length, 1);
  assert.deepEqual(trace.deleted, ["store-1:msg-1"]);
  assert.match(trace.logs.join("\n"), /Failed to notify banned user/);
});

test("checkBan_otherUserForgotten_verdictStillCached", async () => {
  const client = fakeClient("none", newTrace());
  await seedBan("keep-1");
  const bdd = await getBddInstance();
  const originalGet = bdd.get;
  bdd.get = (async (...args: Parameters<typeof originalGet>) => {
    const rows = await originalGet.apply(bdd, args);
    forgetBanVerdict("someone-else");
    return rows;
  }) as typeof originalGet;
  try {
    await checkBan(client, "keep-1", true, T0);
  } finally {
    bdd.get = originalGet;
  }
  await bdd.raw("DELETE FROM Ban WHERE id_user = ?", ["keep-1"]);

  assert.equal(await checkBan(client, "keep-1", true, T0 + 1000), "BANNED");
});

test("checkBan_noticeColumnsMissing_verdictWithoutNotice", async () => {
  const trace = newTrace();
  const client = fakeClient("none", trace);
  await seedBan("nocol-1");
  const bdd = await getBddInstance();
  // Ajout des colonnes de l'avis échoué au démarrage.
  await bdd.raw("ALTER TABLE Ban DROP COLUMN id_notice_user", []);
  await bdd.raw("ALTER TABLE Ban DROP COLUMN notice_user_at", []);
  try {
    assert.equal(await checkBan(client, "nocol-1", true, T0), "BANNED");
    assert.deepEqual(trace.dms, []);
    assert.deepEqual(trace.logs, []);
  } finally {
    await bdd.raw("ALTER TABLE Ban ADD COLUMN id_notice_user TEXT", []);
    await bdd.raw("ALTER TABLE Ban ADD COLUMN notice_user_at INTEGER", []);
  }
  // Colonnes revenues (restauration, qui oublie tous les verdicts) : l'avis repart.
  forgetBanVerdict();
  await checkBan(client, "nocol-1", true, T0 + 1000);
  assert.equal(trace.dms.length, 1);
});

// --- Revue sécurité EF-14, cycle 3 ---

test("checkBan_sendFails_noRetryAndCodeLogged", async () => {
  const trace = newTrace();
  let sends = 0;
  const base = fakeClient("none", trace) as unknown as { users: { fetch: (id: string) => Promise<Record<string, unknown>> } };
  // Le premier envoi échoue (réponse perdue, ou messages privés fermés), le suivant réussirait.
  const client = {
    ...base,
    users: {
      fetch: async (id: string) => {
        const user = await base.users.fetch(id);
        if (id === process.env.OWNER_ID) { return user; }
        const send = user.send as (payload: unknown) => Promise<{ id: string }>;
        return { ...user, send: async (payload: unknown) => {
          sends += 1;
          if (sends === 1) { throw Object.assign(new Error("Cannot send messages to this user"), { code: 50007 }); }
          return send(payload);
        } };
      },
    },
  } as unknown as Client;
  await seedBan("once-1");

  await checkBan(client, "once-1", true, T0);

  assert.equal(sends, 1);
  assert.deepEqual(trace.dms, []);
  assert.match(trace.logs.join("\n"), /Ban notice not delivered: code 50007/);
  assert.deepEqual(await banRow("once-1"), { id_notice_user: null, notice_user_at: T0 });
});

test("forgetBanVerdict_capReachedDuringRead_verdictStillNotCached", async () => {
  const client = fakeClient("none", newTrace());
  await seedBan("cap-race-1");
  const bdd = await getBddInstance();
  const originalGet = bdd.get;
  // `/unban` pendant la lecture, puis assez d'oublis pour atteindre la borne.
  bdd.get = (async (...args: Parameters<typeof originalGet>) => {
    const rows = await originalGet.apply(bdd, args);
    forgetBanVerdict("cap-race-1");
    for (let index = 0; index < 1000; index += 1) { forgetBanVerdict(`other-${index}`); }
    return rows;
  }) as typeof originalGet;
  try {
    await checkBan(client, "cap-race-1", true, T0);
  } finally {
    bdd.get = originalGet;
  }
  await bdd.raw("DELETE FROM Ban WHERE id_user = ?", ["cap-race-1"]);

  assert.equal(await checkBan(client, "cap-race-1", true, T0 + 1000), "NOT_BANNED");
});

// --- Revue sécurité EF-14, cycle 4 : un avis non gardé qui ne s'efface pas est signalé ---

test("checkBan_unbannedDuringSendAndDeleteFails_withdrawalQueued", async () => {
  const trace = newTrace();
  await seedBan("withdraw-1");
  const base = failingDeleteClient(trace, Object.assign(new Error("Service Unavailable"), { code: 0 })) as unknown as { users: { fetch: (id: string) => Promise<Record<string, unknown>> } };
  const client = {
    ...base,
    users: {
      fetch: async (id: string) => {
        const user = await base.users.fetch(id);
        if (id === process.env.OWNER_ID) { return user; }
        const send = user.send as (payload: unknown) => Promise<{ id: string }>;
        // `/unban` passe pendant l'envoi : l'avis n'a plus de ligne où se ranger.
        return { ...user, send: async (payload: unknown) => {
          const bdd = await getBddInstance();
          await bdd.raw("DELETE FROM Ban WHERE id_user = ?", ["withdraw-1"]);
          return send(payload);
        } };
      },
    },
  } as unknown as Client;

  await checkBan(client, "withdraw-1", true, T0);

  assert.equal(trace.dms.length, 1);
  assert.match(trace.logs.join("\n"), /Ban notice withdrawal postponed to the nightly purge/);
  const bdd = await getBddInstance();
  assert.deepEqual(await bdd.raw("SELECT id_message FROM BanNoticeWithdrawal WHERE id_user = ?", ["withdraw-1"]), [{ id_message: "msg-1" }]);
});

test("checkBan_storeWriteThrowsAndDeleteFails_withdrawalQueuedAndCodeLogged", async () => {
  const trace = newTrace();
  await seedBan("withdraw-2");
  const bdd = await getBddInstance();
  const originalWrite = bdd.write;
  bdd.write = (async (...args: Parameters<typeof originalWrite>) => {
    if (args[0].startsWith("UPDATE Ban SET id_notice_user")) { throw new Error("SQLITE_BUSY: database is locked"); }
    return originalWrite.apply(bdd, args);
  }) as typeof originalWrite;
  try {
    await checkBan(failingDeleteClient(trace, Object.assign(new Error("Service Unavailable"), { code: 0 })), "withdraw-2", true, T0);
  } finally {
    bdd.write = originalWrite;
  }

  assert.equal(trace.dms.length, 1);
  assert.match(trace.logs.join("\n"), /Ban notice withdrawal postponed to the nightly purge/);
  // Le code seul, jamais le texte de l'erreur (il peut citer un identifiant).
  assert.match(trace.logs.join("\n"), /Failed to notify banned user: code inconnu/);
  assert.doesNotMatch(trace.logs.join("\n"), /SQLITE_BUSY/);
});

test("checkBan_noticesStopped_noNoticeSent", async () => {
  // Arrêt du bot : un avis parti pendant l'attente serait coupé à la fermeture de la base.
  const trace = newTrace();
  await seedBan("stop-1");
  stopBanNotices();
  try {
    assert.equal(await checkBan(fakeClient("none", trace), "stop-1", true, T0), "BANNED");
  } finally {
    stopBanNotices(false);
  }

  assert.deepEqual(trace.dms, []);
  assert.deepEqual(await banRow("stop-1"), { id_notice_user: null, notice_user_at: null });
});

test("checkBan_stoppedWhileQueued_noNoticeSent", async () => {
  // Arrêt pendant l'attente en file : l'avis suivant ne part pas.
  const trace = newTrace();
  const { gate, release } = newGate();
  const client = gatedClient(trace, "queued-1", gate);
  await seedBan("queued-1");
  await seedBan("queued-2");
  await checkBanNow(client, "queued-1", true, T0);
  await checkBanNow(client, "queued-2", true, T0);

  stopBanNotices();
  try {
    release();
    await settleBanNotices();
  } finally {
    stopBanNotices(false);
  }

  // L'avis en cours ne part pas non plus : l'arrêt est vu juste avant l'envoi.
  assert.deepEqual(trace.dms, []);
  assert.deepEqual(await banRow("queued-2"), { id_notice_user: null, notice_user_at: null });
});

// --- Revue sécurité EF-14, cycle 8 ---

test("checkBan_noticeForgottenAfterVerdictCached_noWithdrawalAttempted", async () => {
  // La purge de nuit a oublié l'avis après la mise en cache du verdict : rien à effacer.
  const trace = newTrace();
  const client = fakeClient("none", trace);
  await seedBan("stale-1");
  const bdd = await getBddInstance();
  await bdd.raw("UPDATE Ban SET id_notice_user = ?, notice_user_at = ? WHERE id_user = ?", ["old-notice", T0 - BAN_NOTICE_INTERVAL_MS + 500, "stale-1"]);
  await checkBan(client, "stale-1", true, T0);
  await bdd.raw("UPDATE Ban SET id_notice_user = NULL, notice_user_at = ? WHERE id_user = ?", [T0 - BAN_NOTICE_INTERVAL_MS, "stale-1"]);

  await checkBan(client, "stale-1", true, T0 + 1000);

  assert.deepEqual(trace.deleted, []);
  assert.equal(trace.dms.length, 1);
});

test("checkBan_stoppedDuringWithdrawal_claimReleased", async () => {
  // Arrêt pendant le retrait de l'ancien avis : la réservation est rendue.
  const trace = newTrace();
  const base = fakeClient("none", trace) as unknown as { users: { fetch: (id: string) => Promise<Record<string, unknown>> } };
  const client = {
    ...base,
    users: {
      fetch: async (id: string) => ({
        ...await base.users.fetch(id),
        createDM: async () => ({ messages: { delete: async () => { stopBanNotices(); } } }),
      }),
    },
  } as unknown as Client;
  await seedBan("stop-c");
  const bdd = await getBddInstance();
  await bdd.raw("UPDATE Ban SET id_notice_user = ?, notice_user_at = ? WHERE id_user = ?", ["old-notice", T0 - BAN_NOTICE_INTERVAL_MS, "stop-c"]);

  try {
    await checkBan(client, "stop-c", true, T0);
  } finally {
    stopBanNotices(false);
  }

  assert.deepEqual(trace.dms, []);
  assert.equal((await banRow("stop-c")).notice_user_at, null);
});

test("checkBan_stoppedDuringWithdrawal_otherBanReservationKept", async () => {
  // La réservation rendue est celle de **cette** exclusion (`id_reason`), jamais une autre.
  const trace = newTrace();
  const base = fakeClient("none", trace) as unknown as { users: { fetch: (id: string) => Promise<Record<string, unknown>> } };
  const bdd = await getBddInstance();
  const client = {
    ...base,
    users: {
      fetch: async (id: string) => ({
        ...await base.users.fetch(id),
        createDM: async () => ({ messages: { delete: async () => {
          // Levée puis nouvelle exclusion pendant le retrait, réservée au même instant.
          await bdd.raw("UPDATE Ban SET id_reason = ? WHERE id_user = ?", ["reason-msg-2", "stop-d"]);
          stopBanNotices();
        } } }),
      }),
    },
  } as unknown as Client;
  await seedBan("stop-d");
  await bdd.raw("UPDATE Ban SET id_notice_user = ?, notice_user_at = ? WHERE id_user = ?", ["old-notice", T0 - BAN_NOTICE_INTERVAL_MS, "stop-d"]);

  try {
    await checkBan(client, "stop-d", true, T0);
  } finally {
    stopBanNotices(false);
  }

  assert.equal((await banRow("stop-d")).notice_user_at, T0);
});

test("checkBan_stopReleaseFails_reservationKeptAndLoggedLocally", async () => {
  // Base qui ferme pendant l'arrêt : la réservation reste, dite au journal local (pas à Discord).
  const trace = newTrace();
  const base = fakeClient("none", trace) as unknown as { users: { fetch: (id: string) => Promise<Record<string, unknown>> } };
  const client = {
    ...base,
    users: {
      fetch: async (id: string) => ({
        ...await base.users.fetch(id),
        createDM: async () => ({ messages: { delete: async () => { stopBanNotices(); } } }),
      }),
    },
  } as unknown as Client;
  await seedBan("stop-e");
  const bdd = await getBddInstance();
  await bdd.raw("UPDATE Ban SET id_notice_user = ?, notice_user_at = ? WHERE id_user = ?", ["old-notice", T0 - BAN_NOTICE_INTERVAL_MS, "stop-e"]);
  const original = bdd.write.bind(bdd);
  bdd.write = async (query: string, values?: unknown[]) => {
    if (query.startsWith("UPDATE Ban SET notice_user_at = NULL")) { throw new Error("Database is not open"); }
    return original(query, values);
  };

  const localErrors: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => { localErrors.push(args.map(String).join(" ")); };
  try {
    await checkBan(client, "stop-e", true, T0);
  } finally {
    console.error = originalError;
    bdd.write = original;
    stopBanNotices(false);
  }

  assert.ok(localErrors.some((line) => line.includes("Ban notice reservation not released")), JSON.stringify(localErrors));
  assert.ok(!trace.logs.some((log) => log.includes("reservation")));
  assert.equal((await banRow("stop-e")).notice_user_at, T0);
});
