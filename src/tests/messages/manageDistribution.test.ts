import test, { mock } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";

// Base jetable désignée avant l'import : services, partenaires et relais y vivent.
const TMP_DIR = path.join(os.tmpdir(), "bgenji-distribution-" + randomUUID());
fs.mkdirSync(TMP_DIR, { recursive: true });
process.env.BDD_PATH = path.join(TMP_DIR, "bot.sqlite");
process.env.OWNER_ID = "owner-1";
process.env.INFO_SERV = "admin-channel-1";

import { getBddInstance, resetBddInstance } from "../../bdd/Bdd.js";
import { manageDistribution } from "../../messages/manageDistribution.js";
import type { Client, Message } from "discord.js";

/**
 * Caractérisation de `manageDistribution` : pour chaque chemin, la trace
 * ordonnée de ce qui sort du bot (réponses et réactions sur l'annonce, relais
 * dans les salons partenaires, journal, console) et les lignes écrites en base.
 */

// Les réponses temporaires s'effacent par minuterie (jusqu'à 2 min) : figées
// ici, elles ne retiennent pas le processus de test.
mock.timers.enable({ apis: ["setTimeout"] });

const SOURCE_CHANNEL = "c-src";

function fakeClient(trace: string[]): Client {
  return {
    user: { id: "bot" },
    users: {
      fetch: async (id: string) => ({
        id,
        send: async (payload: { content?: string }) => { trace.push("dm:" + id + " " + payload.content); return { id: "dm" }; },
      }),
    },
    channels: {
      fetch: async (id: string) => {
        if (id === process.env.INFO_SERV) {
          return {
            send: async (text: string) => { trace.push("log " + text); return { id: "log" }; },
            messages: { fetch: async () => ({ content: "Spam" }) },
          };
        }
        if (id === SOURCE_CHANNEL) return { id, guild: { name: "Source" } };
        if (id.startsWith("lost")) return null;
        return {
          id,
          guild: { name: "Partenaire" },
          send: async (payload: { embeds?: Array<{ data: { description?: string; image?: unknown } }> }) => {
            const data = payload.embeds?.[0]?.data;
            trace.push(`relay ${id} ${data?.description ?? ""}${data?.image ? " [image]" : ""}`);
            return { id: "relay-" + id + "-" + randomUUID().slice(0, 4) };
          },
        };
      },
    },
  } as unknown as Client;
}

type MessageSetup = { content: string; attachments?: number; guildId?: string | null; broken?: boolean };

function fakeMessage(trace: string[], setup: MessageSetup): Message {
  const attachments = new Map<string, unknown>();
  for (let i = 0; i < (setup.attachments ?? 0); i++) {
    attachments.set("a" + i, { attachment: "https://cdn.invalid/a" + i + ".png", url: "https://cdn.invalid/a" + i + ".png" });
  }
  return {
    id: "msg-" + randomUUID().slice(0, 8),
    content: setup.content,
    guildId: setup.guildId === undefined ? "g-src" : setup.guildId,
    guild: { name: "Source" },
    attachments: setup.broken ? undefined : attachments,
    author: { id: "author-1", username: "auteur", displayAvatarURL: () => "https://cdn.invalid/avatar.png", toString: () => "<@author-1>" },
    channel: { id: SOURCE_CHANNEL, isTextBased: () => false },
    reply: async (text: string) => { trace.push("reply " + text); return { delete: async () => undefined }; },
    react: async (emoji: string) => { trace.push("react " + emoji); return null; },
  } as unknown as Message;
}

/** Salon partenaire relayant `service`, dans `region`, filtré sur `ranks`. */
async function addPartner(channel: string, service: string, region: number, ranks: string[] = []): Promise<void> {
  const bdd = await getBddInstance();
  await bdd.raw("INSERT INTO ChannelPartner (id_channel, id_guild, region) VALUES (?, ?, ?)", [channel, "g-" + channel, region]);
  await bdd.raw("INSERT INTO ChannelPartnerService (id_channel, id_service) SELECT ?, id_service FROM Service WHERE name = ?", [channel, service]);
  for (const rank of ranks) {
    await bdd.raw("INSERT INTO ChannelPartnerRank (id_channel, id_rank) SELECT ?, id_rank FROM Ranks WHERE name = ?", [channel, rank]);
  }
}

async function resetTables(): Promise<void> {
  const bdd = await getBddInstance();
  for (const table of ["ChannelPartner", "ChannelPartnerService", "ChannelPartnerRank", "MessageService", "DPMsg", "OGMsg", "ServerModule", "Ban", "FeedEvent"]) {
    await bdd.raw(`DELETE FROM ${table}`, []);
  }
}

