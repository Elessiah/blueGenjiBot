import type {AttachmentBuilder, Client, TextChannel, User} from "discord.js";
import {safeChannel} from "../safe/safeChannel.js";
import {safeUser} from "../safe/safeUser.js";
import {logAdhesion, logAdhesionError} from "./adhesionLog.js";
import {
    CHANNEL_FAILED_NOTICE,
    MEMBERS_DELIVERED_NOTICE,
    channelDeliveredNotice,
    memberDeliveredNotice,
    memberFailedLine,
    membersFailedNotice,
    noRecipientNotice,
    roleUnreadableNotice,
} from "./adhesionNotices.js";

/**
 * Remise des papiers d'adhésion à chaque type de cible.
 *
 * Aucune fonction ne lève : un envoi qui lève est journalisé sous le nom de
 * son étape et compte comme un échec. L'auteur reçoit en MP un avis par type
 * de cible ; l'échec de cet avis est journalisé sans changer le résultat.
 */

/**
 * Envoie un MP, sans jamais lever.
 * @param client Client Discord utilisé pour l'envoi et le journal.
 * @param user Destinataire.
 * @param files Pièces jointes.
 * @param content Texte du message.
 * @param step Étape journalisée si l'envoi lève.
 * @returns `true` si le message est parti, `false` sinon.
 */
async function sendPrivately(client: Client,
                             user: User,
                             files: AttachmentBuilder[],
                             content: string,
                             step: string): Promise<boolean> {
    try {
        return (await safeUser(client, user, undefined, files, content)) !== null;
    } catch (err) {
        await logAdhesionError(client, step, err);
        return false;
    }
}

/**
 * Publie les papiers dans un salon, puis en avise l'auteur.
 * @param client Client Discord utilisé pour les envois et le journal.
 * @param channel Salon cible.
 * @param files Pièces jointes.
 * @param content Message joint.
 * @param author Auteur de l'envoi.
 * @returns `true` si le salon a reçu les papiers.
 */
async function deliverToChannel(client: Client,
                                channel: TextChannel,
                                files: AttachmentBuilder[],
                                content: string,
                                author: User): Promise<boolean> {
    let delivered: boolean;
    try {
        delivered = (await safeChannel(client, channel, undefined, files, content)) !== null;
    } catch (err) {
        await logAdhesionError(client, "sendAdhesion safeChannel", err);
        delivered = false;
    }
    if (delivered) {
        await sendPrivately(client, author, [], channelDeliveredNotice(channel.name), "sendAdhesion safeUser (channel ok)");
    } else {
        await sendPrivately(client, author, [], CHANNEL_FAILED_NOTICE, "sendAdhesion safeUser (channel fail)");
    }
    return delivered;
}

/**
 * Envoie les papiers en MP à chaque destinataire, puis avise l'auteur : la
 * liste des échecs s'il y en a, une confirmation sinon.
 *
 * Sans destinataire (aucun membre dans le rôle visé, aucun membre désigné), rien
 * n'est envoyé en MP : l'auteur en est avisé, le journal le note, et l'envoi
 * échoue.
 * @param client Client Discord utilisé pour les envois et le journal.
 * @param recipients Destinataires, dans l'ordre d'envoi.
 * @param files Pièces jointes.
 * @param content Message joint.
 * @param author Auteur de l'envoi.
 * @param roleName Nom du rôle visé, repris dans l'avis sans destinataire.
 * @returns `true` si tous les destinataires ont reçu les papiers.
 */
async function deliverToMembers(client: Client,
                                recipients: User[],
                                files: AttachmentBuilder[],
                                content: string,
                                author: User,
                                roleName: string | null): Promise<boolean> {
    if (recipients.length === 0) {
        // Ni pseudo ni identifiant : la ligne dit seulement que rien n'est parti.
        await logAdhesion(client, "sendAdhesion: aucun destinataire trouvé pour le rôle visé, envoi annulé.");
        await sendPrivately(client, author, [], noRecipientNotice(roleName), "sendAdhesion safeUser (no recipient)");
        return false;
    }
    const failures: string[] = [];
    for (const recipient of recipients) {
        if (!(await sendPrivately(client, recipient, files, content, "sendAdhesion safeUser target"))) {
            failures.push(memberFailedLine(recipient));
        }
    }
    if (failures.length > 0) {
        await sendPrivately(client, author, [], membersFailedNotice(failures), "sendAdhesion safeUser author errMsg");
        return false;
    }
    await confirmMembersDelivered(client, recipients, author);
    return true;
}

/**
 * Confirme à l'auteur que tous les destinataires ont été servis.
 * @param client Client Discord utilisé pour l'envoi et le journal.
 * @param recipients Destinataires servis (au moins un).
 * @param author Auteur de l'envoi.
 * @returns Une promesse résolue une fois l'avis tenté.
 */
async function confirmMembersDelivered(client: Client, recipients: User[], author: User): Promise<void> {
    try {
        const notice = recipients.length > 1 ? MEMBERS_DELIVERED_NOTICE : memberDeliveredNotice(recipients[0]);
        await safeUser(client, author, undefined, [], notice);
    } catch (err) {
        await logAdhesionError(client, "sendAdhesion safeUser author success", err);
    }
}

/**
 * Envoie les papiers en MP à l'auteur lui-même.
 * @param client Client Discord utilisé pour l'envoi et le journal.
 * @param author Auteur de l'envoi.
 * @param files Pièces jointes.
 * @param content Message joint.
 * @returns Une promesse résolue une fois l'envoi tenté.
 */
async function deliverToAuthor(client: Client,
                               author: User,
                               files: AttachmentBuilder[],
                               content: string): Promise<void> {
    await sendPrivately(client, author, files, content, "sendAdhesion safeUser (memberPermMissing)");
}

/**
 * Refuse un envoi en MP : journalise la raison (sans aucun nom) et avise
 * l'auteur. Rien n'est envoyé aux membres.
 * @param client Client Discord utilisé pour l'envoi et le journal.
 * @param author Auteur de l'envoi.
 * @param logLine Ligne du journal, sans nom ni identifiant de membre.
 * @param notice Avis adressé à l'auteur.
 * @returns Une promesse résolue une fois l'avis tenté.
 */
async function refuseRecipients(client: Client, author: User, logLine: string, notice: string): Promise<void> {
    await logAdhesion(client, logLine);
    await sendPrivately(client, author, [], notice, "sendAdhesion safeUser (refused)");
}

/**
 * Avise l'auteur que les membres du rôle visé n'ont pas pu être lus.
 * @param client Client Discord utilisé pour l'envoi et le journal.
 * @param author Auteur de l'envoi.
 * @param roleName Nom du rôle visé, repris dans l'avis.
 * @returns Une promesse résolue une fois l'avis tenté.
 */
async function notifyRoleUnreadable(client: Client, author: User, roleName: string | null): Promise<void> {
    await sendPrivately(client, author, [], roleUnreadableNotice(roleName), "sendAdhesion safeUser (role unreadable)");
}

export {deliverToChannel, deliverToMembers, deliverToAuthor, notifyRoleUnreadable, refuseRecipients};
