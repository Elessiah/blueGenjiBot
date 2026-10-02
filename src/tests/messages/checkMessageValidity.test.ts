import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import fs from "node:fs";

const TMP_DB = path.join(os.tmpdir(), `bgenji-validity-${randomUUID()}.sqlite`);
process.env.BDD_PATH = TMP_DB;
process.env.INFO_SERV = "700000000000000001";

import type { Client, Message } from "discord.js";
import { checkMessageValidity, type BanCheckMemo } from "../../messages/checkMessageValidity.js";
import { closeBddInstance, getBddInstance } from "../../bdd/Bdd.js";
import type { Service } from "../../bdd/types.js";

const BANNED = "600000000000000001";

/** Client factice : compte les messages privés envoyés à l'exclu. */
function fakeClient() {
  const sent: string[] = [];
  const client = {
    users: {
      fetch: async () => ({
        send: async (payload: { content: string }) => {
          sent.push(payload.content);
          return {};
        },
      }),
    },
    channels: {
      fetch: async () => ({ messages: { fetch: async () => ({ content: "motif" }) } }),
    },
  };
  return { client: client as unknown as Client, sent };
}

/** Message factice : compte les réactions. */
function fakeMessage(authorId: string, content: string) {
  const reactions: string[] = [];
  const message = {
    author: { id: authorId },
    content,
    react: async (emoji: string) => {
      reactions.push(emoji);
      return null;
    },
  };
  return { message: message as unknown as Message, reactions };
}

test("un exclu visant deux services n'est prévenu et marqué qu'une fois", async () => {
  const bdd = await getBddInstance();
  await bdd.set("Ban", ["id_user", "id_moderator", "id_reason"], [BANNED, "1", "2"]);
  const { client, sent } = fakeClient();
  const { message, reactions } = fakeMessage(BANNED, "lfs lfp");
  const services: Service[] = [
    { id_service: 1, name: "lfs" } as Service,
    { id_service: 2, name: "lfp" } as Service,
  ];
  const memo: BanCheckMemo = { verdict: null };
  const hasValidService = { value: false };
  for (const service of services) {
    assert.equal(await checkMessageValidity(client, service, "lfs lfp", message, hasValidService, memo), false);
  }
  assert.equal(memo.verdict, "BANNED");
  assert.equal(hasValidService.value, true);
  assert.equal(sent.length, 1);
  assert.deepEqual(reactions, ["🚫"]);
});

test.after(async () => {
  await closeBddInstance();
  await new Promise((r) => setTimeout(r, 50));
  try { fs.unlinkSync(TMP_DB); } catch { /* noop */ }
});
