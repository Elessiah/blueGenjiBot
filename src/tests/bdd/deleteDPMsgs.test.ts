import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";

// Même montage que `tests/check/checkBan.test.ts` : une base jetable, désignée
// **avant** l'import du module, puisque le singleton l'ouvre à son premier appel.
const TMP_DB = path.join(os.tmpdir(), `bgenji-dpmsg-${randomUUID()}.sqlite`);
process.env.BDD_PATH = TMP_DB;
process.env.OWNER_ID = "owner-1";
process.env.INFO_SERV = "admin-channel-1";

import { closeBddInstance, getBddInstance } from "../../bdd/Bdd.js";
import { deleteDPMsgs } from "../../bdd/deleteDPMsgs.js";
import type { Client } from "discord.js";

/**
 * `deleteDPMsgs` : chaque copie relayée d'un message source supprimé a sa
 * garde. Le partiel `Message` (annonces GETI) fait passer ici la suppression
 * de tout message hors cache : une copie disparue ne doit ni arrêter les
 * suivantes ni remonter en erreur.
 */

type Trace = { deleted: string[]; logs: string[] };

function discordError(code: number): Error {
  return Object.assign(new Error("DiscordAPIError"), { code });
}

/** Faux client : `channels` décrit, par salon, ce que Discord rend (copie présente, salon ou message disparu, panne). */
function fakeClient(channels: Record<string, "ok" | "channelGone" | "messageGone" | "failure">, trace: Trace): Client {
  return {
    users: { fetch: async () => ({ send: async (text: unknown) => { trace.logs.push(String(text)); return { id: "log" }; } }) },
    channels: {
      fetch: async (id: string) => {
        if (id === process.env.INFO_SERV) {
          return { send: async (text: unknown) => { trace.logs.push(JSON.stringify(text)); return { id: "log" }; } };
        }
        const state = channels[id];
        if (state === "channelGone") { throw discordError(10003); }
        return {
          isTextBased: () => true,
          messages: {
            fetch: async (messageId: string) => {
              if (state === "messageGone") { throw discordError(10008); }
              if (state === "failure") { throw discordError(50013); }
              return { delete: async () => { trace.deleted.push(`${id}:${messageId}`); } };
            },
          },
        };
      },
    },
  } as unknown as Client;
}

async function seedCopies(og: string, channelIds: string[]): Promise<void> {
  const bdd = await getBddInstance();
  for (const [index, channelId] of channelIds.entries()) {
    await bdd.set("DPMsg", ["id_msg", "id_channel", "id_og"], [`${og}-copy-${index}`, channelId, og]);
  }
}

test("deleteDPMsgs_firstChannelGone_stillDeletesTheNextCopy", async () => {
  const trace: Trace = { deleted: [], logs: [] };
  await seedCopies("og-1", ["gone-channel", "live-channel"]);

  await deleteDPMsgs(fakeClient({ "gone-channel": "channelGone", "live-channel": "ok" }, trace), "og-1");

  assert.deepEqual(trace.deleted, ["live-channel:og-1-copy-1"]);
  assert.deepEqual(trace.logs, []);
});

test("deleteDPMsgs_copyAlreadyDeleted_isSilentAndContinues", async () => {
  const trace: Trace = { deleted: [], logs: [] };
  await seedCopies("og-2", ["empty-channel", "other-channel"]);

  await deleteDPMsgs(fakeClient({ "empty-channel": "messageGone", "other-channel": "ok" }, trace), "og-2");

  assert.deepEqual(trace.deleted, ["other-channel:og-2-copy-1"]);
  assert.deepEqual(trace.logs, []);
});

test("deleteDPMsgs_otherDiscordError_logsItAndContinues", async () => {
  const trace: Trace = { deleted: [], logs: [] };
  await seedCopies("og-3", ["locked-channel", "open-channel"]);

  await deleteDPMsgs(fakeClient({ "locked-channel": "failure", "open-channel": "ok" }, trace), "og-3");

  assert.deepEqual(trace.deleted, ["open-channel:og-3-copy-1"]);
  assert.ok(trace.logs.some((log) => log.includes("Failed to delete")), JSON.stringify(trace.logs));
});

test("ferme la base a la fin de la suite", async () => {
  await closeBddInstance();
  fs.rmSync(TMP_DB, { force: true });
  assert.equal(fs.existsSync(TMP_DB), false);
});
