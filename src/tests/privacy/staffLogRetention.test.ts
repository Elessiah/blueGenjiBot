import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const TMP_DB = path.join(os.tmpdir(), `bgenji-stafflog-${randomUUID()}.sqlite`);
process.env.BDD_PATH = TMP_DB;

import type { Client } from "discord.js";
import { closeBddInstance, getBddInstance } from "../../bdd/Bdd.js";
import { BAN_NOTICE_WITHDRAWAL_RETRY_DAYS } from "../../privacy/retentionPeriods.js";
import {
  MAX_NOTICE_WITHDRAWALS_PER_RUN,
  deleteDirectMessage,
  retryBanNoticeWithdrawals,
  withdrawBanNotice,
  banMessageIds,
  deleteBanMessages,
  MAX_LOG_PAGES_PER_RUN,
  purgeLogChannel,
  purgeStaffLogs,
  selectExpiredLogMessages,
  type LogChannelLike,
  type LogMessageLike,
} from "../../privacy/staffLogRetention.js";
import { STAFF_LOG_RETENTION_DAYS } from "../../privacy/retentionPeriods.js";
import type { Ban } from "../../bdd/types.js";

const BOT = "500000000000000001";
const STAFF = "500000000000000002";
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-10-01T00:00:00.000Z");
const CUTOFF = NOW - STAFF_LOG_RETENTION_DAYS * DAY;

/** Salon factice : messages triés par identifiant croissant, pages de `pageSize`. */
function fakeChannel(specs: { id: number; author: string; ageDays: number }[], pageSize = 100) {
  const deleted: string[] = [];
  const messages: LogMessageLike[] = specs.map((spec) => ({
    id: String(spec.id),
    authorId: spec.author,
    createdTimestamp: NOW - spec.ageDays * DAY,
    delete: async () => {
      deleted.push(String(spec.id));
    },
  }));
  let fetches = 0;
  const channel: LogChannelLike = {
    fetchAfter: async (after) => {
      fetches++;
      return messages.filter((m) => BigInt(m.id) > BigInt(after)).slice(0, pageSize);
    },
  };
  return { channel, deleted, fetches: () => fetches };
}

test("la durée du journal du staff est d'un an", () => {
  assert.equal(STAFF_LOG_RETENTION_DAYS, 365);
});

test("banMessageIds rend les identifiants renseignés d'une exclusion", () => {
  const ban: Ban = {
    id_user: "1",
    id_moderator: "2",
    id_reason: "10",
    date: new Date(),
    id_reason_owner: "11",
    id_notice_admin: "12",
  };
  assert.deepEqual(banMessageIds(ban), ["10", "11", "12"]);
  assert.deepEqual(banMessageIds({ ...ban, id_reason_owner: null }), ["10", "12"]);
  // Exclusion antérieure aux colonnes : seul le motif au salon.
  assert.deepEqual(banMessageIds({ id_user: "1", id_moderator: "2", id_reason: "10", date: new Date() }), ["10"]);
});

test("selectExpiredLogMessages : messages du bot, périmés, non protégés", () => {
  const page: LogMessageLike[] = [
    { id: "1", authorId: BOT, createdTimestamp: CUTOFF - 1, delete: async () => {} },
    { id: "2", authorId: STAFF, createdTimestamp: CUTOFF - 1, delete: async () => {} },
    { id: "3", authorId: BOT, createdTimestamp: CUTOFF - 1, delete: async () => {} },
    { id: "4", authorId: BOT, createdTimestamp: CUTOFF, delete: async () => {} },
  ];
  const ids = selectExpiredLogMessages(page, CUTOFF, BOT, new Set(["3"])).map((m) => m.id);
  assert.deepEqual(ids, ["1"]);
});

