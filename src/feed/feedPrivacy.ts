/**
 * Anonymisation du flux d'activite.
 *
 * Le flux n'est pas un journal interne : l'app web soeur le republie sur
 * `/bot`, une page de **vitrine** que l'on lit sans compte. Or les evenements
 * y nommaient le joueur par son identifiant Discord — « Code DM envoye a
 * 100000000000000001 » — et `recordEvent` rangeait le meme identifiant dans la
 * colonne `target`, donc **en base et sans duree**, d'ou il repartait a chaque
 * rattrapage d'historique (`getBacklog`).
 *
 * Un identifiant Discord n'est pas un secret, mais c'est une **coordonnee** :
 * il suffit a ecrire a la personne, avec l'horodatage de sa connexion a
 * l'appui. Le flux dit *ce qui se passe*, jamais *a qui* : un compteur de
 * salons, un role recherche, un jeu — et « un joueur » a la place de la
 * personne.
 *
 * La regle est posee dans `recordEvent`, **unique ecrivain** de la table : un
 * appelant ne peut pas l'oublier, et une commande ajoutee demain en herite sans
 * une ligne. Les appelants ecrivent tout de meme un texte deja anonyme — ce
 * module est le filet, pas l'intention.
 */

/** Ce qui remplace la personne dans le texte d'un evenement. */
export const FEED_ANONYMOUS_ACTOR = "un joueur";

/**
 * Un identifiant Discord est un entier de 17 a 20 chiffres. Les gardes
 * `(?<!\d)` / `(?!\d)` evitent de rogner un nombre plus long, et la borne basse
 * met hors d'atteinte les nombres que le flux porte legitimement : un
 * horodatage, un compteur de salons, un niveau.
 */
const SNOWFLAKE_PATTERN = /(?<!\d)\d{17,20}(?!\d)/g;

/** Une mention Discord (`<@id>` ou `<@!id>`) : l'identifiant y est deja emballe. */
const MENTION_PATTERN = /<@!?\d{17,20}>/g;

/** Vrai si la chaine entiere est un identifiant Discord, aux espaces pres. */
export function isSnowflake(value: string): boolean {
  return /^\d{17,20}$/.test(value.trim());
}

/**
 * Retire d'un texte d'evenement toute designation d'une personne.
 *
 * Les mentions sont traitees **avant** les identifiants nus : sans cela,
 * `<@100000000000000001>` laisserait les chevrons orphelins autour du
 * remplacement.
 *
 * @param text Texte de l'evenement, tel que l'appelant l'a redige.
 * @returns Le meme texte, la personne remplacee par {@link FEED_ANONYMOUS_ACTOR}.
 */
export function scrubFeedText(text: string): string {
  return text
    .replace(MENTION_PATTERN, FEED_ANONYMOUS_ACTOR)
    .replace(SNOWFLAKE_PATTERN, FEED_ANONYMOUS_ACTOR);
}

/**
 * Nettoie une colonne d'appoint (`source`, `target`).
 *
 * Une valeur qui n'**est** qu'un identifiant ne porte rien d'autre : elle
 * devient `null` plutot qu'un « un joueur » qui ne dit rien. Un nom de serveur
 * ou toute autre chaine est conserve, l'identifiant qu'il contiendrait en
 * moins.
 *
 * @param value Valeur a ranger en base, ou `null`/`undefined`.
 * @returns La valeur nettoyee, ou `null`.
 */
export function scrubFeedField(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (isSnowflake(value)) {
    return null;
  }
  const scrubbed = scrubFeedText(value);
  return scrubbed.length > 0 ? scrubbed : null;
}
