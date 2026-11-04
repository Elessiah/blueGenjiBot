import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import type { ChatInputCommandInteraction, Client } from "discord.js";

const TMP_DIR = path.join(os.tmpdir(), `bgenji-unban-${randomUUID()}`);
fs.mkdirSync(TMP_DIR, { recursive: true });
process.env.BDD_PATH = path.join(TMP_DIR, "bot.sqlite");
process.env.OWNER_ID = "900000000000000001";
process.env.INFO_SERV = "800000000000000001";
process.env.SERV_GENJI = "700000000000000001";
process.env.SERV_RIVALS = "700000000000000002";

import { unban } from "../../commandsHandlers/ban/unban.js";
import { checkBan, settleBanNotices } from "../../check/checkBan.js";
import { closeBddInstance, getBddInstance } from "../../bdd/Bdd.js";

/**
 * `/unban` : la levée vaut sur-le-champ pour le relais, qui garde une minute
 * le verdict « exclu » d'un auteur de messages (`checkBan`).
 */

const OWNER = process.env.OWNER_ID as string;
const TARGET = "500000000000000001";

/** Faux client : motif lisible au salon du staff, messages privés acceptés, effacements notés. */
function fakeClient(deletedDms: string[] = []): Client {
  return {
    users: {
      fetch: async (id: string) => ({
        id,
        send: async () => ({ id: `dm-${id}` }),
        createDM: async () => ({ messages: { delete: async (messageId: string) => { deletedDms.push(`${id}:${messageId}`); } } }),
      }),
    },
    channels: {
      fetch: async () => ({
        send: async () => ({ id: "admin-msg" }),
        messages: {
          fetch: async () => ({ content: "Spam" }),
          delete: async () => undefined,
        },
      }),
    },
  } as unknown as Client;
}

/** Interaction `/unban id_ban:<target>` du propriétaire, sur un serveur BlueGenji. */
function unbanInteraction(client: Client, target: string, replies: string[] = []): ChatInputCommandInteraction {
  return {
    client,
    reply: async ({ content }: { content: string }) => { replies.push(content); },
    editReply: async () => undefined,
    guild: { id: process.env.SERV_GENJI, memberCount: 10, members: { cache: new Map() } },
    user: { id: OWNER },
    member: { id: OWNER },
    channel: {},
    options: { getString: () => target },
  } as unknown as ChatInputCommandInteraction;
}