test("purgeLogChannel parcourt les pages et s'arrête au premier message récent", async () => {
  const specs = [
    { id: 1, author: BOT, ageDays: 800 },
    { id: 2, author: STAFF, ageDays: 700 },
    { id: 3, author: BOT, ageDays: 600 },
    { id: 4, author: BOT, ageDays: 500 },
    { id: 5, author: BOT, ageDays: 10 },
    { id: 6, author: BOT, ageDays: 1 },
  ];
  const { channel, deleted, fetches } = fakeChannel(specs, 2);
  const removed = await purgeLogChannel(channel, CUTOFF, BOT, new Set(["4"]));
  assert.deepEqual(removed, { deleted: 2, resumeAfter: "0" });
  assert.deepEqual(deleted, ["1", "3"]);
  // Pages [1,2], [3,4], [5,6] : la troisième contient un message récent, fin.
  assert.equal(fetches(), 3);
});

test("purgeLogChannel respecte le budget de suppressions", async () => {
  const specs = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, author: BOT, ageDays: 400 }));
  const { channel, deleted } = fakeChannel(specs, 4);
  // Budget épuisé dans la première page : la reprendre en entier.
  assert.deepEqual(await purgeLogChannel(channel, CUTOFF, BOT, new Set(), 3), { deleted: 3, resumeAfter: "0" });
  assert.deepEqual(deleted, ["1", "2", "3"]);
  // Budget épuisé pile en fin de page : reprendre après elle.
  const second = fakeChannel(specs, 4);
  assert.deepEqual(await purgeLogChannel(second.channel, CUTOFF, BOT, new Set(), 4), { deleted: 4, resumeAfter: "4" });
  assert.deepEqual(await purgeLogChannel(second.channel, CUTOFF, BOT, new Set(), 4, "4"), { deleted: 4, resumeAfter: "8" });
  assert.deepEqual(second.deleted, ["1", "2", "3", "4", "5", "6", "7", "8"]);
});

test("purgeLogChannel : une suppression refusée n'interrompt pas la passe", async () => {
  const page: LogMessageLike[] = [
    { id: "1", authorId: BOT, createdTimestamp: CUTOFF - DAY, delete: async () => Promise.reject(new Error("Unknown Message")) },
    { id: "2", authorId: BOT, createdTimestamp: CUTOFF - DAY, delete: async () => {} },
  ];
  let served = false;
  const channel: LogChannelLike = {
    fetchAfter: async () => {
      if (served) return [];
      served = true;
      return page;
    },
  };
  assert.equal((await purgeLogChannel(channel, CUTOFF, BOT, new Set())).deleted, 1);
});

test("purgeStaffLogs : un salon du staff injoignable n'empêche pas la purge des messages privés", async () => {
  process.env.INFO_SERV = "700000000000000001";
  process.env.OWNER_ID = "700000000000000002";
  const deleted: string[] = [];
  const old = {
    id: "10",
    author: { id: BOT },
    createdTimestamp: Date.now() - 400 * DAY,
    delete: async () => {
      deleted.push("10");
    },
  };
  let served = false;
  const client = {
    isReady: () => true,
    user: { id: BOT },
    channels: {
      fetch: async () => {
        throw new Error("Unknown Channel");
      },
    },
    users: {
      fetch: async () => ({
        createDM: async () => ({
          messages: {
            fetch: async () => {
              if (served) return new Map();
              served = true;
              return new Map([["10", old]]);
            },
          },
        }),
      }),
    },
  } as unknown as Client;
  await assert.rejects(purgeStaffLogs(client), /Unknown Channel/);
  assert.deepEqual(deleted, ["10"]);
});

test("purgeLogChannel s'arrête au plafond de pages sur un historique sans fin", async () => {
  let fetches = 0;
  let next = 1;
  const channel: LogChannelLike = {
    fetchAfter: async () => {
      fetches++;
      // Que des messages du staff, anciens : rien à supprimer, toujours une page de plus.
      return [{ id: String(next++), authorId: STAFF, createdTimestamp: CUTOFF - DAY, delete: async () => {} }];
    },
  };
  const result = await purgeLogChannel(channel, CUTOFF, BOT, new Set());
  assert.equal(result.deleted, 0);
  assert.equal(fetches, MAX_LOG_PAGES_PER_RUN);
  // La passe suivante reprend là où celle-ci s'est arrêtée, pas au début.
  assert.equal(result.resumeAfter, String(MAX_LOG_PAGES_PER_RUN));
});

