import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";

// Base jetable désignée avant l'import : le singleton l'ouvre à son premier appel.
const TMP_DIR = path.join(os.tmpdir(), "bgenji-fetch-targets-" + randomUUID());
fs.mkdirSync(TMP_DIR, { recursive: true });
process.env.BDD_PATH = path.join(TMP_DIR, "bot.sqlite");
process.env.OWNER_ID = "owner-1";
process.env.INFO_SERV = "admin-channel-1";

import { getBddInstance, resetBddInstance } from "../../bdd/Bdd.js";
import { fetchTargets } from "../../adhesion/fetchTargets.js";
import type { adhesionIntervalIds } from "../../adhesion/types.js";
import { toSQLiteDate } from "../../utils/toSQLiteDatetime.js";
import { DiscordAPIError } from "discord.js";
import { RESTJSONErrorCodes } from "discord-api-types/v10";
import type { Client } from "discord.js";

/**
 * Caractérisation de `fetchTargets` : pour chaque issue de chaque lecture
 * Discord (trouvé, absent, disparu, panne passagère), la trace complète des
 * appels — lectures, messages privés, journal — la ligne en base après coup et
 * la valeur rendue. Une refonte doit reproduire ces traces à l'identique.
 */

/** Issue d'une lecture : l'objet, `null`, « n'existe plus », panne passagère. */
type Outcome = "ok" | "null" | "gone" | "flaky";

type Setup = {
  author?: Outcome; guild?: Outcome; channel?: Outcome; role?: Outcome; member?: Outcome;
  /** Récupération de tous les membres du serveur (lecture du rôle). */
  roleMembers?: Outcome;
};

function gone(code: number): DiscordAPIError {
  return new DiscordAPIError({ code, message: "Unknown" }, code, 404, "GET", "https://discord.invalid", {});
}

function fakeClient(trace: string[], setup: Setup): Client {
  const answer = async <T>(label: string, outcome: Outcome, code: number, value: T): Promise<T | null> => {
    trace.push(label);
    if (outcome === "gone") throw gone(code);
    if (outcome === "flaky") throw new Error("Service Unavailable");
    return outcome === "null" ? null : value;
  };
  const asUser = (id: string) => ({
    id,
    globalName: "Nom " + id,
    send: async (payload: unknown) => {
      const text = typeof payload === "string" ? payload : String((payload as { content?: unknown }).content ?? "");
      trace.push(`dm:${id} ${text}`);
      return { id: "dm-" + trace.length };
    },
  });
  return {
    users: {
      fetch: async (id: string) => (id === process.env.OWNER_ID
        ? asUser(id)
        : answer("users.fetch " + id, setup.author ?? "ok", RESTJSONErrorCodes.UnknownUser, asUser(id))),
    },
    channels: {
      fetch: async () => ({
        send: async (text: string) => { trace.push("log " + text); return { id: "log-" + trace.length }; },
      }),
    },
    guilds: {
      fetch: (id: string) => answer("guilds.fetch " + id, setup.guild ?? "ok", RESTJSONErrorCodes.UnknownGuild, {
        id,
        channels: {
          fetch: (cid: string) => answer("channels.fetch " + cid, setup.channel ?? "ok", RESTJSONErrorCodes.UnknownChannel, { id: cid, name: "salon" }),
        },
        roles: {
          fetch: (rid: string) => answer("roles.fetch " + rid, setup.role ?? "ok", RESTJSONErrorCodes.UnknownRole, { id: rid, name: "Bureau", members: new Map() }),
        },
        // Cache vide d'un serveur peuplé : lire un rôle demande la récupération complète.
        memberCount: 2,
        members: {
          cache: new Map(),
          fetch: (mid?: string) => (mid === undefined
            ? answer("members.fetch *", setup.roleMembers ?? "ok", RESTJSONErrorCodes.UnknownGuild, undefined)
            : answer("members.fetch " + mid, setup.member ?? "ok", RESTJSONErrorCodes.UnknownMember, { id: mid })),
        },
      }),
    },
  } as unknown as Client;
}

type Targets = { channel?: string | null; role?: string | null; member?: string | null };

/** Écrit un rappel et rend la ligne telle que `checkIntervalleAdhesion` la passe. */
async function seed(targets: Targets): Promise<adhesionIntervalIds> {
  const bdd = await getBddInstance();
  const due = new Date("2026-01-02T09:00:00Z");
  await bdd.set(
    "AdhesionInterval",
    ["message", "guild_id", "channel_id", "role_id", "member_id", "author_id", "interval_days", "iteration", "nextTransmission"],
    ["Rappel", "guild-1", targets.channel ?? null, targets.role ?? null, targets.member ?? null, "auteur-1", 7, 3, toSQLiteDate(due)],
  );
  const rows = await bdd.raw<adhesionIntervalIds>("SELECT * FROM AdhesionInterval WHERE id = (SELECT MAX(id) FROM AdhesionInterval)", []);
  return rows[0];
}

