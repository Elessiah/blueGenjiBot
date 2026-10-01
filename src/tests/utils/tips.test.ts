import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";

// Base jetable désignée avant l'import : le singleton l'ouvre à son premier appel.
const TMP_DIR = path.join(os.tmpdir(), "bgenji-tips-" + randomUUID());
fs.mkdirSync(TMP_DIR, { recursive: true });
process.env.BDD_PATH = path.join(TMP_DIR, "bot.sqlite");
process.env.OWNER_ID = "owner-1";
process.env.INFO_SERV = "admin-channel-1";

import { getBddInstance, resetBddInstance } from "../../bdd/Bdd.js";
import { nextTips } from "../../utils/Tips.js";
import type { Client } from "discord.js";

/**
 * Caractérisation de `nextTips` : une astuce toutes les quinze annonces d'un
 * même service dans une même région, à chaque salon relayé de cette région,
 * sauf s'il vient déjà d'en recevoir une ; les astuces se succèdent en boucle.
 */

const TIPS_COUNT = 12;

/** Salons simulés : `lost` = disparu, `nomsg` = sans messages lisibles, sinon le dernier message. */
type ChannelState = "lost" | "nomsg" | "empty" | "tip" | "other" | "foreign-tip";

function fakeClient(trace: string[], states: Record<string, ChannelState>): Client {
  return {
    user: { id: "bot" },
    users: { fetch: async (id: string) => ({ id, send: async () => ({ id: "dm" }) }) },
    channels: {
      fetch: async (id: string) => {
        if (id === process.env.INFO_SERV) {
          return { send: async (text: string) => { trace.push("log " + text); return { id: "log" }; } };
        }
        trace.push("channels.fetch " + id);
        const state = states[id] ?? "empty";
        if (state === "lost") return null;
        const last = {
          empty: undefined,
          tip: { author: { id: "bot" }, content: "# Tips: déjà là" },
          other: { author: { id: "someone" }, content: "lfs ce soir" },
          "foreign-tip": { author: { id: "someone" }, content: "# Tips: imitation" },
        }[state as "empty" | "tip" | "other" | "foreign-tip"];
        return {
          id,
          guild: { name: "Serveur" },
          messages: state === "nomsg" ? undefined : {
            fetch: async (opts: { limit: number }) => {
              trace.push(`messages.fetch ${id} limit=${opts.limit}`);
              return { first: () => last };
            },
          },
          send: async (payload: { content?: string }) => {
            trace.push(`tip ${id} ${payload.content?.split("\n")[0]}`);
            return { id: "tip" };
          },
        };
      },
    },
  } as unknown as Client;
}

async function relay(channelId: string, service: string, region: number): Promise<void> {
  const bdd = await getBddInstance();
  await bdd.raw("INSERT OR IGNORE INTO ChannelPartner (id_channel, id_guild, region) VALUES (?, 'g', ?)", [channelId, region]);
  await bdd.raw("INSERT INTO ChannelPartnerService (id_channel, id_service) SELECT ?, id_service FROM Service WHERE name = ?", [channelId, service]);
}

/** Appelle `nextTips` `times` fois et rend la trace. */
async function announce(times: number, service: string, region: number, states: Record<string, ChannelState> = {}): Promise<string[]> {
  const trace: string[] = [];
  const client = fakeClient(trace, states);
  for (let i = 0; i < times; i++) await nextTips(client, service, region);
  return trace;
}

test("quatorze annonces : rien, la quinzième : une astuce par salon de la région et du service", async () => {
  await relay("eu-1", "lfs", 1);
  await relay("eu-2", "lfs", 1);
  await relay("na-1", "lfs", 2);
  await relay("eu-lfp", "lfp", 1);
  assert.deepEqual(await announce(14, "lfs", 1), []);
  const trace = await announce(1, "lfs", 1);
  assert.equal(trace.length, 6);
  for (const id of ["eu-1", "eu-2"]) {
    const at = trace.indexOf("channels.fetch " + id);
    assert.ok(at >= 0);
    assert.deepEqual(trace.slice(at, at + 3), [`channels.fetch ${id}`, `messages.fetch ${id} limit=1`, `tip ${id} # Tips: Setting Rank Filter`]);
  }
});

test("le compte est tenu par région puis par service", async () => {
  assert.deepEqual(await announce(14, "lfs", 2), []);
  assert.deepEqual(await announce(14, "lfp", 1), []);
  assert.deepEqual(await announce(1, "lfs", 2), ["channels.fetch na-1", "messages.fetch na-1 limit=1", "tip na-1 # Tips: Displaying Rank Filter"]);
});

test("salon déjà servi par le bot, ou sans messages lisibles : rien de plus", async () => {
  const trace = await announce(15, "lfs", 1, { "eu-1": "tip", "eu-2": "nomsg" });
  assert.deepEqual(trace.slice().sort(), ["channels.fetch eu-1", "channels.fetch eu-2", "messages.fetch eu-1 limit=1"].sort());
});

test("dernier message d'un autre, même une imitation d'astuce : l'astuce suivante est postée", async () => {
  const trace = await announce(15, "lfs", 1, { "eu-1": "other", "eu-2": "foreign-tip" });
  const tips = trace.filter((line) => line.startsWith("tip "));
  assert.equal(tips.length, 2);
  assert.ok(tips.every((line) => line.endsWith(tips[0].split(" ").slice(2).join(" "))));
  assert.match(tips[0], /^tip eu-[12] # Tips: /);
});

test("salon disparu : journalisé, retiré de la base, les autres servis", async () => {
  const trace = await announce(15, "lfs", 1, { "eu-1": "lost" });
  assert.deepEqual(trace.filter((line) => line.startsWith("log ")), [
    "log Un channel a été perdu !",
    "log A service has been unlinked from a channel of channel eu-1.",
  ]);
  assert.equal(trace.filter((line) => line.startsWith("tip eu-2")).length, 1);
  const bdd = await getBddInstance();
  assert.equal((await bdd.raw("SELECT 1 FROM ChannelPartner WHERE id_channel = 'eu-1'")).length, 0);
});

test("les astuces tournent en boucle, une par palier atteint", async () => {
  const seen: string[] = [];
  await relay("asia-1", "lfs", 4);
  for (let round = 0; round < TIPS_COUNT + 1; round++) {
    const tips = (await announce(15, "lfs", 4)).filter((line) => line.startsWith("tip "));
    seen.push(tips[0]);
  }
  assert.equal(new Set(seen.slice(0, TIPS_COUNT)).size, TIPS_COUNT);
  assert.equal(seen[TIPS_COUNT], seen[0]);
});

test("ferme la base à la fin de la suite", async () => {
  assert.equal(await resetBddInstance(), true);
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});