test.after(async () => {
  await closeBddInstance();
  await new Promise((r) => setTimeout(r, 50));
  try { fs.unlinkSync(TMP_DB); } catch { /* noop */ }
});

/** Faux client pour `deleteBanMessages` : relève chaque suppression par conversation. */
function banClient(deleted: string[], unreachableUser: string | null = null): Client {
  const conversation = (owner: string) => ({
    messages: { delete: async (id: string) => { deleted.push(`${owner}:${id}`); } },
  });
  return {
    channels: { fetch: async () => conversation("salon") },
    users: {
      fetch: async (id: string) => {
        if (id === unreachableUser) { throw new Error("Unknown User"); }
        return { createDM: async () => conversation(id) };
      },
    },
  } as unknown as Client;
}

const BAN: Ban = {
  id_user: "600000000000000001",
  id_moderator: "600000000000000002",
  id_reason: "reason-1",
  date: new Date(0),
  id_reason_owner: null,
  id_notice_admin: null,
  id_notice_user: "notice-1",
};

test("deleteBanMessages_noticeUserSet_deletesDmInBannedUsersConversation", async () => {
  process.env.INFO_SERV = "info-1";
  const deleted: string[] = [];
  const count = await deleteBanMessages(banClient(deleted), BAN);
  assert.equal(count, 2);
  assert.deepEqual(deleted.sort(), ["600000000000000001:notice-1", "salon:reason-1"]);
});

test("deleteBanMessages_noNoticeUser_bannedUserNotFetched", async () => {
  process.env.INFO_SERV = "info-1";
  const deleted: string[] = [];
  await deleteBanMessages(banClient(deleted), { ...BAN, id_notice_user: null });
  assert.deepEqual(deleted, ["salon:reason-1"]);
});

test("deleteBanMessages_bannedUserUnreachable_otherMessagesStillDeleted", async () => {
  process.env.INFO_SERV = "info-1";
  const deleted: string[] = [];
  const count = await deleteBanMessages(banClient(deleted, BAN.id_user), BAN);
  assert.equal(count, 1);
  assert.deepEqual(deleted, ["salon:reason-1"]);
});

// --- Revue sécurité EF-14, cycle 4 : un avis resté chez l'exclu est signalé ---

/** Faux client dont l'effacement de l'avis lève `noticeError` ; relève les journaux du salon. */
function noticeFailureClient(logs: string[], noticeError: (Error & { code?: number }) | null, unreachableUser: string | null = null): Client {
  const conversation = (owner: string) => ({
    send: async (payload: { content: string }) => { logs.push(payload.content); return { id: "log-1" }; },
    messages: { delete: async (id: string) => {
      if (owner === BAN.id_user && noticeError) { throw noticeError; }
      return id;
    } },
  });
  return {
    channels: { fetch: async () => conversation("salon") },
    users: {
      fetch: async (id: string) => {
        if (id === unreachableUser) { throw new Error("Unknown User"); }
        return { id, send: async () => ({ id: "dm-1" }), createDM: async () => conversation(id) };
      },
    },
  } as unknown as Client;
}

/** Avis en attente de retrait, tels que la table les garde. */
async function pendingWithdrawals(): Promise<unknown[]> {
  const bdd = await getBddInstance();
  return bdd.raw("SELECT id_user, id_message, queued_at FROM BanNoticeWithdrawal ORDER BY id_message");
}

async function clearWithdrawals(): Promise<void> {
  const bdd = await getBddInstance();
  await bdd.raw("DELETE FROM BanNoticeWithdrawal");
}

const UNAVAILABLE = (): Error & { code?: number } => Object.assign(new Error("Service Unavailable"), { code: 0 });
const RETRY_WINDOW_MS = BAN_NOTICE_WITHDRAWAL_RETRY_DAYS * DAY;

