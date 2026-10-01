/**
 * Choix fermés de `/scrim niveau` et `/recrute role`.
 *
 * Ces deux options étaient du texte libre, repris tel quel dans le fil
 * d'activité public et dans les nombres par jour (`ActivityDaily`) : un
 * joueur pouvait y écrire n'importe quoi, son pseudo compris, que le repli
 * « sans auteur » aurait gardé indéfiniment. Une liste fermée ne laisse
 * passer que des catégories.
 *
 * Les valeurs stockées restent courtes et sans accent (`level`, `role`) ;
 * le libellé ne sert qu'à l'affichage.
 */

/** Un choix de commande Discord : libellé affiché, valeur enregistrée. */
export type SearchChoice = { name: string; value: string };

/** Niveaux d'un scrim — ceux que la description de la commande citait déjà. */
export const SCRIM_LEVEL_CHOICES: readonly SearchChoice[] = [
  { name: "Débutant", value: "debutant" },
  { name: "Intermédiaire", value: "intermediaire" },
  { name: "Avancé", value: "avance" },
];

/** Rôles recherchés par `/recrute` : les rôles d'équipe du site BlueGenji. */
export const RECRUIT_ROLE_CHOICES: readonly SearchChoice[] = [
  { name: "Tank", value: "tank" },
  { name: "DPS", value: "dps" },
  { name: "Heal", value: "heal" },
  { name: "Coach", value: "coach" },
  { name: "Manager", value: "manager" },
];

/**
 * Libellé d'une valeur reçue, ou `null` si elle n'est pas dans la liste.
 *
 * Discord impose déjà les choix ; la vérification sert au client resté sur
 * l'ancienne définition (texte libre) tant que ses commandes ne sont pas
 * rafraîchies.
 * @param choices Liste fermée.
 * @param value Valeur reçue de l'interaction.
 * @returns Le libellé, ou `null` pour une valeur hors liste.
 */
export function choiceLabel(choices: readonly SearchChoice[], value: string): string | null {
  return choices.find((choice) => choice.value === value)?.name ?? null;
}

/**
 * Catégorie « non précisé », celle que le repli en nombres par jour
 * (`ActivityDaily.detail`, `COALESCE(level, '')`) donne déjà à une ligne sans
 * valeur : une valeur hors liste y rejoint ce qui n'a jamais été précisé.
 */
export const UNSPECIFIED_CHOICE_VALUE = "";

/**
 * Forme de comparaison : sans espaces autour, minuscules, sans accents.
 * @param text Texte saisi.
 * @returns Le texte normalisé.
 */
function comparable(text: string): string {
  return text.trim().normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/**
 * Ramène une valeur stockée — saisie en texte libre avant les choix fermés
 * (blueGenjiBot#37) — à la valeur de la liste qu'elle désigne **exactement**,
 * casse et accents mis à part (« Avancé », « AVANCE », « avance » → `avance` ;
 * « DPS » → `dps`). Tout le reste — un pseudo, une phrase, « Gold 3 » — tombe
 * dans la catégorie « non précisé » : deviner une catégorie à partir d'un
 * texte libre écrirait un chiffre qu'aucun joueur n'a donné.
 * @param choices Liste fermée.
 * @param value Valeur stockée.
 * @returns Une valeur de la liste, ou `UNSPECIFIED_CHOICE_VALUE`.
 */
export function normalizeLegacyChoice(choices: readonly SearchChoice[], value: string | null): string {
  if (value === null) {
    return UNSPECIFIED_CHOICE_VALUE;
  }
  const wanted = comparable(value);
  return (
    choices.find((choice) => comparable(choice.value) === wanted || comparable(choice.name) === wanted)?.value ??
    UNSPECIFIED_CHOICE_VALUE
  );
}
