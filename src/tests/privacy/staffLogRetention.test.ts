import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const TMP_DB = path.join(os.tmpdir(), `bgenji-stafflog-${randomUUID()}.sqlite`);
process.env.BDD_PATH = TMP_DB;

import type { Client } from "discord.js";
import { closeBddInstance } from "../../bdd/Bdd.js";
import {
  banMessageIds,
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
    id_notice_admin: null,
    id_notice_owner: "13",
  };
  assert.deepEqual(banMessageIds(ban), ["10", "11", "13"]);
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
  assert.equal(removed, 2);
  assert.deepEqual(deleted, ["1", "3"]);
  // Pages [1,2], [3,4], [5,6] : la troisième contient un message récent, fin.
  assert.equal(fetches(), 3);
});

test("purgeLogChannel respecte le budget de suppressions", async () => {
  const specs = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, author: BOT, ageDays: 400 }));
  const { channel, deleted } = fakeChannel(specs, 4);
  assert.equal(await purgeLogChannel(channel, CUTOFF, BOT, new Set(), 3), 3);
  assert.deepEqual(deleted, ["1", "2", "3"]);
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
  assert.equal(await purgeLogChannel(channel, CUTOFF, BOT, new Set()), 1);
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
  assert.equal(await purgeLogChannel(channel, CUTOFF, BOT, new Set()), 0);
  assert.equal(fetches, MAX_LOG_PAGES_PER_RUN);
});

test.after(async () => {
  closeBddInstance();
  await new Promise((r) => setTimeout(r, 50));
  try { fs.unlinkSync(TMP_DB); } catch { /* noop */ }
});