test("deleteBanMessages_noticeDeleteFails_withdrawalQueued", async () => {
  process.env.INFO_SERV = "info-1";
  await clearWithdrawals();
  const logs: string[] = [];
  const client = noticeFailureClient(logs, UNAVAILABLE());

  const count = await deleteBanMessages(client, BAN);

  assert.equal(count, 1);
  assert.deepEqual(logs, ["Ban notice withdrawal postponed to the nightly purge"]);
  assert.equal((await pendingWithdrawals()).length, 1);
});

test("deleteBanMessages_noticeAlreadyGone_noWithdrawLog", async () => {
  process.env.INFO_SERV = "info-1";
  await clearWithdrawals();
  const logs: string[] = [];
  const client = noticeFailureClient(logs, Object.assign(new Error("Unknown Message"), { code: 10008 }));

  await deleteBanMessages(client, BAN);

  assert.deepEqual(logs, []);
  assert.deepEqual(await pendingWithdrawals(), []);
});

test("deleteBanMessages_bannedUserUnreachable_withdrawalQueued", async () => {
  process.env.INFO_SERV = "info-1";
  await clearWithdrawals();
  const logs: string[] = [];
  const client = noticeFailureClient(logs, null, BAN.id_user);

  await deleteBanMessages(client, BAN);

  assert.deepEqual(logs, ["Ban notice withdrawal postponed to the nightly purge"]);
});

test("withdrawBanNotice_deleteFails_queuedForNightlyPurge", async () => {
  await clearWithdrawals();
  const logs: string[] = [];

  const outcome = await withdrawBanNotice(noticeFailureClient(logs, UNAVAILABLE()), BAN.id_user, "notice-q", NOW);

  assert.equal(outcome, "queued");
  assert.deepEqual(await pendingWithdrawals(), [{ id_user: BAN.id_user, id_message: "notice-q", queued_at: NOW }]);
  assert.deepEqual(logs, ["Ban notice withdrawal postponed to the nightly purge"]);
});

test("retryBanNoticeWithdrawals_deleteNowSucceeds_rowRemoved", async () => {
  await clearWithdrawals();
  await withdrawBanNotice(noticeFailureClient([], UNAVAILABLE()), BAN.id_user, "notice-r", NOW);
  const deleted: string[] = [];

  const settled = await retryBanNoticeWithdrawals(banClient(deleted), NOW + DAY);

  assert.equal(settled, 1);
  assert.deepEqual(deleted, [`${BAN.id_user}:notice-r`]);
  assert.deepEqual(await pendingWithdrawals(), []);
});

test("retryBanNoticeWithdrawals_stillFailingWithinRetryWindow_rowKept", async () => {
  await clearWithdrawals();
  await withdrawBanNotice(noticeFailureClient([], UNAVAILABLE()), BAN.id_user, "notice-k", NOW);

  const settled = await retryBanNoticeWithdrawals(noticeFailureClient([], UNAVAILABLE()), NOW + DAY);

  assert.equal(settled, 0);
  assert.equal((await pendingWithdrawals()).length, 1);
});

test("retryBanNoticeWithdrawals_stillFailingAfterRetryWindow_rowDroppedAndLogged", async () => {
  await clearWithdrawals();
  await withdrawBanNotice(noticeFailureClient([], UNAVAILABLE()), BAN.id_user, "notice-x", NOW);
  const logs: string[] = [];

  const settled = await retryBanNoticeWithdrawals(noticeFailureClient(logs, UNAVAILABLE()), NOW + RETRY_WINDOW_MS);

  assert.equal(settled, 1);
  assert.deepEqual(await pendingWithdrawals(), []);
  assert.deepEqual(logs, ["Ban notice withdrawal abandoned after 30 days"]);
});

// --- Revue sécurité EF-14, cycle 6 : refus définitifs, échéance, oubli de l'avis ---

const REFUSED = (code: number): Error & { code?: number } => Object.assign(new Error("Refused"), { code });

test("withdrawBanNotice_discordRefusesForGood_refusedAndNotQueued", async () => {
  await clearWithdrawals();
  const logs: string[] = [];

  const outcome = await withdrawBanNotice(noticeFailureClient(logs, REFUSED(50001)), BAN.id_user, "notice-f", NOW);

  assert.equal(outcome, "refused");
  assert.deepEqual(await pendingWithdrawals(), []);
  assert.deepEqual(logs, ["Ban notice withdrawal refused by Discord"]);
});