test.after(async () => {
  await closeBddInstance();
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

test("unban_afterCachedVerdict_verdictForgotten", async () => {
  const client = fakeClient();
  const bdd = await getBddInstance();
  await bdd.set("Ban", ["id_user", "id_moderator", "id_reason"], [TARGET, "400000000000000001", "reason-1"]);
  assert.equal(await checkBan(client, TARGET), "BANNED");
  await settleBanNotices();

  assert.equal(await unban(client, unbanInteraction(client, TARGET)), true);

  assert.equal(await checkBan(client, TARGET), "NOT_BANNED");
});

test("unban_noticeIdInRow_noticeDeleted", async () => {
  // La ligne effacée est rendue par la même instruction : l'avis qu'elle
  // désigne à cet instant est celui qui est retiré.
  const deletedDms: string[] = [];
  const client = fakeClient(deletedDms);
  const bdd = await getBddInstance();
  await bdd.set("Ban", ["id_user", "id_moderator", "id_reason"], [TARGET, "400000000000000001", "reason-2"]);
  await bdd.raw("UPDATE Ban SET id_notice_user = ? WHERE id_user = ?", ["notice-new", TARGET]);

  assert.equal(await unban(client, unbanInteraction(client, TARGET)), true);

  assert.deepEqual(deletedDms, [`${TARGET}:notice-new`]);
  assert.deepEqual(await bdd.raw("SELECT id_user FROM Ban WHERE id_user = ?", [TARGET]), []);
});

test("unban_unknownTarget_unknownReplyAndNoDeletion", async () => {
  // Déjà levée (par un autre modérateur) ou jamais prononcée : rien à faire.
  const deletedDms: string[] = [];
  const replies: string[] = [];
  const client = fakeClient(deletedDms);

  assert.equal(await unban(client, unbanInteraction(client, "500000000000000099", replies)), true);

  assert.deepEqual(replies, ["Unknown ID ban !"]);
  assert.deepEqual(deletedDms, []);
});

// --- Revue sécurité EF-14, cycle 6 : l'avis est mis en file avant la levée ---

/** Faux client dont l'effacement des messages privés échoue (Discord indisponible). */
function dmDeleteFailingClient(): Client {
  return {
    users: {
      fetch: async (id: string) => ({
        id,
        send: async () => ({ id: "log-dm" }),
        createDM: async () => ({ messages: { delete: async () => { throw Object.assign(new Error("Service Unavailable"), { code: 0 }); } } }),
      }),
    },
    channels: { fetch: async () => ({ send: async () => ({ id: "log-1" }), messages: { delete: async () => undefined } }) },
  } as unknown as Client;
}

async function banWithNotice(target: string, notice: string): Promise<void> {
  const bdd = await getBddInstance();
  await bdd.set("Ban", ["id_user", "id_moderator", "id_reason"], [target, "400000000000000001", "reason-3"]);
  await bdd.raw("UPDATE Ban SET id_notice_user = ? WHERE id_user = ?", [notice, target]);
}

test("unban_noticeDeleteFails_noticeKeptInQueue", async () => {
  const target = "500000000000000011";
  await banWithNotice(target, "notice-q");
  const client = dmDeleteFailingClient();

  assert.equal(await unban(client, unbanInteraction(client, target)), true);

  const bdd = await getBddInstance();
  assert.deepEqual(await bdd.raw("SELECT id_message FROM BanNoticeWithdrawal WHERE id_user = ?", [target]), [{ id_message: "notice-q" }]);
});

test("unban_noticeDeleted_queueEmpty", async () => {
  const target = "500000000000000012";
  await banWithNotice(target, "notice-ok");
  const client = fakeClient([]);

  assert.equal(await unban(client, unbanInteraction(client, target)), true);

  const bdd = await getBddInstance();
  assert.deepEqual(await bdd.raw("SELECT id_message FROM BanNoticeWithdrawal WHERE id_user = ?", [target]), []);
});

test("unban_databaseUnavailable_unavailableReplyAndBanKept", async () => {
  const target = "500000000000000013";
  await banWithNotice(target, "notice-db");
  const bdd = await getBddInstance();
  const original = bdd.writeReturning.bind(bdd);
  bdd.writeReturning = async () => { throw new Error("Database is not open"); };
  const replies: string[] = [];
  const client = fakeClient([]);
  try {
    assert.equal(await unban(client, unbanInteraction(client, target, replies)), true);
  } finally {
    bdd.writeReturning = original;
  }

  assert.deepEqual(replies, ["The database is unavailable. Please try again in a few minutes."]);
  assert.equal((await bdd.raw("SELECT id_user FROM Ban WHERE id_user = ?", [target])).length, 1);
});

test("unban_queueInsertFails_banStillLifted", async () => {
  // Table des avis absente (étape du schéma en échec) : la levée passe quand même.
  const target = "500000000000000014";
  await banWithNotice(target, "notice-i");
  const bdd = await getBddInstance();
  const original = bdd.write.bind(bdd);
  bdd.write = async (query: string, values?: unknown[]) => {
    if (query.startsWith("INSERT OR IGNORE INTO BanNoticeWithdrawal")) { throw new Error("no such table: BanNoticeWithdrawal"); }
    return original(query, values);
  };
  const replies: string[] = [];
  const client = fakeClient([]);
  try {
    assert.equal(await unban(client, unbanInteraction(client, target, replies)), true);
  } finally {
    bdd.write = original;
  }

  assert.deepEqual(replies, ["User successfully unbanned."]);
  assert.deepEqual(await bdd.raw("SELECT id_user FROM Ban WHERE id_user = ?", [target]), []);
});
