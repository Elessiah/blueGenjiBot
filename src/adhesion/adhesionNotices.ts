import {escapeMarkdown, type User} from "discord.js";
import {displayNameLabel} from "@/utils/displayNameLabel.js";

/**
 * Textes de l'envoi des adhésions : le message joint aux papiers et les avis
 * adressés en MP à l'auteur de l'envoi.
 *
 * Réunis ici pour que les modules d'envoi ne portent que la logique ; les
 * libellés sont repris tels que les utilisateurs les reçoivent déjà.
 */

/** Message joint aux papiers quand l'auteur n'en a pas fourni. */
const DEFAULT_ADHESION_MESSAGE = "Voici les papiers pour l'adhésion à l'association BlueGenji :";

/** Ajouté au message renvoyé à l'auteur quand ses cibles lui étaient interdites. */
const PERMISSION_WARNING = "\nVous n'avez pas les permissions pour envoyer un message ailleurs que dans vos MP !";

/** Avis à l'auteur quand les fichiers d'adhésion ne sont pas configurés. */
const MISSING_FILES_NOTICE = "Echec de l'envoie des adhésions, impossible de récupérer les fichiers. Admin en cours de contact...";

/** Avis à l'auteur quand le salon n'a pas reçu les papiers. */
const CHANNEL_FAILED_NOTICE = "Echec de l'envoie des adhésions, vérifiez les permissions, avant de réessayer !";

/** Avis à l'auteur quand plusieurs membres ont tous reçu les papiers. */
const MEMBERS_DELIVERED_NOTICE = "Adhésions envoyés avec succès à plusieurs membres !";

/**
 * Avis à l'auteur : le salon a reçu les papiers.
 * @param channelName Nom du salon.
 * @returns Le texte de l'avis.
 */
function channelDeliveredNotice(channelName: string): string {
    return "Adhésion envoyé avec succès dans le channel " + channelName + " !";
}

/**
 * Avis à l'auteur : un membre unique a reçu les papiers.
 * @param recipient Membre servi.
 * @returns Le texte de l'avis.
 */
function memberDeliveredNotice(recipient: User): string {
    return "Adhésion envoyée avec succès à " + displayNameLabel(recipient) + " !";
}

/**
 * Avis à l'auteur quand les membres du rôle visé n'ont pas pu être lus
 * (Discord n'a pas répondu à temps, ou a limité le débit) : aucun d'eux n'a
 * reçu les papiers. Un membre désigné en même temps a son propre avis. Le
 * texte invite à réessayer plus tard plutôt qu'à corriger la cible, qui n'est
 * pas en cause, et à ne viser que le rôle : un salon ou un membre servis en
 * même temps recevraient les papiers deux fois.
 * @param roleName Nom du rôle visé, ou `null` s'il est inconnu.
 * @returns Le texte de l'avis.
 */
function roleUnreadableNotice(roleName: string | null): string {
    const role = roleName === null ? "du rôle visé" : "du rôle « " + escapeMarkdown(roleName) + " »";
    return "Echec de l'envoi des adhésions en message privé aux membres " + role +
        " : Discord n'a pas permis de les lire, aucun ne les a reçus. Réessayez plus tard en ne visant que ce rôle !";
}

/**
 * Avis à l'auteur d'un rappel reporté faute de pouvoir lire son rôle ou les
 * membres de celui-ci : sans lui, un rappel reporté chaque jour paraîtrait
 * actif sans que rien ne parte. Il dit que tout le rappel attend, et comment
 * l'arrêter.
 * @param intervalId Numéro du rappel, tel que l'affiche `/show-rappel-adhesion`.
 * @param roleName Nom du rôle visé, ou `null` si le rôle lui-même n'a pas pu
 *   être lu.
 * @returns Le texte de l'avis.
 */
function reminderPostponedNotice(intervalId: number, roleName: string | null): string {
    const what = roleName === null ? "le rôle visé" : "les membres du rôle « " + escapeMarkdown(roleName) + " »";
    return "Rappel d'adhésion n°" + intervalId + " reporté : Discord n'a pas permis de lire " +
        what + ". Rien n'est parti, nouvel essai à la prochaine vérification " +
        "(/delete-rappel-adhesion pour l'arrêter).";
}

/**
 * Avis à l'auteur quand personne n'est à servir en MP : le rôle visé, lu
 * après récupération des membres du serveur, n'a aucun membre, et aucun membre
 * n'est désigné. Il ne parle que des MP : un salon visé en même temps a son
 * propre avis. Le rôle est nommé pour que l'auteur de plusieurs rappels sache
 * lequel vérifier.
 * @param roleName Nom du rôle visé, ou `null` s'il est inconnu.
 * @returns Le texte de l'avis.
 */