test("withdrawBanNotice_queuedNoticeNowGone_rowRemoved", async () => {
  await clearWithdrawals();
  await withdrawBanNotice(noticeFailureClient([], UNAVAILABLE()), BAN.id_user, "notice-g", NOW);

  const outcome = await withdrawBanNotice(banClient([]), BAN.id_user, "notice-g", NOW + 1);

  assert.equal(outcome, "gone");
  assert.deepEqual(await pendingWithdrawals(), []);
});

test("retryBanNoticeWithdrawals_lastNightBeforeDeadline_rowDroppedAndBanForgetsNotice", async () => {
  // La purge passe une fois par nuit : à 29 jours, la suivante dépasserait les 30 annoncés.
  await clearWithdrawals();
  const bdd = await getBddInstance();
  await bdd.raw("DELETE FROM Ban WHERE id_user = ?", [BAN.id_user]);
  await bdd.set("Ban", ["id_user", "id_moderator", "id_reason"], [BAN.id_user, BAN.id_moderator, BAN.id_reason]);
  await bdd.raw("UPDATE Ban SET id_notice_user = ? WHERE id_user = ?", ["notice-d", BAN.id_user]);
  await withdrawBanNotice(noticeFailureClient([], UNAVAILABLE()), BAN.id_user, "notice-d", NOW);

  const settled = await retryBanNoticeWithdrawals(noticeFailureClient([], UNAVAILABLE()), NOW + 29 * DAY);

  assert.equal(settled, 1);
  assert.deepEqual(await pendingWithdrawals(), []);
  // Sans quoi l'avis du jour le remettrait en file, pour 30 jours de plus.
  assert.deepEqual(await bdd.raw("SELECT id_notice_user FROM Ban WHERE id_user = ?", [BAN.id_user]), [{ id_notice_user: null }]);
  await bdd.raw("DELETE FROM Ban WHERE id_user = ?", [BAN.id_user]);
});

test("retryBanNoticeWithdrawals_queuedInFuture_rowDropped", async () => {
  // Horloge reculée : la ligne ne doit pas échapper à l'échéance.
  await clearWithdrawals();
  await withdrawBanNotice(noticeFailureClient([], UNAVAILABLE()), BAN.id_user, "notice-z", NOW + 2 * DAY);

  const settled = await retryBanNoticeWithdrawals(noticeFailureClient([], UNAVAILABLE()), NOW);

  assert.equal(settled, 1);
  assert.deepEqual(await pendingWithdrawals(), []);
});

test("retryBanNoticeWithdrawals_refusedForGood_rowDroppedAndLogged", async () => {
  await clearWithdrawals();
  await withdrawBanNotice(noticeFailureClient([], UNAVAILABLE()), BAN.id_user, "notice-c", NOW);
  const logs: string[] = [];

  const settled = await retryBanNoticeWithdrawals(noticeFailureClient(logs, REFUSED(10003)), NOW + DAY);

  assert.equal(settled, 1);
  assert.deepEqual(await pendingWithdrawals(), []);
  assert.deepEqual(logs, ["Ban notice withdrawal refused by Discord"]);
});

// --- Revue sécurité EF-14, cycle 7 ---

test("deleteDirectMessage_staleCachedChannel_reopenedAndDeleted", async () => {
  // Conversation gardée en cache que Discord ne connaît plus : rouverte une fois.
  const deleted: string[] = [];
  const client = {
    users: {
      fetch: async () => ({
        dmChannel: { messages: { delete: async () => { throw REFUSED(10003); } } },
        createDM: async () => ({ messages: { delete: async (id: string) => { deleted.push(id); } } }),
      }),
    },
  } as unknown as Client;

  const outcome = await deleteDirectMessage(client, BAN.id_user, "notice-s");

  assert.equal(outcome, "deleted");
  assert.deepEqual(deleted, ["notice-s"]);
});

