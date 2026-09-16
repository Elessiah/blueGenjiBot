import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";

// Base jetable designee **avant** l'import : le singleton l'ouvre a son premier
// appel. Meme montage que `tests/check/checkBan.test.ts`.
const TMP_DIR = path.join(os.tmpdir(), "bgenji-setup-" + randomUUID());
fs.mkdirSync(TMP_DIR, { recursive: true });
process.env.BDD_PATH = path.join(TMP_DIR, "bot.sqlite");
process.env.OWNER_ID = "owner-1";
process.env.INFO_SERV = "admin-channel-1";

import { getBddInstance, closeBddInstance } from "../../bdd/Bdd.js";
import { setupIntervalAdhesion } from "../../adhesion/setupIntervalAdhesion.js";
import { ITERATION_UNLIMITED } from "../../adhesion/iteration.js";
import { nextTransmissionAfter } from "../../adhesion/nextTransmission.js";
import type { ChatInputCommandInteraction, Client } from "discord.js";

/**
 * Ce que la pose d'un rappel **ecrit**, et ce qu'elle refuse d'ecrire.
 *
 * Les deux refus testes ici ont la meme forme et la meme raison d'etre a cet
 * endroit precis : `setupIntervalAdhesion` est le point de passage unique de
 * toute ecriture de rappel, alors que ses appelants sont deux et seront trois.
 * Un controle place chez l'appelant serait a refaire au suivant.
 */

/** Les reponses faites a l'auteur de la commande. */
type Trace = { followUps: string[] };

function fakeInteraction(trace: Trace): ChatInputCommandInteraction {
  const client = {
    users: { fetch: async (id: string) => ({ id, send: async () => ({ id: "dm" }) }) },
    channels: { fetch: async () => ({ send: async () => ({ id: "log" }) }) },
  } as unknown as Client;
  return {
    client,
    guild: { id: "guild-1" },
    user: { id: "auteur-1" },
    followUp: async (payload: { content?: string }) => {
      trace.followUps.push(String(payload?.content ?? ""));
      return { id: "followup-" + trace.followUps.length };
    },
  } as unknown as ChatInputCommandInteraction;
}

function fakeClient(): Client {
  return {
    users: { fetch: async (id: string) => ({ id, send: async () => ({ id: "dm" }) }) },
    channels: { fetch: async () => ({ send: async () => ({ id: "log" }) }) },
  } as unknown as Client;
}

type Row = { id: number, iteration: number, interval_days: number, nextTransmission: string };

async function tousLesRappels(): Promise<Row[]> {
  const bdd = await getBddInstance();
  return bdd.raw<Row>("SELECT * FROM AdhesionInterval", []);
}

/** Pose un rappel avec les valeurs par defaut, et rend ce qui a ete repondu. */
async function poser(nextTransmission: Date, iteration?: number): Promise<Trace> {
  const trace: Trace = { followUps: [] };
  await setupIntervalAdhesion(
    fakeClient(),
    fakeInteraction(trace),
    "Pense a ton adhesion",
    null,
    null,
    null,
    14,
    nextTransmission,
    iteration,
  );
  return trace;
}

test("un rappel sans nombre d'envois est inscrit sans terme", async () => {
  await poser(new Date("2026-07-15T08:00:00Z"));

  const rows = await tousLesRappels();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].iteration, ITERATION_UNLIMITED);
  assert.equal(rows[0].nextTransmission, "2026-07-15 08:00:00");
});

test("un nombre d'envois est inscrit tel quel", async () => {
  const avant = (await tousLesRappels()).length;

  await poser(new Date("2026-08-01T08:00:00Z"), 3);

  const rows = await tousLesRappels();
  assert.equal(rows.length, avant + 1);
  assert.equal(rows[rows.length - 1].iteration, 3);
});

test("zero envoi n'ecrit rien, et le dit", async () => {
  // Sans ce refus, `iteration ? iteration : -1` inscrivait la sentinelle :
  // demander aucun envoi posait un rappel perpetuel.
  const avant = (await tousLesRappels()).length;

  const trace = await poser(new Date("2026-08-01T08:00:00Z"), 0);

  assert.equal((await tousLesRappels()).length, avant);
  assert.ok(trace.followUps.some((m) => m.includes("aucun envoi")));
});

test("une echeance incomprise n'ecrit rien, et le dit", async () => {
  // Le cas reel : `/adhesion-valide` attend `jj/mm/aaaa` et fabrique la date
  // sans la verifier. Une saisie en ISO — celle qu'on tape par habitude —
  // produit une date invalide, sur laquelle `toSQLiteDate` levait un
  // `RangeError` **apres** que le membre a recu « votre adhesion est
  // validee ». Aucun rappel de peremption n'etait pose, et rien ne le disait.
  const avant = (await tousLesRappels()).length;

  const trace = await poser(new Date("pas une date"), 1);

  assert.equal((await tousLesRappels()).length, avant);
  assert.ok(trace.followUps.some((m) => m.includes("jj/mm/aaaa")));
});

test("une cadence hors de portee n'ecrit rien non plus", async () => {
  // L'autre bout : l'option `interval` de `/get-adhesion` est du texte libre
  // dont la description annonce « 20 jours max » sans que rien ne l'impose.
  // Une cadence assez grande sort de ce que `Date` sait representer, et le
  // calcul de l'echeance levait alors dans `Intl` — donc **avant** la garde
  // ci-dessus, qu'il court-circuitait.
  const avant = (await tousLesRappels()).length;

  const trace = await poser(nextTransmissionAfter(new Date(), 999999999), 1);

  assert.equal((await tousLesRappels()).length, avant);
  assert.ok(trace.followUps.some((m) => m.includes("invalide")));
});

test("la confirmation annonce la date, pas « dans 0 jours »", async () => {
  // La visibilite : `/adhesion-valide` pose un rappel a cadence nulle, dont
  // l'echeance est une date de peremption. Le message annoncait pourtant la
  // cadence, donc « dans 0 jours ».
  const trace = await poser(new Date("2026-09-30T08:00:00Z"), 1);

  const unix = Math.floor(Date.parse("2026-09-30T08:00:00Z") / 1000);
  assert.ok(trace.followUps.some((m) => m.includes("<t:" + unix + ":F>")));
  assert.ok(!trace.followUps.some((m) => m.includes("0 jours")));
});

test("un rappel sans terme annonce sa cadence", async () => {
  const trace = await poser(new Date("2026-09-30T08:00:00Z"));

  assert.ok(trace.followUps.some((m) => m.includes("tous les **14 jours**")));
});

test("ferme la base a la fin de la suite", async () => {
  await closeBddInstance();
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});
