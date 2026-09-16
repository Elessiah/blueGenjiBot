/**
 * Compte des envois restants d'un rappel d'adhésion.
 *
 * La colonne `AdhesionInterval.iteration` mélange deux choses dans un même
 * entier : un **nombre d'envois** et une **sentinelle** (`-1`) qui veut dire
 * « ce rappel n'a pas de fin ». Tant que les deux vivent dans la même case, la
 * frontière entre elles doit être écrite une seule fois — elle l'était deux
 * fois, et de deux façons qui se contredisaient.
 *
 * À la pose, `iteration ? iteration : -1` faisait tomber le **zéro** du côté
 * falsy : demander « zéro envoi » posait un rappel **perpétuel**, exactement
 * l'inverse. Au décompte, `iteration--` suivi de `== 0` laissait passer ce même
 * zéro, qui devenait `-1` — c'est-à-dire la sentinelle : un rappel arrivé à
 * bout d'envois se transformait en rappel sans fin. Les deux pièges se
 * tiennent, et c'est ce qui les rend intéressants : corriger le premier seul
 * **arme** le second, puisqu'il rend le zéro inscriptible en base.
 *
 * D'où ces deux fonctions pures, appelées l'une à l'écriture et l'autre à
 * l'envoi, et le même contrat aux deux bouts : `null` signifie « ce rappel n'a
 * rien à envoyer, il ne doit pas exister ».
 */

/** Ce qu'on écrit en base pour un rappel qui ne s'arrête jamais. */
const ITERATION_UNLIMITED = -1;

/**
 * Nombre d'envois à inscrire en base au moment où l'on pose un rappel.
 *
 * L'**absence** de limite est la seule façon d'obtenir un rappel perpétuel :
 * un appelant qui fournit un nombre fournit un nombre d'envois, et `-1` n'en
 * est pas un. La sentinelle reste un détail de stockage, elle n'est pas une
 * valeur d'appel — sans quoi on rouvrirait par la porte du paramètre la
 * confusion qu'on vient de fermer.
 *
 * @param iteration Nombre d'envois demandé, ou `undefined` pour aucun terme.
 * @returns La valeur à stocker, ou `null` si le rappel n'aurait aucun envoi à faire.
 */
function initialIteration(iteration: number | undefined): number | null {
    if (iteration === undefined) return ITERATION_UNLIMITED;
    if (!Number.isInteger(iteration) || iteration < 1) return null;
    return iteration;
}

/**
 * Nombre d'envois restants après celui qui vient de partir.
 *
 * Toute valeur négative est ramenée à la sentinelle plutôt que décomptée : un
 * `-3` égaré se serait éloigné d'elle à chaque tour sans jamais l'atteindre,
 * donc sans jamais finir. Et une valeur qui n'est pas un entier n'est pas un
 * compteur : on épuise le rappel au lieu de le rendre éternel, qui est
 * précisément le défaut qu'on retire.
 *
 * @param iteration Valeur lue en base avant l'envoi.
 * @returns La valeur à réécrire, ou `null` si le rappel est épuisé et doit être supprimé.
 */
function remainingIteration(iteration: number): number | null {
    if (!Number.isInteger(iteration)) return null;
    if (iteration < 0) return ITERATION_UNLIMITED;
    return iteration > 1 ? iteration - 1 : null;
}

export {ITERATION_UNLIMITED, initialIteration, remainingIteration};
