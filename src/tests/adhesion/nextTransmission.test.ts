import test from "node:test";
import assert from "node:assert/strict";

import { ADHESION_REMINDER_HOUR, nextTransmissionAfter } from "../../adhesion/nextTransmission.js";
import { toSQLiteDate } from "../../utils/toSQLiteDatetime.js";

/**
 * Ces tests referment la boucle que trois conventions separees avaient ouverte.
 *
 * Une date de prochain envoi ne vaut rien en elle-meme : elle vaut par le fait
 * que la requete de releve la trouve **due** au moment ou le cron passe. Or
 * cette requete compare des chaines UTC (`nextTransmission <= DATETIME('now')`),
 * le cron est regle sur `Europe/Paris`, et la date se calculait sur l'horloge
 * du serveur. Trois conventions, aucune assertion pour les relier.
 *
 * L'instant de declenchement du cron est donc recalcule ici **de bout en bout**,
 * a partir de sa definition (`0 10 * * *`, fuseau Europe/Paris) et par un
 * lecteur `Intl` ecrit sur place : si le module sous test se trompait de fuseau,
 * rien dans ce fichier ne se tromperait avec lui.
 */

const PARIS = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Paris",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** L'heure parisienne affichee a un instant donne, au format `HH:MM:SS`. */
function parisClock(instant: Date): string {
  return PARIS.format(instant);
}

/**
 * Instant auquel le cron `0 10 * * *` (Europe/Paris) se declenche, le jour
 * calendaire UTC de `day`. Balaye les 24 heures rondes de la journee : 10:00
 * parisien tombe sur une heure ronde UTC, en hiver comme en ete.
 */
function cronFiresOn(day: Date): Date {
  const minuit = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
  for (let heure = 0; heure < 24; heure++) {
    const candidat = new Date(minuit + heure * 3600000);
    if (parisClock(candidat) === "10:00:00") return candidat;
  }
  throw new Error("aucun declenchement trouve le " + day.toISOString());
}

/** Ce que rendrait `DATETIME('now')` de SQLite a cet instant : de l'UTC, a la seconde. */
function sqliteNow(instant: Date): string {
  return toSQLiteDate(instant);
}

test("la date inscrite est exactement l'instant ou le cron passera", () => {
  const pose = new Date("2026-07-01T09:13:00Z");
  const prevu = nextTransmissionAfter(pose, 14);

  assert.equal(prevu.getTime(), cronFiresOn(new Date("2026-07-15T00:00:00Z")).getTime());
});

test("le rappel est du au passage du cron, ete comme hiver", () => {
  // L'assertion qui aurait vu le defaut. Les deux chaines sont au meme format
  // de largeur fixe, donc les comparer comme le fait SQLite revient a les
  // comparer chronologiquement.
  for (const [pose, cadence] of [
    ["2026-07-01T09:13:00Z", 14],
    ["2026-01-15T22:40:00Z", 30],
    ["2026-03-26T12:00:00Z", 7],
    ["2026-10-22T12:00:00Z", 7],
  ] as Array<[string, number]>) {
    const prevu = nextTransmissionAfter(new Date(pose), cadence);
    const passage = cronFiresOn(prevu);

    assert.ok(
      sqliteNow(prevu) <= sqliteNow(passage),
      "pas du au passage du cron : " + sqliteNow(prevu) + " > " + sqliteNow(passage),
    );
  }
});

test("le rappel n'est pas du la veille du terme", () => {
  // Le pendant du precedent : une date qui serait toujours due ne serait pas
  // une cadence. Sans cette borne, un `nextTransmission` pose dans le passe
  // repartirait a chaque passage du cron.
  const prevu = nextTransmissionAfter(new Date("2026-07-01T09:13:00Z"), 14);
  const veille = cronFiresOn(new Date(prevu.getTime() - 86400000));

  assert.ok(sqliteNow(prevu) > sqliteNow(veille));
});

test("une cadence quotidienne revient exactement un jour plus tard", () => {
  const premier = nextTransmissionAfter(new Date("2026-07-01T09:13:00Z"), 1);
  const second = nextTransmissionAfter(premier, 1);

  assert.equal(second.getTime() - premier.getTime(), 86400000);
});

test("un jour de changement d'heure ne dure pas 24 h, et la cadence le suit", () => {
  // Le 29 mars 2026, Paris perd une heure. Un rappel quotidien pose la veille
  // repart bien a 10:00 parisien, donc 23 h plus tard en temps absolu : c'est
  // l'heure murale annoncee qui est tenue, pas un intervalle constant.
  const veille = nextTransmissionAfter(new Date("2026-03-27T12:00:00Z"), 1);
  const lendemain = nextTransmissionAfter(veille, 1);

  assert.equal(parisClock(veille), "10:00:00");
  assert.equal(parisClock(lendemain), "10:00:00");
  assert.equal(lendemain.getTime() - veille.getTime(), 23 * 3600000);
});

test("une cadence nulle vise le meme jour", () => {
  // `/adhesion-valide` pose un rappel a `interval_days = 0` : son unique envoi
  // est date a part, la cadence ne sert jamais. Le cas ne doit pas pour autant
  // produire une date absurde.
  const memeJour = nextTransmissionAfter(new Date("2026-07-01T09:13:00Z"), 0);
  assert.equal(memeJour.toISOString(), "2026-07-01T08:00:00.000Z");
});

test("l'heure annoncee par la doc est celle du module", () => {
  // `doc/adhesions-commands-user.md` l'ecrit deux fois : 10:00, Europe/Paris.
  assert.equal(ADHESION_REMINDER_HOUR, 10);
  assert.equal(parisClock(nextTransmissionAfter(new Date("2026-02-11T06:00:00Z"), 5)), "10:00:00");
});
