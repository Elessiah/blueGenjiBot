import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import fs from "node:fs";

// Isolation BDD : fichier SQLite temporaire propre a ce fichier, pose avant
// le premier appel a getBddInstance().
const TMP_DB = path.join(os.tmpdir(), `bgenji-scrim-${randomUUID()}.sqlite`);
process.env.BDD_PATH = TMP_DB;

import type { Client, ChatInputCommandInteraction } from "discord.js";
import { scrim, SCRIM_GAME, SCRIM_GAME_LABEL } from "../../commandsHandlers/scrim.js";
import { commands } from "../../config/commands.js";
import { getBddInstance, closeBddInstance } from "../../bdd/Bdd.js";
import { setModuleEnabled } from "../../modules/moduleGuard.js";

type Reply = { content: string };

/** Interaction minimale : options lues par nom, reponses capturees. */
function fakeInteraction(options: Record<string, string>, userId: string) {
  const replies: Reply[] = [];
  const interaction = {
    user: { id: userId },
    guild: { name: "Serveur test" },
    client: {},
    options: {
      getString(name: string, required?: boolean): string | null {
        if (name in options) return options[name];
        if (required) throw new Error(`option requise absente : ${name}`);
        return null;
      },
    },
    async reply(payload: Reply) { replies.push(payload); },
    async editReply(payload: Reply) { replies.push(payload); },
  };
  return { interaction: interaction as unknown as ChatInputCommandInteraction, replies };
}

const client = null as unknown as Client;

test("/scrim ne propose plus de choix de jeu", () => {
  const options = (commands.scrim.parameters as { options?: { name: string }[] }).options ?? [];
  assert.deepEqual(options.map((o) => o.name), ["niveau"]);
  assert.match(commands.scrim.parameters.description, /Marvel Rivals/);
});

test("aucune commande ne propose Overwatch", () => {
  assert.doesNotMatch(JSON.stringify(commands), /overwatch/i);
});

test("/recrute annonce Marvel Rivals", () => {
  assert.match(commands.recrute.parameters.description, /Marvel Rivals/);
});

test("/scrim enregistre toujours Marvel Rivals, sans option jeu", async () => {
  const userId = "900000000000000001";
  const { interaction, replies } = fakeInteraction({ niveau: "avance" }, userId);
  await scrim(client, interaction, "910000000000000001");

  const bdd = await getBddInstance();
  const rows = await bdd.raw<{ game: string; level: string }>(
    "SELECT game, level FROM Scrim WHERE id_author = ?",
    [userId]
  );
  assert.deepEqual(rows.map((r) => ({ ...r })), [{ game: SCRIM_GAME, level: "avance" }]);
  assert.equal(SCRIM_GAME, "marvel_rivals");
  assert.equal(replies.length, 1);
  assert.equal(replies[0].content, `Recherche de scrim publiee : **${SCRIM_GAME_LABEL}** (avance).`);
});

test("/scrim ignore une ancienne option jeu envoyee par un client en cache", async () => {
  const userId = "900000000000000002";
  const { interaction } = fakeInteraction({ jeu: "overwatch2", niveau: "debutant" }, userId);
  await scrim(client, interaction, "910000000000000001");

  const bdd = await getBddInstance();
  const rows = await bdd.raw<{ game: string }>("SELECT game FROM Scrim WHERE id_author = ?", [userId]);
  assert.deepEqual(rows.map((r) => r.game), [SCRIM_GAME]);
});

test("/scrim refuse d'ecrire quand le module scrims est desactive", async () => {
  const guildId = "910000000000000002";
  const userId = "900000000000000003";
  await setModuleEnabled(guildId, "scrims", false);
  const { interaction, replies } = fakeInteraction({ niveau: "avance" }, userId);
  await scrim(client, interaction, guildId);

  const bdd = await getBddInstance();
  const rows = await bdd.raw<{ game: string }>("SELECT game FROM Scrim WHERE id_author = ?", [userId]);
  assert.equal(rows.length, 0);
  assert.equal(replies[0].content, "Le module Scrims est desactive sur ce serveur.");
});

test.after(async () => {
  closeBddInstance();
  await new Promise((r) => setTimeout(r, 50));
  try { fs.unlinkSync(TMP_DB); } catch { /* noop */ }
});