async function written(messageId: string) {
  const bdd = await getBddInstance();
  return {
    service: (await bdd.raw<{ name: string }>("SELECT s.name FROM MessageService m JOIN Service s ON s.id_service = m.id_service WHERE m.id_msg = ?", [messageId])).map((r) => r.name),
    relays: (await bdd.raw<{ id_channel: string }>("SELECT id_channel FROM DPMsg WHERE id_og = ? ORDER BY id_channel", [messageId])).map((r) => r.id_channel),
    og: (await bdd.raw("SELECT id_author FROM OGMsg WHERE id_msg = ?", [messageId])).length,
    feed: (await bdd.raw<{ summary: string }>("SELECT summary FROM FeedEvent", [])).map((r) => r.summary),
  };
}

async function run(setup: MessageSetup, channelServices: { name: string; id_service: number }[] = [{ name: "lfs", id_service: 1 }]) {
  const trace: string[] = [];
  const message = fakeMessage(trace, setup);
  const ok = await manageDistribution(message, fakeClient(trace), await getBddInstance(), SOURCE_CHANNEL, channelServices);
  return { ok, trace, message };
}

const DESCRIPTION = (content: string) => `${content}\n\n*Sent from : [Source]()* by <@author-1>`;

const NO_REGION_NOTE = "reply Note that your message will only be delivered to channels without filters.\n" +
  "To target your ad more precisely, specify a region. Available regions: `EU, NA, LATAM, ASIA.`";
const NOT_DELIVERED = "reply Your message was not delivered to any channel. " +
  "This may be because no users have activated the region filter you specified.";
const NOTHING_WRITTEN = { service: [], relays: [], og: 0, feed: [] };

/** Région du salon d'origine : sans elle (0), l'annonce ne vise que les salons sans région. */
async function setSourceRegion(region: number): Promise<void> {
  const bdd = await getBddInstance();
  await bdd.raw("INSERT INTO ChannelPartner (id_channel, id_guild, region) VALUES (?, ?, ?)", [SOURCE_CHANNEL, "g-src", region]);
}

async function disableAnnouncements(): Promise<void> {
  const bdd = await getBddInstance();
  await bdd.raw("INSERT INTO ServerModule (id_guild, module_key, enabled) VALUES ('g-src', 'annonces', 0)", []);
}

test("deux pièces jointes : refusé avant toute lecture", async () => {
  await resetTables();
  const r = await run({ content: "lfs eu gold", attachments: 2 });
  assert.equal(r.ok, false);
  assert.deepEqual(r.trace, ["reply You cannot send more than one attachment ! Cancel your Distribution."]);
  assert.deepEqual(await written(r.message.id), NOTHING_WRITTEN);
});

test("relais nominal : région demandée et salons sans région, rang respecté, tout écrit", async () => {
  await resetTables();
  await setSourceRegion(1);
  await addPartner("p-eu", "lfs", 1, ["gold"]);
  await addPartner("p-all", "lfs", 0, ["gold"]);
  await addPartner("p-all-norank", "lfs", 0);
  await addPartner("p-na", "lfs", 2, ["gold"]);
  await addPartner("p-eu-silver", "lfs", 1, ["silver"]);
  await addPartner("p-eu-lfp", "lfp", 1, ["gold"]);
  const r = await run({ content: "LFS EU gold" });
  assert.equal(r.ok, true);
  // Les relais suivent l'ordre de la base : comparés sans ordre.
  assert.deepEqual(r.trace.slice().sort(), [
    "react 🛰️",
    "relay p-all " + DESCRIPTION("LFS EU gold"),
    "relay p-eu " + DESCRIPTION("LFS EU gold"),
    "reply Your message has been sent to 2 channels of EU/ALL region as lfs",
  ].sort());
  // Un salon sans aucun filtre de rang ne reçoit rien d'une annonce qui en porte.
  assert.deepEqual(await written(r.message.id), { service: ["lfs"], relays: ["p-all", "p-eu"], og: 1, feed: ["lfs vers 2 salon(s)"] });
});