function noRecipientNotice(roleName: string | null): string {
    const role = roleName === null ? "du rôle visé" : "du rôle « " + escapeMarkdown(roleName) + " »";
    return "Echec de l'envoi des adhésions en message privé : aucun membre " + role + " n'a été trouvé, personne ne les a reçus. Vérifiez la cible !";
}

/**
 * Refus d'un envoi qui vise `@everyone` : il enverrait les papiers en MP à
 * tout le serveur. Le texte propose le geste qui convient (un salon).
 */
const EVERYONE_REFUSED_NOTICE = "Envoi refusé : le rôle @\u200beveryone ne peut pas être visé, " +
    "il enverrait les adhésions en message privé à tout le serveur. " +
    "Visez un rôle plus restreint, ou envoyez-les dans un salon !";

/**
 * Refus d'un envoi en MP au-delà du plafond : personne ne reçoit les papiers
 * (servir une partie choisirait arbitrairement qui). Le texte donne le nombre
 * de membres du rôle et la limite, pour que l'auteur sache quoi corriger ; un
 * membre désigné en même temps est compté dans le total annoncé.
 * @param roleName Nom du rôle visé, ou `null` s'il est inconnu.
 * @param roleCount Membres du rôle à servir (bots écartés).
 * @param total Messages privés que l'envoi aurait demandés.
 * @param cap Plafond de messages privés par envoi.
 * @returns Le texte de l'avis.
 */
function recipientCapNotice(roleName: string | null, roleCount: number, total: number, cap: number): string {
    const role = roleName === null ? "Le rôle visé" : "Le rôle « " + escapeMarkdown(roleName) + " »";
    const withMember = total > roleCount ? " (" + total + " messages privés avec le membre désigné)" : "";
    return "Envoi en message privé refusé : " + role + " compte " + roleCount + " membres" + withMember +
        ", au-delà de la limite de " + cap + " messages privés par envoi. Personne n'a reçu les adhésions. " +
        "Visez un rôle plus restreint, ou envoyez-les dans un salon !";
}

/**
 * Suite d'un refus prononcé à l'échéance d'un rappel enregistré : il ne peut
 * pas être modifié, et sera refusé de même à chaque échéance.
 * @param intervalId Numéro du rappel, tel que l'affiche `/show-rappel-adhesion`.
 * @returns Le texte à ajouter à l'avis de refus.
 */
function reminderRefusedSuffix(intervalId: number): string {
    return " (Rappel n°" + intervalId + " : il sera refusé de même à chaque échéance, " +
        "/delete-rappel-adhesion pour l'arrêter.)";
}

/** Longueur maximale d'un message Discord. */
const DISCORD_MESSAGE_MAX = 2000;

/**
 * Avis d'échec : une ligne par membre non servi, tronqué sous la limite d'un
 * message Discord (un avis trop long serait refusé, et l'auteur n'apprendrait
 * rien). Les membres qui ne tiennent pas sont comptés en dernière ligne.
 * @param failedLines Lignes de `memberFailedLine`, dans l'ordre d'envoi.
 * @returns Le texte de l'avis.
 */
function membersFailedNotice(failedLines: string[]): string {
    const remainder = (n: number) => "Et " + n + " autre(s) échec(s).\n";
    let text = "";
    for (let i = 0; i < failedLines.length; i++) {
        const rest = failedLines.length - i - 1;
        // Place gardée pour la ligne de reste, qui pourrait suivre celle-ci.
        const tail = rest > 0 ? remainder(rest).length : 0;
        if (text.length + failedLines[i].length + tail > DISCORD_MESSAGE_MAX) {
            return text + remainder(failedLines.length - i);
        }
        text += failedLines[i];
    }
    return text;
}

/**
 * Ligne de l'avis d'échec pour un membre qui n'a pas reçu les papiers. Le nom
 * est cité par `displayNameLabel` (mise en forme et mentions neutralisées,
 * libellé neutre sans nom).
 * @param recipient Membre non servi.
 * @returns La ligne, saut de ligne final compris.
 */
function memberFailedLine(recipient: User): string {
    return "Echec de l'envoi pour " + displayNameLabel(recipient) + "\n";
}

export {
    DEFAULT_ADHESION_MESSAGE,
    PERMISSION_WARNING,
    MISSING_FILES_NOTICE,
    CHANNEL_FAILED_NOTICE,
    MEMBERS_DELIVERED_NOTICE,
    channelDeliveredNotice,
    memberDeliveredNotice,
    EVERYONE_REFUSED_NOTICE,
    noRecipientNotice,
    recipientCapNotice,
    reminderRefusedSuffix,
    roleUnreadableNotice,
    reminderPostponedNotice,
    memberFailedLine,
    membersFailedNotice,
};
