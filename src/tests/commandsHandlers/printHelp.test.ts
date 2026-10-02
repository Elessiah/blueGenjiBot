import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { ChatInputCommandInteraction } from "discord.js";

process.env.OWNER_ID = "900000000000000001";
process.env.INFO_SERV = "800000000000000001";

import { printHelp } from "../../commandsHandlers/printHelp.js";

/**
 * `/help` : choix du fichier selon la langue, découpage d'un texte long en
 * messages Discord (≤ 2000 caractères, paragraphes gardés entiers quand ils
 * tiennent), et repli sur une erreur lisible.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const TMP_DIR = path.join(os.tmpdir(), `bgenji-help-${randomUUID()}`);
fs.mkdirSync(TMP_DIR, { recursive: true });
const ORIGINAL_CWD = process.cwd();

type Sent = { kind: "edit" | "followUp"; content: string; ephemeral?: boolean };

function fakeInteraction(lang: string | null, logs: string[] = []): { interaction: ChatInputCommandInteraction; sent: Sent[] } {
  const sent: Sent[] = [];
  const client = {
    users: { fetch: async (id: string) => ({ id, send: async () => ({ id: "dm" }) }) },
    channels: { fetch: async () => ({ send: async (text: string) => { logs.push(text); return { id: "log" }; } }) },
  };
  const interaction = {
    client,
    deferReply: async () => {},
    editReply: async ({ content }: { content: string }) => { sent.push({ kind: "edit", content }); },
    followUp: async ({ content, flags }: { content: string; flags?: number }) => {
      sent.push({ kind: "followUp", content, ephemeral: flags !== undefined });
      return { id: "f" };
    },
    options: { getString: (name: string) => (name === "language" ? lang : null) },
  } as unknown as ChatInputCommandInteraction;
  return { interaction, sent };
}


test.after(() => {
  process.chdir(ORIGINAL_CWD);
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

test("langue absente : demande le paramètre", async () => {
  const { interaction, sent } = fakeInteraction(null);
  await printHelp(interaction.client, interaction);
  assert.deepEqual(sent, [{ kind: "edit", content: "Missing parameter 'language'. Please try again!" }]);
});

test("aide courte : un seul message, fichier choisi selon la langue", async () => {
  process.chdir(TMP_DIR);
  fs.writeFileSync("help.md", "Help in English\r\n\r\nSecond paragraph\n");
  fs.writeFileSync("helpfr.md", "  Aide en français  ");
  let run = fakeInteraction("en");
  await printHelp(run.interaction.client, run.interaction);
  assert.deepEqual(run.sent, [{ kind: "edit", content: "Help in English\n\nSecond paragraph" }]);

  run = fakeInteraction("fr");
  await printHelp(run.interaction.client, run.interaction);
  assert.deepEqual(run.sent, [{ kind: "edit", content: "Aide en français" }]);
});

test("aide vide : message d'indisponibilité, jamais un message vide", async () => {
  process.chdir(TMP_DIR);
  fs.writeFileSync("helpfr.md", "  \r\n\r\n ");
  const { interaction, sent } = fakeInteraction("fr");
  await printHelp(interaction.client, interaction);
  assert.deepEqual(sent, [{ kind: "edit", content: "Help content is currently unavailable. Please try again later." }]);
});

test("aide longue : annonce puis suivis éphémères, paragraphes regroupés sans dépasser la limite", async () => {
  process.chdir(TMP_DIR);
  const paragraph = (i: number) => `Paragraphe ${i} ` + "x".repeat(700);
  fs.writeFileSync("helpfr.md", Array.from({ length: 6 }, (_, i) => paragraph(i)).join("\n\n"));
  const { interaction, sent } = fakeInteraction("fr");
  await printHelp(interaction.client, interaction);

  const [announce, ...chunks] = sent;
  assert.equal(announce.kind, "edit");
  assert.equal(announce.content, `Showing help in French (${chunks.length} messages).`);
  assert.equal(chunks.length, 3, "deux paragraphes de 713 caractères par bloc de 1900");
  for (const chunk of chunks) {
    assert.equal(chunk.kind, "followUp");
    assert.equal(chunk.ephemeral, true);
    assert.ok(chunk.content.length <= 1900);
  }
  assert.equal(chunks.map((c) => c.content).join("\n\n"), fs.readFileSync("helpfr.md", "utf8"), "aucun texte perdu");
});

test("paragraphe trop long : coupé par lignes, puis par mots, jamais au-delà de la limite", async () => {
  process.chdir(TMP_DIR);
  const longLine = Array.from({ length: 500 }, (_, i) => `mot${i}`).join(" ");
  const lines = ["Titre", "ligne courte", "y".repeat(1880), "z".repeat(1000), longLine].join("\n");
  fs.writeFileSync("help.md", "Intro\n\n" + lines + "\n\n" + "w".repeat(2500));
  const { interaction, sent } = fakeInteraction("en");
  await printHelp(interaction.client, interaction);

  const [announce, ...chunks] = sent;
  assert.match(announce.content, /^Showing help in English \(\d+ messages\)\.$/);
  const texts = chunks.map((c) => c.content);
  for (const text of texts) {
    assert.ok(text.length > 0 && text.length <= 1900, `bloc de ${text.length} caractères`);
  }
  assert.equal(texts[0], "Intro\nTitre\nligne courte", "les lignes courtes rejoignent le bloc en cours");
  assert.ok(texts.includes("y".repeat(1880)), "une ligne qui tient reste entière");
  const words = texts.join(" ").split(/\s+/).filter((w) => w.startsWith("mot"));
  assert.equal(words.length, 500, "la ligne longue est coupée entre les mots, sans perte");
  assert.equal(texts.filter((t) => /^w+$/.test(t)).join(""), "w".repeat(2500), "un mot sans espace est coupé à la limite");
});

test("fichier introuvable : erreur rendue à l'utilisateur et au journal", async () => {
  process.chdir(TMP_DIR);
  fs.rmSync("help.md", { force: true });
  const logs: string[] = [];
  const { interaction, sent } = fakeInteraction("en", logs);
  await printHelp(interaction.client, interaction);
  assert.equal(sent.length, 1);
  assert.match(sent[0].content, /ENOENT[\s\S]*\nPlease contact elessiah$/);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /^Print help error:\n.*ENOENT/);
});

test("les aides publiées (help.md, helpfr.md) passent toutes dans des messages Discord", async () => {
  process.chdir(REPO_ROOT);
  for (const lang of ["en", "fr"]) {
    const { interaction, sent } = fakeInteraction(lang);
    await printHelp(interaction.client, interaction);
    assert.ok(sent.length >= 1, lang);
    assert.doesNotMatch(sent[0].content, /Please contact elessiah/, `${lang} : aide illisible`);
    for (const message of sent) {
      assert.ok(message.content.length > 0 && message.content.length <= 2000, `${lang} : message de ${message.content.length} caractères`);
    }
  }
});