test("deleteDirectMessage_messageAlreadyGone_gone", async () => {
  const outcome = await deleteDirectMessage(noticeFailureClient([], REFUSED(10008)), BAN.id_user, "notice-a");

  assert.equal(outcome, "gone");
});

test("withdrawBanNotice_refused_banForgetsNotice", async () => {
  // Jamais effaçable : la ligne `Ban` l'oublie, l'avis du jour ne le reprend pas.
  await clearWithdrawals();
  const bdd = await getBddInstance();
  await bdd.raw("DELETE FROM Ban WHERE id_user = ?", [BAN.id_user]);
  await bdd.set("Ban", ["id_user", "id_moderator", "id_reason"], [BAN.id_user, BAN.id_moderator, BAN.id_reason]);
  await bdd.raw("UPDATE Ban SET id_notice_user = ? WHERE id_user = ?", ["notice-n", BAN.id_user]);

  const outcome = await withdrawBanNotice(noticeFailureClient([], REFUSED(50013)), BAN.id_user, "notice-n", NOW);

  assert.equal(outcome, "refused");
  assert.deepEqual(await bdd.raw("SELECT id_notice_user FROM Ban WHERE id_user = ?", [BAN.id_user]), [{ id_notice_user: null }]);
  await bdd.raw("DELETE FROM Ban WHERE id_user = ?", [BAN.id_user]);
});

test("deleteBanMessages_ownerMessageAlreadyGone_notCounted", async () => {
  // Un `OWNER_ID` erroné ou un message déjà effacé ne passent pas pour un effacement.
  const previousOwner = process.env.OWNER_ID;
  process.env.OWNER_ID = BAN.id_user;
  try {
    const count = await deleteBanMessages(noticeFailureClient([], REFUSED(10008)), {
      ...BAN,
      id_reason: "",
      id_reason_owner: "owner-msg",
      id_notice_user: null,
    });

    assert.equal(count, 0);
  } finally {
    process.env.OWNER_ID = previousOwner;
  }
});

// --- Revue sécurité EF-14, cycle 8 ---

/** Faux client qui compte les effacements tentés auprès de Discord, tous en échec passager. */
function countingClient(attempts: string[]): Client {
  return {
    channels: { fetch: async () => ({ send: async () => ({ id: "log-1" }) }) },
    users: {
      fetch: async (id: string) => ({
        id,
        send: async () => ({ id: "dm-1" }),
        createDM: async () => ({ messages: { delete: async (messageId: string) => { attempts.push(messageId); throw UNAVAILABLE(); } } }),
      }),
    },
  } as unknown as Client;
}

test("deleteDirectMessage_freshChannelUnknown_refusedWithoutReopen", async () => {
  // Conversation ouverte à l'instant : un « canal inconnu » n'est pas réessayé.
  let opened = 0;
  const client = {
    users: {
      fetch: async () => ({
        dmChannel: null,
        createDM: async () => { opened += 1; return { messages: { delete: async () => { throw REFUSED(10003); } } }; },
      }),
    },
  } as unknown as Client;

  const outcome = await deleteDirectMessage(client, BAN.id_user, "notice-r");

  assert.equal(outcome, "refused");
  assert.equal(opened, 1);
});

test("withdrawBanNotice_refusedAndForgetFails_keptForNightlyRetry", async () => {
  await clearWithdrawals();
  const bdd = await getBddInstance();
  const original = bdd.write.bind(bdd);
  bdd.write = async (query: string, values?: unknown[]) => {
    if (query.startsWith("UPDATE Ban SET id_notice_user = NULL")) { throw new Error("database is locked"); }
    return original(query, values);
  };
  const logs: string[] = [];
  let outcome;
  try {
    outcome = await withdrawBanNotice(noticeFailureClient(logs, REFUSED(50013)), BAN.id_user, "notice-l", NOW);
  } finally {
    bdd.write = original;
  }

  assert.equal(outcome, "refused");
  assert.deepEqual(logs, ["Ban notice refusal not recorded", "Ban notice withdrawal refused by Discord"]);
  // Gardé en file : la purge de nuit refera l'oubli.
  assert.deepEqual(await pendingWithdrawals(), [{ id_user: BAN.id_user, id_message: "notice-l", queued_at: NOW }]);
  await clearWithdrawals();
});

