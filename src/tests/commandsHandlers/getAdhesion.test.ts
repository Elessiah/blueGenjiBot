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

/**
 * Fausse interaction `/get-adhesion` : chaque réponse et chaque MP passent
 * dans `trace`. Le rôle visé est `@everyone` (même identifiant que le serveur).
 * @param trace Trace ordonnée des sorties.
 * @param interval Valeur de l'option `interval`, ou `null`.
 * @returns L'interaction.
 */
function everyoneInteraction(trace: string[], interval: string | null): ChatInputCommandInteraction {
  const guild = { id: "guild-1" };
  const role = { id: "guild-1", guild, name: "@everyone", members: new Map() };
  const record = (kind: string) => async (payload: { content?: string } | string) => {
    trace.push(kind + " " + (typeof payload === "string" ? payload : payload.content ?? ""));
    return { id: "m-" + trace.length };
  };
  return {
    guild,
    user: { id: "author", send: record("dm:author") },
    client: {} as Client,
    reply: record("reply"),
    followUp: record("followUp"),
    options: {
      getString: (name: string) => (name === "interval" ? interval : null),
      getChannel: () => null,
      getMember: () => null,
      getRole: () => role,
    },
  } as unknown as ChatInputCommandInteraction;
}

test("@everyone refusé à l'envoi : réponse claire, aucun MP", async () => {
  const trace: string[] = [];
  await getAdhesion({} as Client, everyoneInteraction(trace, null));
  assert.deepEqual(trace, ["reply Envoie des adhésions en cours...", "followUp " + EVERYONE_NOTICE]);
});

test("@everyone refusé à la création d'un rappel : rien n'est enregistré ni envoyé", async () => {
  const trace: string[] = [];
  await getAdhesion({} as Client, everyoneInteraction(trace, "30"));
  assert.deepEqual(trace, ["reply Envoie des adhésions en cours...", "followUp " + EVERYONE_NOTICE]);
  assert.equal(fs.existsSync(process.env.BDD_PATH ?? ""), false);
});