async function rowExists(id: number): Promise<boolean> {
  const bdd = await getBddInstance();
  return (await bdd.raw("SELECT id FROM AdhesionInterval WHERE id = ?", [id])).length === 1;
}

/** Résumé stable de la valeur rendue. */
function summary(result: Awaited<ReturnType<typeof fetchTargets>>): unknown {
  if (result === null) return null;
  return {
    guild: (result.guild as unknown as { id: string }).id,
    channel: (result.channel as unknown as { id: string } | null)?.id ?? null,
    role: (result.role as unknown as { id: string } | null)?.id ?? null,
    member: (result.member as unknown as { id: string } | null)?.id ?? null,
    author: result.author.id,
    message: result.message,
    iteration: result.iteration,
    interval_days: result.interval_days,
  };
}

async function run(setup: Setup, targets: Targets) {
  const interval = await seed(targets);
  const trace: string[] = [];
  const result = await fetchTargets(fakeClient(trace, setup), await getBddInstance(), interval);
  return { id: interval.id, interval, trace, result, kept: await rowExists(interval.id) };
}

test("toutes les cibles trouvées : rendues telles quelles, rien d'écrit", async () => {
  const r = await run({}, { channel: "c1", role: "r1", member: "m1" });
  assert.deepEqual(r.trace, ["users.fetch auteur-1", "guilds.fetch guild-1", "channels.fetch c1", "roles.fetch r1", "members.fetch m1", "members.fetch *"]);
  assert.deepEqual(summary(r.result), {
    guild: "guild-1", channel: "c1", role: "r1", member: "m1", author: "auteur-1", message: "Rappel", iteration: 3, interval_days: 7,
  });
  assert.equal(r.result?.nextTransmission.getTime(), new Date(r.interval.nextTransmission).getTime());
  // Membres du rôle lus ici et transmis à l'envoi, qui ne les relit pas.
  assert.deepEqual(r.result?.roleMembers, []);
  assert.equal(r.kept, true);
});

test("sans cible : seuls l'auteur et le serveur sont lus", async () => {
  const r = await run({}, {});
  assert.deepEqual(r.trace, ["users.fetch auteur-1", "guilds.fetch guild-1"]);
  assert.equal(r.result?.roleMembers, null);
  assert.deepEqual(summary(r.result), {
    guild: "guild-1", channel: null, role: null, member: null, author: "auteur-1", message: "Rappel", iteration: 3, interval_days: 7,
  });
});

test("auteur injoignable pour l'instant : report journalisé, ligne gardée", async () => {
  const r = await run({ author: "flaky" }, { member: "m1" });
  assert.equal(r.result, null);
  assert.deepEqual(r.trace, ["users.fetch auteur-1", `log Interval n°${r.id} : auteur injoignable pour l'instant, report.`]);
  assert.equal(r.kept, true);
});

test("auteur disparu : rappel supprimé, journal seul (personne à prévenir)", async () => {
  const r = await run({ author: "gone" }, { member: "m1" });
  assert.equal(r.result, null);
  assert.deepEqual(r.trace, [
    "users.fetch auteur-1",
    "log L'auteur de l'interval guild-1 est perdu. Suppression de l'interval...",
    "log ",
  ]);
  assert.equal(r.kept, false);
});

test("serveur injoignable pour l'instant : report journalisé, ligne gardée", async () => {
  const r = await run({ guild: "flaky" }, { member: "m1" });
  assert.equal(r.result, null);
  assert.deepEqual(r.trace, ["users.fetch auteur-1", "guilds.fetch guild-1", `log Interval n°${r.id} : serveur injoignable pour l'instant, report.`]);
  assert.equal(r.kept, true);
});

test("serveur quitté : rappel supprimé, l'auteur prévenu", async () => {
  const r = await run({ guild: "gone" }, { member: "m1" });
  const msg = `Intervale n°${r.id} annulée car le bot n'est plus sur le serveur concerné.`;
  assert.equal(r.result, null);
  assert.deepEqual(r.trace, ["users.fetch auteur-1", "guilds.fetch guild-1", "log " + msg, "dm:auteur-1 " + msg]);
  assert.equal(r.kept, false);
});

test("salon introuvable : cible retirée, l'auteur prévenu, les autres cibles gardent le rappel", async () => {
  const r = await run({ channel: "null" }, { channel: "c1", member: "m1" });
  assert.deepEqual(r.trace, [
    "users.fetch auteur-1", "guilds.fetch guild-1", "channels.fetch c1",
    `dm:auteur-1 Le channel n'est plus valide pour l'interval n°${r.id}, suppression de la cible.`,
    "members.fetch m1",
  ]);
  assert.equal((summary(r.result) as { channel: unknown }).channel, null);
  assert.equal(r.interval.channel_id, null);
  assert.equal(r.kept, true);
});