test("retryBanNoticeWithdrawals_expiredRow_lastAttemptThenAbandoned", async () => {
  // Échue : un dernier essai, puis abandon s'il échoue encore.
  await clearWithdrawals();
  const bdd = await getBddInstance();
  await bdd.raw("INSERT INTO BanNoticeWithdrawal (id_user, id_message, queued_at) VALUES (?, ?, ?)", [BAN.id_user, "notice-e", NOW]);
  const attempts: string[] = [];

  const settled = await retryBanNoticeWithdrawals(countingClient(attempts), NOW + 29 * DAY);

  assert.equal(settled, 1);
  assert.deepEqual(attempts, ["notice-e"]);
  assert.deepEqual(await pendingWithdrawals(), []);
});

test("retryBanNoticeWithdrawals_moreExpiredThanCap_runBounded", async () => {
  // Les échues comptent dans le plafond : la nuit ne déverse pas des centaines d'appels.
  await clearWithdrawals();
  const bdd = await getBddInstance();
  for (let i = 0; i < MAX_NOTICE_WITHDRAWALS_PER_RUN + 5; i++) {
    await bdd.raw("INSERT INTO BanNoticeWithdrawal (id_user, id_message, queued_at) VALUES (?, ?, ?)", [BAN.id_user, `old-${i}`, NOW + i]);
  }
  const attempts: string[] = [];

  const settled = await retryBanNoticeWithdrawals(countingClient(attempts), NOW + 29 * DAY + DAY);

  assert.equal(settled, MAX_NOTICE_WITHDRAWALS_PER_RUN);
  assert.equal(attempts.length, MAX_NOTICE_WITHDRAWALS_PER_RUN);
  assert.equal((await pendingWithdrawals()).length, 5);
  await clearWithdrawals();
});

test("retryBanNoticeWithdrawals_noticeDeleted_liveBanForgetsNotice", async () => {
  // Avis encore désigné par une exclusion en cours (levée échouée) : effacé, il est oublié.
  await clearWithdrawals();
  const bdd = await getBddInstance();
  await bdd.raw("DELETE FROM Ban WHERE id_user = ?", [BAN.id_user]);
  await bdd.set("Ban", ["id_user", "id_moderator", "id_reason"], [BAN.id_user, BAN.id_moderator, BAN.id_reason]);
  await bdd.raw("UPDATE Ban SET id_notice_user = ? WHERE id_user = ?", ["notice-v", BAN.id_user]);
  await bdd.raw("INSERT INTO BanNoticeWithdrawal (id_user, id_message, queued_at) VALUES (?, ?, ?)", [BAN.id_user, "notice-v", NOW]);

  const settled = await retryBanNoticeWithdrawals(banClient([]), NOW + DAY);

  assert.equal(settled, 1);
  assert.deepEqual(await bdd.raw("SELECT id_notice_user FROM Ban WHERE id_user = ?", [BAN.id_user]), [{ id_notice_user: null }]);
  await bdd.raw("DELETE FROM Ban WHERE id_user = ?", [BAN.id_user]);
});

test("retryBanNoticeWithdrawals_morePendingThanCap_cappedPerRun", async () => {
  await clearWithdrawals();
  const bdd = await getBddInstance();
  for (let i = 0; i < MAX_NOTICE_WITHDRAWALS_PER_RUN + 5; i++) {
    await bdd.raw("INSERT INTO BanNoticeWithdrawal (id_user, id_message, queued_at) VALUES (?, ?, ?)", [BAN.id_user, `notice-${i}`, NOW]);
  }
  const attempts: string[] = [];

  const settled = await retryBanNoticeWithdrawals(countingClient(attempts), NOW + DAY);

  assert.equal(settled, 0);
  assert.equal(attempts.length, MAX_NOTICE_WITHDRAWALS_PER_RUN);
  await clearWithdrawals();
});
