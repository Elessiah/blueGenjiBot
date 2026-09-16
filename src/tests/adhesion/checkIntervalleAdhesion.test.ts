import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";

// Meme montage que `tests/check/checkBan.test.ts` : une base jetable, designee
// **avant** l'import du module, puisque le singleton l'ouvre a son premier
// appel. `ADHESIONS_PATH` suit la meme regle — sans lui, `sendAdhesion` ecrit
// un `paths.json` dans le dossier courant du runner.
const TMP_DIR = path.join(os.tmpdir(), "bgenji-adhesion-" + randomUUID());
fs.mkdirSync(TMP_DIR, { recursive: true });
fs.writeFileSync(path.join(TMP_DIR, "adhesion.pdf"), "adhesion");
fs.writeFileSync(path.join(TMP_DIR, "statut.pdf"), "statut");
fs.writeFileSync(
  path.join(TMP_DIR, "paths.json"),
  JSON.stringify({
    adhesion: path.join(TMP_DIR, "adhesion.pdf"),
    adhesionName: "adhesion.pdf",
    status: path.join(TMP_DIR, "statut.pdf"),
    statusName: "statut.pdf",
  }),
);
process.env.BDD_PATH = path.join(TMP_DIR, "bot.sqlite");
process.env.ADHESIONS_PATH = TMP_DIR;
process.env.OWNER_ID = "owner-1";
process.env.INFO_SERV = "admin-channel-1";

import { getBddInstance, closeBddInstance } from "../../bdd/Bdd.js";
import { checkIntervalleAdhesion } from "../../adhesion/checkIntervalleAdhesion.js";
import { ITERATION_UNLIMITED } from "../../adhesion/iteration.js";
import { nextTransmissionAfter } from "../../adhesion/nextTransmission.js";
import { toSQLiteDate } from "../../utils/toSQLiteDatetime.js";
import { DiscordAPIError } from "discord.js";
import { RESTJSONErrorCodes } from "discord-api-types/v10";
import type { Client } from "discord.js";

/**
 * La periodicite, la persistance et la visibilite des rappels d'adhesion, sur
 * une **vraie** base.
 *
 * Ce module n'avait aucun test, et c'est ce qui laissait ses deux pieges du
 * zero invisibles : ils ne tiennent ni a une signature ni a un type, seulement
 * a ce qui finit ecrit dans la colonne. Les assertions portent donc sur la
 * ligne relue apres coup, jamais sur ce que la fonction a appele.
 */

/** Ce que le faux client a recu, pour distinguer « pas appele » de « a echoue ». */
type Trace = { dms: string[]; logs: string[] };

/**
 * Ce que Discord repond quand un membre n'existe plus, par opposition a une
 * panne passagere. `isGone` ne regarde que ce code-la, et la difference decide
 * d'une **suppression definitive** : il faut donc la vraie classe d'erreur, pas
 * un `Error` au meme libelle.
 */
function membreInconnu(): DiscordAPIError {
  return new DiscordAPIError(
    { code: RESTJSONErrorCodes.UnknownMember, message: "Unknown Member" },
    RESTJSONErrorCodes.UnknownMember,
    404,
    "GET",
    "https://discord.invalid",
    {},
  );
}

/** `"gone"` = le membre n'existe plus, `"flaky"` = on n'a pas pu le joindre. */
type MemberFailure = "none" | "gone" | "flaky";

function fakeClient(trace: Trace, memberFailure: MemberFailure = "none"): Client {
  const sendTo = (bucket: string[]) => async (payload: unknown) => {
    const text = typeof payload === "string"
      ? payload
      : String((payload as { content?: unknown })?.content ?? "");
    bucket.push(text);
    return { id: "msg-" + bucket.length };
  };
  const asUser = (id: string) => ({
    id,
    globalName: "Membre " + id,
    send: sendTo(id === process.env.OWNER_ID ? trace.logs : trace.dms),
  });
  return {
    users: { fetch: async (id: string) => asUser(id) },
    channels: { fetch: async () => ({ send: sendTo(trace.logs) }) },
    guilds: {
      fetch: async (id: string) => ({
        id,
        channels: { fetch: async () => null },
        roles: { fetch: async () => null },
        members: {
          fetch: async (memberId: string) => {
            if (memberFailure === "gone") throw membreInconnu();
            if (memberFailure === "flaky") throw new Error("Service Unavailable");
            return { id: memberId, user: asUser(memberId) };
          },
        },
      }),
    },
  } as unknown as Client;
}

function newTrace(): Trace {
  return { dms: [], logs: [] };
}

/** Une ligne `AdhesionInterval` due depuis hier, sauf date contraire. */
async function seedRappel(over: {
  iteration?: number,
  interval_days?: number,
  nextTransmission?: Date,
} = {}): Promise<number> {
  const bdd = await getBddInstance();
  const due = over.nextTransmission ?? new Date(Date.now() - 86400000);
  await bdd.set(
    "AdhesionInterval",
    ["message", "guild_id", "member_id", "author_id", "interval_days", "iteration", "nextTransmission"],
    [
      "Pense a ton adhesion",
      "guild-1",
      "membre-" + randomUUID().slice(0, 8),
      "auteur-1",
      over.interval_days ?? 14,
      over.iteration ?? ITERATION_UNLIMITED,
      toSQLiteDate(due),
    ],
  );
  const rows = await bdd.raw<{ id: number }>("SELECT MAX(id) AS id FROM AdhesionInterval", []);
  return rows[0].id;
}

