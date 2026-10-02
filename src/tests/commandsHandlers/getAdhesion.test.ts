import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";

// Base jetable désignée avant l'import : un rappel enregistré y serait écrit.
const TMP_DIR = path.join(os.tmpdir(), "bgenji-get-adhesion-" + randomUUID());
fs.mkdirSync(TMP_DIR, { recursive: true });
process.env.BDD_PATH = path.join(TMP_DIR, "bot.sqlite");
process.env.ADHESIONS_PATH = TMP_DIR;
process.env.OWNER_ID = "owner-1";
process.env.INFO_SERV = "admin-channel-1";

import { getAdhesion } from "../../commandsHandlers/adhesions/getAdhesion.js";
import type { ChatInputCommandInteraction, Client } from "discord.js";

const EVERYONE_NOTICE = "Envoi refusé : le rôle @​everyone ne peut pas être visé, " +
  "il enverrait les adhésions en message privé à tout le serveur. " +
  "Visez un rôle plus restreint, ou envoyez-les dans un salon !";
const PENDING = "reply Envoie des adhésions en cours...";

type Setup = {
  /** Le rôle visé est `@everyone` (même identifiant que le serveur). */
  everyone?: boolean;
  /** Nombre de membres (hors bots) du rôle visé. */
  members?: number;
  /** Valeur de l'option `interval`, ou `null`. */
  interval?: string | null;
  /** L'auteur est le propriétaire du bot (sinon : aucune permission). */
  admin?: boolean;
};

/**
 * Fausse interaction `/get-adhesion` : chaque réponse et chaque MP passent
 * dans `trace`. Le cache des membres est complet : aucune récupération.
 * @param trace Trace ordonnée des sorties.
 * @param setup Rôle visé et options.
 * @returns L'interaction.
 */
function fakeInteraction(trace: string[], setup: Setup): ChatInputCommandInteraction {
  const record = (kind: string) => async (payload: { content?: string } | string) => {
    trace.push(kind + " " + (typeof payload === "string" ? payload : payload.content ?? ""));
    return { id: "m-" + trace.length };
  };
  const users = Array.from({ length: setup.members ?? 0 }, (_, i) => ({ user: { id: "u" + i, bot: false, send: record("dm:u" + i) } }));
  const cache = new Map(users.map((m) => [m.user.id, m]));
  const guild = { id: "guild-1", memberCount: cache.size, members: { cache, fetch: async () => undefined } };
  const role = {
    id: setup.everyone ? "guild-1" : "role-1",
    name: setup.everyone ? "@everyone" : "Membres",
    guild,
    members: { values: () => users.values() },
  };
  const author = { id: setup.admin === false ? "author" : "owner-1", send: record("dm:author") };
  return {
    guild,
    user: author,
    member: author,
    channel: null,
    client: {} as Client,
    reply: record("reply"),
    followUp: record("followUp"),
    options: {
      getString: (name: string) => (name === "interval" ? setup.interval ?? null : null),
      getChannel: () => null,
      getMember: () => null,
      getRole: () => role,
    },
  } as unknown as ChatInputCommandInteraction;
}

const quietClient = { users: { fetch: async () => ({ send: async () => ({}) }) }, channels: { fetch: async () => ({ send: async () => ({}) }) } } as unknown as Client;

test("@everyone refusé à l'envoi : réponse claire, aucun MP", async () => {
  const trace: string[] = [];
  await getAdhesion(quietClient, fakeInteraction(trace, { everyone: true }));
  assert.deepEqual(trace, [PENDING, "followUp " + EVERYONE_NOTICE]);
});

test("@everyone refusé à la création d'un rappel : rien n'est enregistré ni envoyé", async () => {
  const trace: string[] = [];
  await getAdhesion(quietClient, fakeInteraction(trace, { everyone: true, interval: "30" }));
  assert.deepEqual(trace, [PENDING, "followUp " + EVERYONE_NOTICE]);
  assert.equal(fs.existsSync(process.env.BDD_PATH ?? ""), false);
});

test("rappel vers un rôle de 51 membres : refusé avant tout envoi, rien n'est enregistré", async () => {
  const trace: string[] = [];
  await getAdhesion(quietClient, fakeInteraction(trace, { members: 51, interval: "30" }));
  assert.deepEqual(trace, [PENDING, "followUp Envoi en message privé refusé : Le rôle « Membres » compte 51 membres, " +
    "au-delà de la limite de 50 messages privés par envoi. Personne n'a reçu les adhésions. " +
    "Visez un rôle plus restreint, ou envoyez-les dans un salon ! Aucun rappel n'a été enregistré."]);
  assert.equal(fs.existsSync(process.env.BDD_PATH ?? ""), false);
});

test("sans permission, @everyone n'est pas refusé : l'auteur reçoit sa propre copie", async () => {
  const trace: string[] = [];
  await getAdhesion(quietClient, fakeInteraction(trace, { everyone: true, admin: false }));
  assert.equal(trace.includes("followUp " + EVERYONE_NOTICE), false);
  assert.ok(trace.some((t) => t.startsWith("dm:author")));
});