test("salon disparu, seule cible : retiré, puis le rappel sans cible est supprimé", async () => {
  const r = await run({ channel: "gone" }, { channel: "c1" });
  const end = `L'intervalle ${r.id} n'a plus de cible. Suppression...`;
  assert.deepEqual(r.trace, [
    "users.fetch auteur-1", "guilds.fetch guild-1", "channels.fetch c1",
    `dm:auteur-1 Le channel n'est plus valide pour l'interval n°${r.id}, suppression de la cible.`,
    "log " + end, "dm:auteur-1 " + end,
  ]);
  // La valeur est quand même rendue : c'est l'appelant qui l'envoie à vide.
  assert.equal((summary(r.result) as { channel: unknown }).channel, null);
  assert.equal(r.kept, false);
});

test("salon en panne passagère : abandon sans rien toucher", async () => {
  const r = await run({ channel: "flaky" }, { channel: "c1", role: "r1" });
  assert.equal(r.result, null);
  assert.deepEqual(r.trace, ["users.fetch auteur-1", "guilds.fetch guild-1", "channels.fetch c1"]);
  assert.equal(r.interval.channel_id, "c1");
  assert.equal(r.kept, true);
});

test("rôle introuvable, seule cible : retiré, puis rappel supprimé", async () => {
  const r = await run({ role: "null" }, { role: "r1" });
  const end = `L'intervalle ${r.id} n'a plus de cible. Suppression...`;
  assert.deepEqual(r.trace, [
    "users.fetch auteur-1", "guilds.fetch guild-1", "roles.fetch r1",
    `dm:auteur-1 Le role n'est plus valide pour l'interval ${r.id}, suppression de la cible.`,
    "log " + end, "dm:auteur-1 " + end,
  ]);
  assert.equal((summary(r.result) as { role: unknown }).role, null);
  assert.equal(r.kept, false);
});

test("rôle illisible : l'erreur remonte à l'appelant", async () => {
  const interval = await seed({ role: "r1" });
  const trace: string[] = [];
  await assert.rejects(fetchTargets(fakeClient(trace, { role: "flaky" }), await getBddInstance(), interval), /Service Unavailable/);
  assert.deepEqual(trace, ["users.fetch auteur-1", "guilds.fetch guild-1", "roles.fetch r1"]);
});

test("membre disparu à côté d'un rôle : membre retiré, l'auteur prévenu, rappel gardé", async () => {
  const r = await run({ member: "gone" }, { role: "r1", member: "m1" });
  assert.deepEqual(r.trace, [
    "users.fetch auteur-1", "guilds.fetch guild-1", "roles.fetch r1", "members.fetch m1",
    `dm:auteur-1 Le membre n'est plus valide pour l'interval ${r.id}, suppression de la cible.`,
    "members.fetch *",
  ]);
  assert.deepEqual(summary(r.result), {
    guild: "guild-1", channel: null, role: "r1", member: null, author: "auteur-1", message: "Rappel", iteration: 3, interval_days: 7,
  });
  assert.equal(r.interval.member_id, null);
  assert.equal(r.kept, true);
});

test("membre en panne passagère : abandon sans rien toucher", async () => {
  const r = await run({ member: "flaky" }, { channel: "c1", member: "m1" });
  assert.equal(r.result, null);
  assert.deepEqual(r.trace, ["users.fetch auteur-1", "guilds.fetch guild-1", "channels.fetch c1", "members.fetch m1"]);
  assert.equal(r.kept, true);
});

test("membres du rôle injoignables : report journalisé, l'auteur prévenu, rien d'écrit ni consommé", async () => {
  const r = await run({ roleMembers: "flaky" }, { role: "r1", member: "m1" });
  assert.equal(r.result, null);
  assert.deepEqual(r.trace, [
    "users.fetch auteur-1", "guilds.fetch guild-1", "roles.fetch r1", "members.fetch m1", "members.fetch *",
    `log Interval n°${r.id} : membres du rôle injoignables pour l'instant, report.`,
    `dm:auteur-1 Rappel d'adhésion n°${r.id} reporté : Discord n'a pas permis de lire les membres du rôle « Bureau ». ` +
      "Rien n'est parti, nouvel essai à la prochaine vérification (/delete-rappel-adhesion pour l'arrêter).",
  ]);
  assert.equal(r.interval.role_id, "r1");
  assert.equal(r.kept, true);
});

test("ferme la base à la fin de la suite", async () => {
  assert.equal(await resetBddInstance(), true);
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});
