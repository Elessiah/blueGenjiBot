import type {User} from "discord.js";

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
    return "Adhésion envoyée avec succès à " + recipient.globalName + " !";
}

/**
 * Ligne de l'avis d'échec pour un membre qui n'a pas reçu les papiers.
 * @param recipient Membre non servi.
 * @returns La ligne, saut de ligne final compris.
 */
function memberFailedLine(recipient: User): string {
    return "Echec de l'envoi pour " + recipient.globalName + "\n";
}

export {
    DEFAULT_ADHESION_MESSAGE,
    PERMISSION_WARNING,
    MISSING_FILES_NOTICE,
    CHANNEL_FAILED_NOTICE,
    MEMBERS_DELIVERED_NOTICE,
    channelDeliveredNotice,
    memberDeliveredNotice,
    memberFailedLine,
};