type Row = { id: number, iteration: number, interval_days: number, nextTransmission: string };

async function readRappel(id: number): Promise<Row | null> {
  const bdd = await getBddInstance();
  const rows = await bdd.raw<Row>("SELECT * FROM AdhesionInterval WHERE id = ?", [id]);
  return rows[0] ?? null;
}

test("un rappel sans terme repart pour une periode complete", async () => {
  const id = await seedRappel({ interval_days: 14 });
  const avant = new Date();

  await checkIntervalleAdhesion(fakeClient(newTrace()));

  const apres = await readRappel(id);
  assert.notEqual(apres, null);
  // La cadence est relue sur la ligne, pas recopiee ici : c'est elle qui decide.
  assert.equal(apres!.nextTransmission, toSQLiteDate(nextTransmissionAfter(avant, 14)));
  assert.equal(apres!.iteration, ITERATION_UNLIMITED);
});

test("la date reecrite est bien a 10:00 heure de Paris", async () => {
  const id = await seedRappel({ interval_days: 3 });

  await checkIntervalleAdhesion(fakeClient(newTrace()));

  const apres = await readRappel(id);
  const heureParis = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Paris",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    // La colonne est de l'UTC sans suffixe : le `Z` le dit a `Date`.
  }).format(new Date(apres!.nextTransmission.replace(" ", "T") + "Z"));

  assert.equal(heureParis, "10:00");
});

test("chaque passage consomme un envoi et le laisse ecrit", async () => {
  // La persistance : un decompte qui ne se releve pas en base recommencerait
  // au redemarrage suivant, et le rappel n'aurait plus de terme.
  const id = await seedRappel({ iteration: 3 });

  await checkIntervalleAdhesion(fakeClient(newTrace()));
  assert.equal((await readRappel(id))!.iteration, 2);

  // Le second passage ne peut avoir lieu que si la ligne est redevenue due.
  const bdd = await getBddInstance();
  await bdd.raw("UPDATE AdhesionInterval SET nextTransmission = ? WHERE id = ?", [
    toSQLiteDate(new Date(Date.now() - 86400000)),
    id,
  ]);
  await checkIntervalleAdhesion(fakeClient(newTrace()));
  assert.equal((await readRappel(id))!.iteration, 1);
});

test("le dernier envoi efface le rappel", async () => {
  const id = await seedRappel({ iteration: 1 });
  const trace = newTrace();

  await checkIntervalleAdhesion(fakeClient(trace));

  assert.equal(await readRappel(id), null);
  // La visibilite : l'auteur est prevenu que son rappel a pris fin, sinon il
  // le chercherait dans `/show-rappel-adhesion` sans rien y trouver.
  assert.ok(trace.dms.some((m) => m.includes("rappel") && m.includes(String(id))));
});

test("un rappel deja a zero est efface, pas rendu eternel", async () => {
  // Le piege, atteint par le seul chemin qui compte : la base. `iteration--`
  // suivi de `== 0` reecrivait ce zero en `-1`, c'est-a-dire en « sans fin ».
  const id = await seedRappel({ iteration: 0 });

  await checkIntervalleAdhesion(fakeClient(newTrace()));

  assert.equal(await readRappel(id), null);
});

test("un rappel pas encore du n'est pas touche", async () => {
  const demain = new Date(Date.now() + 86400000);
  const id = await seedRappel({ iteration: 5, nextTransmission: demain });

  await checkIntervalleAdhesion(fakeClient(newTrace()));

  const apres = await readRappel(id);
  assert.equal(apres!.iteration, 5);
  assert.equal(apres!.nextTransmission, toSQLiteDate(demain));
});

test("une cible qui n'existe plus emporte le rappel, et lui seul", async () => {
  // `fetchTargets` retire la cible perdue puis, le rappel n'ayant plus aucune
  // cible, `checkTargets` supprime la ligne. Les autres lignes de la meme passe
  // doivent poursuivre : une boucle qui s'arreterait a la premiere cible
  // disparue gelerait tous les rappels suivants.
  const perdu = await seedRappel({ iteration: 4 });
  const suivant = await seedRappel({ iteration: 4, interval_days: 7 });

  await checkIntervalleAdhesion(fakeClient(newTrace(), "gone"));

  assert.equal(await readRappel(perdu), null);
  assert.equal(await readRappel(suivant), null);
});

test("une panne passagere reporte le rappel au lieu de l'effacer", async () => {
  // La contrepartie, et c'est la regle que `isGone` protege : une limite de
  // debit ou une passerelle pas encore prete leve elle aussi. Effacer sur ce
  // motif detruirait une programmation que personne ne peut retrouver. La
  // ligne doit donc ressortir **intacte** — meme echeance, meme compteur — et
  // repasser au prochain tour.
  const id = await seedRappel({ iteration: 4, interval_days: 9 });
  const echeance = (await readRappel(id))!.nextTransmission;

  await checkIntervalleAdhesion(fakeClient(newTrace(), "flaky"));

  const apres = await readRappel(id);
  assert.notEqual(apres, null);
  assert.equal(apres!.iteration, 4);
  assert.equal(apres!.nextTransmission, echeance);
});

test("ferme la base a la fin de la suite", async () => {
  await closeBddInstance();
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});
