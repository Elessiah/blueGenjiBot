/**
 * Neutralise les caractères qui referment un lien Markdown dans son libellé.
 *
 * Le nom d'un serveur partenaire est choisi par son propriétaire, et il finit
 * dans le libellé du lien « Sent from : [nom](invitation) » relayé à tous les
 * autres serveurs. Un crochet fermant y met fin au libellé, une parenthèse
 * ouvrante à l'adresse : un serveur nommé `](https://exemple.invalid)[` fait
 * pointer le lien de chaque message relayé où il veut, sous le nom du bot.
 *
 * Discord rend littéralement un caractère précédé d'une barre oblique
 * inverse. La barre elle-même fait donc partie des caractères traités — sans
 * quoi un nom se terminant par une barre échapperait le crochet que l'on
 * vient d'écrire. Une passe unique les couvre tous, donc chacun est échappé
 * exactement une fois.
 */

/** Délimiteurs d'un lien Markdown, plus le caractère d'échappement lui-même. */
const MARKDOWN_LINK_SPECIALS = /[\\[\]()]/g;

/**
 * @param label Libellé brut, tel qu'il vient de Discord.
 * @returns Le même libellé, dont aucun caractère ne peut plus refermer le lien.
 */
function escapeLinkLabel(label: string): string {
    return label.replace(MARKDOWN_LINK_SPECIALS, (char) => "\\" + char);
}

export {escapeLinkLabel};
