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
  /** La récupération des membres du serveur lève (cache incomplet). */
  fetchFails?: boolean;
  /** Le cache paraît incomplet : chaque lecture du rôle récupérerait le serveur. */
  incompleteCache?: boolean;
  /** Compteur des récupérations complètes des membres du serveur. */
  fetches?: number;
  /** Un salon est aussi demandé. */
  channel?: boolean;
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
  const fetch = async () => {
    setup.fetches = (setup.fetches ?? 0) + 1;
    if (setup.fetchFails) throw new Error("Members didn't arrive in time.");
  };
  const incomplete = setup.fetchFails || setup.incompleteCache;
  const guild = { id: "guild-1", memberCount: cache.size + (incomplete ? 1 : 0), members: { cache, fetch } };
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
      getChannel: () => (setup.channel ? { name: "general", guild, send: record("channel:general") } : null),
      getMember: () => null,
      getRole: () => role,
    },
  } as unknown as ChatInputCommandInteraction;
}

// Fichiers d'adhésion valides : un envoi qui part va jusqu'au bout.
fs.writeFileSync(path.join(TMP_DIR, "adhesion.pdf"), "adhesion");
fs.writeFileSync(path.join(TMP_DIR, "statut.pdf"), "statut");
fs.writeFileSync(path.join(TMP_DIR, "paths.json"), JSON.stringify({
  adhesion: path.join(TMP_DIR, "adhesion.pdf"), adhesionName: "adhesion.pdf",
  status: path.join(TMP_DIR, "statut.pdf"), statusName: "statut.pdf",
}));
const PAPERS = "Voici les papiers pour l'adhésion à l'association BlueGenji :";
const PERMISSION_WARNING = "\nVous n'avez pas les permissions pour envoyer un message ailleurs que dans vos MP !";

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
    "au-delà de la limite de 50 messages privés par envoi. Aucun membre n'a reçu les adhésions en message privé. " +
    "Visez un rôle plus restreint, ou envoyez-les dans un salon ! Aucun rappel n'a été enregistré."]);
  assert.equal(fs.existsSync(process.env.BDD_PATH ?? ""), false);
});

test("sans permission, @everyone n'est pas refusé : l'auteur reçoit sa propre copie", async () => {
  const trace: string[] = [];
  await getAdhesion(quietClient, fakeInteraction(trace, { everyone: true, admin: false }));
  assert.deepEqual(trace, [PENDING, "dm:author " + PAPERS + PERMISSION_WARNING, "followUp Envoi réussi !"]);
});

test("intervalle illisible : aucun rappel, l'envoi immédiat suit son cours sans refus de plafond", async () => {
  const trace: string[] = [];
  await getAdhesion(quietClient, fakeInteraction(trace, { members: 51, interval: "abc" }));
  // Le plafond est vérifié à l'envoi même : refus en MP, aucun rappel.
  assert.equal(trace.some((t) => t.includes("Aucun rappel")), false);
  assert.equal(trace.some((t) => t.startsWith("dm:u")), false);
  assert.ok(trace.some((t) => t.startsWith("dm:author Envoi en message privé refusé")));
  // La réponse à la commande répète le refus : l'auteur aux MP fermés le voit.
  assert.ok((trace.at(-1) ?? "").startsWith("followUp Echec de l'envoi !\nEnvoi en message privé refusé : Le rôle « Membres » compte 51 membres"));
});

test("rappel vers un rôle illisible : refusé, rien n'est enregistré ni envoyé", async () => {
  const trace: string[] = [];
  await getAdhesion(quietClient, fakeInteraction(trace, { members: 3, interval: "30", fetchFails: true }));
  assert.deepEqual(trace, [PENDING, "followUp Echec de l'envoi des adhésions en message privé aux membres du rôle « Membres » : " +
    "Discord n'a pas permis de les lire, aucun ne les a reçus. Réessayez plus tard en ne visant que ce rôle ! " +
    "Aucun rappel n'a été enregistré."]);
  assert.equal(fs.existsSync(process.env.BDD_PATH ?? ""), false);
});

test("@everyone avec un salon : refusé en entier, l'avis dit que le salon n'a rien reçu", async () => {
  const trace: string[] = [];
  await getAdhesion(quietClient, fakeInteraction(trace, { everyone: true, channel: true }));
  assert.deepEqual(trace, [PENDING, "followUp " + EVERYONE_NOTICE +
    " Rien n'est parti, pas même dans le salon demandé : relancez la commande sans ce rôle."]);
});

test("rôle de 50 membres : tous servis, envoi réussi", async () => {
  const trace: string[] = [];
  await getAdhesion(quietClient, fakeInteraction(trace, { members: 50, interval: null }));
  assert.equal(trace.filter((t) => t.startsWith("dm:u")).length, 50);
  assert.equal(trace.at(-1), "followUp Envoi réussi !");
});

// Dernier du fichier : le rappel accepté écrit dans la base jetable.
test("rappel accepté : les membres lus pour le plafond servent à l'envoi, sans seconde récupération", async () => {
  const trace: string[] = [];
  const setup: Setup = { members: 3, interval: "30", incompleteCache: true };
  await getAdhesion(quietClient, fakeInteraction(trace, setup));
  assert.equal(setup.fetches, 1);
  assert.equal(trace.filter((t) => t.startsWith("dm:u")).length, 3);
  assert.ok(trace.includes("followUp Envoi réussi !"));
});
