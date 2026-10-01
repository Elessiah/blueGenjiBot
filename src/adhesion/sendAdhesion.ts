import type {AttachmentBuilder, Client, GuildMember, Role, TextChannel, User} from "discord.js";
import {loadAdhesionAttachments} from "@/adhesion/adhesionAttachments.js";
import {collectRecipients} from "@/adhesion/adhesionRecipients.js";
import {deliverToAuthor, deliverToChannel, deliverToMembers} from "@/adhesion/adhesionDelivery.js";
import {DEFAULT_ADHESION_MESSAGE, PERMISSION_WARNING} from "@/adhesion/adhesionNotices.js";

/** Cibles d'un envoi ; `null` pour une cible non demandée. */
type AdhesionTargets = {
    channel: TextChannel | null,
    member: GuildMember | null,
    role: Role | null,
};

/**
 * Envoie les fichiers d'adhésion (et message associé) vers les cibles fournies.
 * Peut envoyer dans un canal, en MP à un membre, ou à tous les membres d'un rôle.
 * Sans cible, ou si l'auteur n'a pas le droit d'envoyer ailleurs qu'en MP, les
 * papiers partent en MP à l'auteur lui-même.
 * @param client Client Discord utilisé pour les envois et logs.
 * @param message Message personnalisé à joindre; un message par défaut est utilisé si `null`.
 * @param channel Canal cible, ou `null` si aucun envoi en canal n'est prévu.
 * @param member Membre cible, ou `null` si aucun envoi individuel n'est prévu.
 * @param role Rôle cible, ou `null` si aucun envoi par rôle n'est prévu.
 * @param memberPermMissing Indique si l'auteur manque de permissions pour des envois hors MP.
 * @param author Auteur du rappel, notifie en cas de succès/échec.
 * @returns `true` si tous les envois demandés aux cibles sélectionnées réussissent; `false` dès qu'au moins un envoi échoue.
 */
async function sendAdhesion(client: Client,
                            message: string | null,
                            channel: TextChannel | null,
                            member: GuildMember | null,
                            role: Role | null,
                            memberPermMissing: boolean,
                            author: User): Promise<boolean> {
    const files = await loadAdhesionAttachments(client, author);
    if (files === null) {
        return false;
    }
    // `||` et non `??` : un message vide prend lui aussi le texte par défaut.
    const content = message || DEFAULT_ADHESION_MESSAGE;
    const targets: AdhesionTargets = {channel, member, role};

    let delivered = true;
    if (!memberPermMissing) {
        delivered = await deliverToTargets(client, targets, files, content, author);
    }
    if (memberPermMissing || !hasTarget(targets)) {
        await deliverToAuthor(client, author, files, authorCopy(content, targets, memberPermMissing));
    }
    return delivered;
}

/**
 * Remet les papiers au salon, puis aux membres (rôle et membre désigné).
 * @param client Client Discord utilisé pour les envois et le journal.
 * @param targets Cibles demandées.
 * @param files Pièces jointes.
 * @param content Message joint.
 * @param author Auteur de l'envoi, avisé du résultat de chaque remise.
 * @returns `true` si chaque cible demandée a reçu les papiers.
 */
async function deliverToTargets(client: Client,
                                targets: AdhesionTargets,
                                files: AttachmentBuilder[],
                                content: string,
                                author: User): Promise<boolean> {
    let delivered = true;
    if (targets.channel !== null) {
        delivered = await deliverToChannel(client, targets.channel, files, content, author);
    }
    if (targets.role !== null || targets.member !== null) {
        const recipients = await collectRecipients(client, targets.role, targets.member);
        delivered = (await deliverToMembers(client, recipients, files, content, author)) && delivered;
    }
    return delivered;
}

/**
 * @param targets Cibles demandées.
 * @returns `true` si au moins une cible est demandée.
 */
function hasTarget(targets: AdhesionTargets): boolean {
    return targets.channel !== null || targets.role !== null || targets.member !== null;
}

/**
 * Message de la copie envoyée à l'auteur : celui des papiers, suivi d'un
 * avertissement si des cibles lui ont été refusées faute de permission.
 * @param content Message joint aux papiers.
 * @param targets Cibles demandées.
 * @param memberPermMissing L'auteur ne peut envoyer qu'en MP.
 * @returns Le texte à envoyer à l'auteur.
 */
function authorCopy(content: string, targets: AdhesionTargets, memberPermMissing: boolean): string {
    const refused = memberPermMissing && Boolean(targets.channel || targets.role || targets.member);
    return refused ? content + PERMISSION_WARNING : content;
}

export {sendAdhesion};
