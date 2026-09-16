import test from "node:test";
import assert from "node:assert/strict";

import {
  ITERATION_UNLIMITED,
  initialIteration,
  remainingIteration,
} from "../../adhesion/iteration.js";

/**
 * Le compteur d'envois d'un rappel range deux choses dans un seul entier : un
 * nombre, et une sentinelle (`-1`) qui veut dire « sans fin ». Toute la suite
 * ci-dessous porte sur la frontiere entre les deux, parce que c'est la que le
 * **zero** tombait — du cote falsy a la pose, et du cote de la sentinelle au
 * decompte. Dans les deux cas le resultat etait le meme, et c'etait l'inverse
 * de la demande : un rappel perpetuel.
 */

test("sans nombre d'envois, le rappel n'a pas de terme", () => {
  assert.equal(initialIteration(undefined), ITERATION_UNLIMITED);
});

test("un nombre d'envois est inscrit tel quel", () => {
  assert.equal(initialIteration(1), 1);
  assert.equal(initialIteration(12), 12);
});

test("zero envoi ne pose pas un rappel perpetuel", () => {
  // Le premier piege, mot pour mot. `iteration ? iteration : -1` faisait
  // tomber le zero du cote falsy et inscrivait la sentinelle : demander aucun
  // envoi en obtenait une infinite.
  assert.equal(initialIteration(0), null);
});

test("la sentinelle n'est pas une valeur d'appel", () => {
  // `-1` est un detail de stockage. L'accepter en argument rouvrirait par la
  // porte du parametre la confusion qu'on vient de fermer : « moins un envoi »
  // n'est pas un nombre d'envois, et l'absence de limite a deja sa facon de
  // s'exprimer, qui est de ne rien passer.
  assert.equal(initialIteration(-1), null);
  assert.equal(initialIteration(-4), null);
});

test("ce qui n'est pas un entier n'est pas un nombre d'envois", () => {
  assert.equal(initialIteration(2.5), null);
  assert.equal(initialIteration(Number.NaN), null);
  assert.equal(initialIteration(Number.POSITIVE_INFINITY), null);
});

test("un rappel sans terme le reste apres chaque envoi", () => {
  assert.equal(remainingIteration(ITERATION_UNLIMITED), ITERATION_UNLIMITED);
});

test("chaque envoi consomme une unite", () => {
  assert.equal(remainingIteration(12), 11);
  assert.equal(remainingIteration(2), 1);
});

test("le dernier envoi epuise le rappel", () => {
  assert.equal(remainingIteration(1), null);
});

test("un rappel deja a zero est retire, pas rendu eternel", () => {
  // Le second piege, et le plus dangereux des deux : `iteration--` puis `== 0`
  // laissait passer le zero, qui devenait `-1`, c'est-a-dire la sentinelle. Un
  // rappel a bout d'envois se reecrivait donc en rappel sans fin, et plus rien
  // ne l'arretait. Il ne se declenchait pas tant que la pose ne pouvait pas
  // ecrire de zero — corriger le premier piege seul aurait **arme** celui-ci.
  assert.equal(remainingIteration(0), null);
});

test("un negatif egare rejoint la sentinelle au lieu de s'en eloigner", () => {
  // Decompte, `-3` devient `-4`, puis `-5` : il ne vaut jamais `-1` et ne vaut
  // jamais `0`, donc la boucle n'a aucune sortie.
  assert.equal(remainingIteration(-3), ITERATION_UNLIMITED);
});

test("un compteur qui n'est pas un entier n'est pas un compteur", () => {
  // `NaN--` reste `NaN` : ni la sentinelle, ni zero. On epuise le rappel plutot
  // que de le rendre eternel, qui est exactement le defaut retire ici.
  assert.equal(remainingIteration(Number.NaN), null);
});

test("un rappel a N envois en fait exactement N", () => {
  // La propriete qui compte pour l'utilisateur, verifiee de bout en bout : ce
  // que la pose inscrit, le decompte le ramene a zero en autant d'envois que
  // demande — ni un de plus, ni un de moins.
  for (let demande = 1; demande <= 30; demande++) {
    let restant: number | null = initialIteration(demande);
    let envois = 0;
    while (restant !== null) {
      envois++;
      restant = remainingIteration(restant);
      assert.ok(envois <= demande, "plus d'envois que demande pour " + demande);
    }
    assert.equal(envois, demande);
  }
});

test("rien de ce que la pose accepte ne tourne sans fin, sauf le sans-terme", () => {
  // L'invariant qui relie les deux fonctions, et sans lequel elles pourraient
  // diverger de nouveau : la seule valeur inscriptible que le decompte
  // n'epuise pas est la sentinelle, et elle ne s'obtient que sans argument.
  const candidats = [undefined, 0, 1, 2, 7, -1, -3, 2.5, Number.NaN];
  for (const candidat of candidats) {
    const inscrit = initialIteration(candidat);
    if (inscrit === null) continue;
    if (inscrit === ITERATION_UNLIMITED) {
      assert.equal(candidat, undefined);
      continue;
    }
    let restant: number | null = inscrit;
    let tours = 0;
    while (restant !== null && tours < 1000) {
      restant = remainingIteration(restant);
      tours++;
    }
    assert.equal(restant, null, "ne finit pas pour " + String(candidat));
  }
});
