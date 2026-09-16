import test from "node:test";
import assert from "node:assert/strict";

import { parisDaysLater, parisOffsetMs, parisWallClock } from "../../utils/parisTime.js";

/**
 * Toutes les assertions portent sur des **instants absolus**, jamais sur une
 * heure locale, et c'est ce qui donne leur valeur a ces tests : un instant
 * absolu ne depend pas du fuseau de la machine qui execute la suite. Le meme
 * fichier verifie donc la meme chose sur un poste a Paris et sur le runner de
 * la CI, qui est en UTC — et c'est precisement la difference entre les deux
 * qui avait produit le defaut.
 *
 * Reperes : Paris est a UTC+1 en hiver (CET) et UTC+2 en ete (CEST). 10:00
 * parisien vaut donc 09:00 UTC en hiver et 08:00 UTC en ete.
 */

test("resout 10:00 parisien en ete, soit 08:00 UTC", () => {
  const next = parisDaysLater(new Date("2026-07-01T09:13:00Z"), 0, 10);
  assert.equal(next.toISOString(), "2026-07-01T08:00:00.000Z");
});

test("resout 10:00 parisien en hiver, soit 09:00 UTC", () => {
  // La meme heure murale, une heure plus tot en temps absolu : c'est tout ce
  // qu'un `setHours` fige sur une machine en UTC ne sait pas faire.
  const next = parisDaysLater(new Date("2026-01-15T09:13:00Z"), 0, 10);
  assert.equal(next.toISOString(), "2026-01-15T09:00:00.000Z");
});

test("suit le changement d'heure de printemps traverse par l'intervalle", () => {
  // Pose le 26 mars (hiver), echeance le 2 avril (ete) : le decalage a change
  // entre les deux, et c'est celui de l'echeance qui compte.
  const next = parisDaysLater(new Date("2026-03-26T12:00:00Z"), 7, 10);
  assert.equal(next.toISOString(), "2026-04-02T08:00:00.000Z");
  assert.deepEqual(parisWallClock(next), {
    year: 2026, month: 4, day: 2, hour: 10, minute: 0, second: 0,
  });
});

test("suit le changement d'heure d'automne traverse par l'intervalle", () => {
  const next = parisDaysLater(new Date("2026-10-22T12:00:00Z"), 7, 10);
  assert.equal(next.toISOString(), "2026-10-29T09:00:00.000Z");
});

test("compte les jours sur le calendrier parisien, pas sur celui du serveur", () => {
  // 23:30 UTC le 1er juillet, c'est deja le 2 a Paris : « dans un jour » vise
  // donc le 3. Un `getDate()` lu en UTC aurait vise le 2, soit un jour de
  // moins, et le rappel serait parti la veille de ce qui est annonce.
  const next = parisDaysLater(new Date("2026-07-01T23:30:00Z"), 1, 10);
  assert.equal(next.toISOString(), "2026-07-03T08:00:00.000Z");
});

test("franchit les fins de mois", () => {
  // 30 octobre + 5 jours = 4 novembre, et l'heure d'hiver est alors en vigueur.
  const next = parisDaysLater(new Date("2026-10-30T12:00:00Z"), 5, 10);
  assert.equal(next.toISOString(), "2026-11-04T09:00:00.000Z");
});

test("rend toujours une horloge parisienne a l'heure demandee", () => {
  // La propriete generale, verifiee sur une annee entiere plutot que sur les
  // quelques dates ci-dessus : quel que soit le jour de depart, l'instant rendu
  // affiche bien 10:00:00 a Paris. C'est l'invariant que les deux passes de
  // correction du decalage doivent tenir, changements d'heure compris.
  const depart = Date.UTC(2026, 0, 1, 11, 47);
  for (let jour = 0; jour < 366; jour++) {
    const from = new Date(depart + jour * 86400000);
    const wall = parisWallClock(parisDaysLater(from, 3, 10));
    assert.deepEqual(
      { hour: wall.hour, minute: wall.minute, second: wall.second },
      { hour: 10, minute: 0, second: 0 },
      "jour " + jour,
    );
  }
});

test("mesure le decalage parisien des deux cotes du changement d'heure", () => {
  assert.equal(parisOffsetMs(new Date("2026-01-01T12:00:00Z")), 3600000);
  assert.equal(parisOffsetMs(new Date("2026-07-01T12:00:00Z")), 7200000);
});

test("lit minuit comme zero heure, pas comme vingt-quatre", () => {
  // `hour12: false` rend « 24 » a minuit sur plusieurs moteurs, et `Date.UTC`
  // le relirait alors comme le lendemain a zero heure : le decalage mesure
  // serait faux d'un jour entier, une heure par nuit. `hourCycle: "h23"` est
  // ce qui ferme ce cas, et rien d'autre dans ce module ne le dirait.
  assert.deepEqual(parisWallClock(new Date("2026-01-01T23:00:00Z")), {
    year: 2026, month: 1, day: 2, hour: 0, minute: 0, second: 0,
  });
  assert.equal(parisOffsetMs(new Date("2026-01-01T23:00:00Z")), 3600000);
});

test("ne laisse pas les millisecondes fausser le decalage", () => {
  // `formatToParts` tronque a la seconde : compare a l'instant non tronque, le
  // decalage aurait porte les millisecondes en trop, et la date resolue aurait
  // rate la seconde ronde.
  assert.equal(parisOffsetMs(new Date("2026-07-01T12:00:00.750Z")), 7200000);
});

test("rend une date invalide plutot que de lever, hors de portee", () => {
  // `Intl.DateTimeFormat.formatToParts` **leve** un `RangeError` sur une date
  // invalide. Une cadence absurde est une saisie a refuser, pas une panne :
  // l'echeance sort invalide, et c'est `setupIntervalAdhesion` qui la refuse,
  // en un seul endroit. Sans cela l'exception remontait au handler de la
  // commande, en court-circuitant sa garde.
  assert.ok(Number.isNaN(parisDaysLater(new Date("2026-07-01T09:13:00Z"), 1e9, 10).getTime()));
  assert.ok(Number.isNaN(parisDaysLater(new Date("pas une date"), 7, 10).getTime()));
});

test("ne mesure pas un decalage sur un instant qui n'existe pas", () => {
  assert.ok(Number.isNaN(parisOffsetMs(new Date("pas une date"))));
});
