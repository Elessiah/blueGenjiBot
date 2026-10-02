/**
 * Nom d'un utilisateur prêt à être cité dans un message du bot.
 *
 * Le nom d'affichage est choisi par la personne : cité tel quel, `**`, `||`
 * ou un lien masqué `[texte](adresse)` y changent la mise en forme du message,
 * et un `@everyone` ou un `<@id>` s'y lisent comme une mention. `globalName`
 * vaut `null` pour qui n'en a pas choisi : le message disait alors « null ».
 */

import {escapeMarkdown, type User} from "discord.js";

/** Libellé neutre quand l'utilisateur n'a aucun nom lisible. */
const NO_DISPLAY_NAME = "membre sans pseudo";

/**
 * Cite le nom d'affichage d'un utilisateur, à défaut son nom d'utilisateur,
 * mise en forme et mentions neutralisées ; sans nom lisible, un libellé
 * neutre.
 * @param user Utilisateur à citer.
 * @returns Le nom, sûr à insérer dans un message Discord.
 */
function displayNameLabel(user: Pick<User, "globalName" | "username">): string {
    // Les blancs (sauts de ligne compris) se réduisent à une espace : un nom
    // ne doit pas ouvrir une ligne de plus dans un avis ligne par ligne.
    const clean = (name: string | null | undefined) => (name ?? "").replace(/\s+/g, " ").trim();
    const name = clean(user.globalName) || clean(user.username);
    if (name === "") return NO_DISPLAY_NAME;
    // Une espace sans largeur après chaque @ : ni `@everyone` ni `<@id>` ne
    // forment plus de mention, le texte affiché reste le même.
    return escapeMarkdown(name, {maskedLink: true}).replaceAll("@", "@​");
}

export {displayNameLabel, NO_DISPLAY_NAME};