test("salon d'origine sans région, annonce sans rang : deux avis, seuls les salons sans région servis", async () => {
  await resetTables();
  await addPartner("p-all", "lfs", 0, ["gold"]);
  await addPartner("p-eu", "lfs", 1, ["gold"]);
  const r = await run({ content: "lfs ce soir" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.trace, [
    "reply It seems that you didn't specify any rank. To get more responses from other users, I recommend specifying the rank range you're looking for.",
    NO_REGION_NOTE,
    "relay p-all " + DESCRIPTION("lfs ce soir"),
    "react 🛰️",
    "reply Your message has been sent to 1 channels of ALL/ALL region as lfs",
  ]);
});

test("service sans rang (ta) : aucune remarque sur le rang, aucun salon servi", async () => {
  await resetTables();
  const r = await run({ content: "ta eu" }, [{ name: "ta", id_service: 6 }]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.trace, [NO_REGION_NOTE, NOT_DELIVERED]);
  assert.deepEqual(await written(r.message.id), { service: ["ta"], relays: [], og: 0, feed: [] });
});

test("module Annonces désactivé : refusé après les avis, rien d'écrit", async () => {
  await resetTables();
  await disableAnnouncements();
  const r = await run({ content: "lfs eu gold" });
  assert.equal(r.ok, false);
  assert.deepEqual(r.trace, [NO_REGION_NOTE, "reply Le module Annonces est desactive sur ce serveur."]);
  assert.deepEqual(await written(r.message.id), NOTHING_WRITTEN);
});

test("message hors serveur : le module n'est pas consulté", async () => {
  await resetTables();
  await disableAnnouncements();
  const r = await run({ content: "lfs eu gold", guildId: null });
  assert.equal(r.ok, true);
  assert.deepEqual(r.trace, [NO_REGION_NOTE, NOT_DELIVERED]);
});

test("deux services visés : refus appuyé et réaction, rien d'écrit", async () => {
  await resetTables();
  const r = await run({ content: "lfs lfp eu gold" });
  assert.equal(r.ok, false);
  assert.deepEqual(r.trace, [
    NO_REGION_NOTE,
    "reply Your message has not been sent ! \n# Sending to multiple services is strictly prohibited.\n" +
      "If necessary, split your request and send it in parts. **Spamming may result in a bot ban.**",
    "react 🚫",
  ]);
  assert.deepEqual(await written(r.message.id), NOTHING_WRITTEN);
});

test("aucun mot-clé : la liste des mots-clés en réponse", async () => {
  await resetTables();
  const r = await run({ content: "bonjour eu gold" });
  assert.equal(r.ok, false);
  assert.equal(r.trace.length, 2);
  assert.equal(r.trace[0], NO_REGION_NOTE);
  assert.match(r.trace[1], /^reply Your message has no keyword for a targeted service\. Please, next time, use these keywords:\n - `lfs`/);
  assert.match(r.trace[1], / - `lfcast`: If you are looking for casters to animate your tournament\.\n$/);
});

test("auteur exclu : réaction d'exclusion puis liste des mots-clés", async () => {
  await resetTables();
  await getBddInstance().then((bdd) => bdd.raw("INSERT INTO Ban (id_user, id_moderator, id_reason) VALUES ('author-1', 'mod', 'raison')", []));
  const r = await run({ content: "lfs eu gold" });
  assert.equal(r.ok, false);
  assert.equal(r.trace.length, 4);
  assert.equal(r.trace[0], NO_REGION_NOTE);
  assert.match(r.trace[1], /^dm:author-1 You have been banned since .+ : \nSpam$/);
  assert.equal(r.trace[2], "react 🚫");
  assert.match(r.trace[3], /^reply Your message has no keyword for a targeted service/);
});

test("salon partenaire perdu : journalisé, compté comme aucun relais", async () => {
  await resetTables();
  await addPartner("lost-1", "lfs", 0, ["gold"]);
  const r = await run({ content: "lfs eu gold" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.trace, [NO_REGION_NOTE, "log Failed to fetch channel lost-1 for sending service message", NOT_DELIVERED]);
});

test("une pièce jointe : relayée avec l'annonce", async () => {
  await resetTables();
  await setSourceRegion(1);
  await addPartner("p-all", "lfs", 0, ["gold"]);
  const r = await run({ content: "lfs eu gold", attachments: 1 });
  assert.deepEqual({ ok: r.ok, trace: r.trace }, {
    ok: true,
    trace: [
      "relay p-all " + DESCRIPTION("lfs eu gold"),
      "react 🛰️",
      "reply Your message has been sent to 1 channels of EU/ALL region as lfs",
    ],
  });
});

test("erreur inattendue : description à la console avec les seules lignes d'appel, puis au journal", async (t) => {
  await resetTables();
  const errors: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => { errors.push(args); });
  const r = await run({ content: "lfs", broken: true });
  assert.equal(r.ok, false);
  assert.deepEqual(r.trace, ["log manageDistribution error : \nCannot read properties of undefined (reading 'size')"]);
  assert.equal(errors.length, 1);
  assert.equal(errors[0][0], "manageDistribution error:");
  const lines = String(errors[0][1]).split("\n");
  assert.equal(lines[0], "Cannot read properties of undefined (reading 'size')");
  assert.ok(lines.length > 1);
  assert.ok(lines.slice(1).every((line) => /^\s+at\s/.test(line)));
});

test("ferme la base à la fin de la suite", async () => {
  mock.timers.reset();
  assert.equal(await resetBddInstance(), true);
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});
