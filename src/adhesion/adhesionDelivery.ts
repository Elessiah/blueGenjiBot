import type {AttachmentBuilder, Client, TextChannel, User} from "discord.js";
import {safeChannel} from "@/safe/safeChannel.js";
import {safeUser} from "@/safe/safeUser.js";
import {logAdhesion, logAdhesionError} from "@/adhesion/adhesionLog.js";
import {
    CHANNEL_FAILED_NOTICE,
    MEMBERS_DELIVERED_NOTICE,
    NO_RECIPIENT_NOTICE,
    channelDeliveredNotice,
    memberDeliveredNotice,
    memberFailedLine,
} from "@/adhesion/adhesionNotices.js";

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
 * Sans destinataire (aucun membre du rôle trouvé, ou membres illisibles), rien
 * n'est envoyé en MP : l'auteur en est avisé, le journal le note, et l'envoi
 * échoue.
 * @param client Client Discord utilisé pour les envois et le journal.
 * @param recipients Destinataires, dans l'ordre d'envoi.
 * @param files Pièces jointes.
 * @param content Message joint.
 * @param author Auteur de l'envoi.
 * @returns `true` si tous les destinataires ont reçu les papiers.
 */
async function deliverToMembers(client: Client,
                                recipients: User[],
                                files: AttachmentBuilder[],
                                content: string,
                                author: User): Promise<boolean> {
    if (recipients.length === 0) {
        // Ni pseudo ni identifiant : la ligne dit seulement que rien n'est parti.
        await logAdhesion(client, "sendAdhesion: aucun destinataire trouvé pour le rôle visé, envoi annulé.");
        await sendPrivately(client, author, [], NO_RECIPIENT_NOTICE, "sendAdhesion safeUser (no recipient)");
        return false;
    }
    let failures = "";
    for (const recipient of recipients) {
        if (!(await sendPrivately(client, recipient, files, content, "sendAdhesion safeUser target"))) {
            failures += memberFailedLine(recipient);
        }
    }
    if (failures.length > 0) {
        await sendPrivately(client, author, [], failures, "sendAdhesion safeUser author errMsg");
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

export {deliverToChannel, deliverToMembers, deliverToAuthor};
