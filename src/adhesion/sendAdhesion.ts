import type {AttachmentBuilder, Client, GuildMember, Role, TextChannel, User} from "discord.js";
import {loadAdhesionAttachments} from "@/adhesion/adhesionAttachments.js";
import {collectRecipients, isEveryoneRole, MAX_ADHESION_DMS} from "@/adhesion/adhesionRecipients.js";
import {
    deliverToAuthor,
    deliverToChannel,
    deliverToMembers,
    notifyRoleUnreadable,
    refuseRecipients,
} from "@/adhesion/adhesionDelivery.js";
import {
    DEFAULT_ADHESION_MESSAGE,
    EVERYONE_REFUSED_NOTICE,
    PERMISSION_WARNING,
    recipientCapNotice,
    reminderRefusedSuffix,
} from "@/adhesion/adhesionNotices.js";
import type {adhesionIntervalObj} from "@/adhesion/types.js";

/** Cibles d'un envoi ; `null` pour une cible non demandée. */
type AdhesionTargets = {
    channel: TextChannel | null,
    member: GuildMember | null,
    role: Role | null,
    /** Membres du rôle déjà lus (rappel automatique), ou `null` pour les lire à l'envoi. */
    roleMembers: GuildMember[] | null,
    /** Numéro du rappel servi, ou `null` pour un envoi immédiat. */
    reminderId: number | null,
    /** Reçoit le texte de chaque refus, pour la réponse à la commande. */
    refusals?: string[],
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
 * @param refusals Reçoit le texte de chaque refus (plafond dépassé), que la
 *   commande répète : l'auteur aux MP fermés le saurait sinon jamais.
 * @returns `true` si tous les envois demandés aux cibles sélectionnées réussissent; `false` dès qu'au moins un envoi échoue.
 */
async function sendAdhesion(client: Client,
                            message: string | null,
                            channel: TextChannel | null,
                            member: GuildMember | null,
                            role: Role | null,
                            memberPermMissing: boolean,
                            author: User,
                            refusals: string[] = []): Promise<boolean> {
    const targets: AdhesionTargets = {channel, member, role, roleMembers: null, reminderId: null, refusals};
    return await sendToTargets(client, message, targets, memberPermMissing, author);
}

/**
 * Envoie les papiers d'un rappel automatique, avec les membres du rôle lus à
 * la résolution des cibles : l'envoi ne relit pas le rôle, une seconde lecture
 * qui échouerait consommerait l'envoi sans servir personne.
 * @param client Client Discord utilisé pour les envois et logs.
 * @param interval Rappel résolu par `fetchTargets`.
 * @returns `true` si tous les envois demandés réussissent.
 */
async function sendAdhesionReminder(client: Client, interval: adhesionIntervalObj): Promise<boolean> {
    const targets: AdhesionTargets = {
        channel: interval.channel,
        member: interval.member,
        role: interval.role,
        roleMembers: interval.roleMembers,
        reminderId: interval.id,
    };
    return await sendToTargets(client, interval.message, targets, false, interval.author);
}

/**
 * Corps commun de {@link sendAdhesion} et {@link sendAdhesionReminder}.
 * @param client Client Discord utilisé pour les envois et logs.
 * @param message Message personnalisé, ou `null` pour le message par défaut.
 * @param targets Cibles demandées.
 * @param memberPermMissing L'auteur ne peut envoyer qu'en MP.
 * @param author Auteur, avisé du résultat.
 * @returns `true` si tous les envois demandés réussissent.
 */
async function sendToTargets(client: Client,
                             message: string | null,
                             targets: AdhesionTargets,
                             memberPermMissing: boolean,
                             author: User): Promise<boolean> {
    const files = await loadAdhesionAttachments(client, author);
    if (files === null) {
        return false;
    }
    // `||` et non `??` : un message vide prend lui aussi le texte par défaut.
    const content = message || DEFAULT_ADHESION_MESSAGE;

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
        delivered = (await deliverToRecipients(client, targets, files, content, author)) && delivered;
    }
    return delivered;
}

/**
 * Remet les papiers en MP aux membres du rôle et au membre désigné. Des
 * membres du rôle illisibles sont un échec, avisé à part ; le membre désigné
 * est servi quand même. `@everyone` (rappel enregistré avant son refus) et un
 * envoi au-delà de `MAX_ADHESION_DMS` messages privés sont refusés en entier :
 * personne n'est servi, pas même le membre désigné.
 * @param client Client Discord utilisé pour les envois et le journal.
 * @param targets Cibles demandées (au moins un rôle ou un membre).
 * @param files Pièces jointes.
 * @param content Message joint.
 * @param author Auteur de l'envoi, avisé du résultat.
 * @returns `true` si chaque destinataire a reçu les papiers.
 */
async function deliverToRecipients(client: Client,
                                   targets: AdhesionTargets,
                                   files: AttachmentBuilder[],
                                   content: string,
                                   author: User): Promise<boolean> {
    const roleName = targets.role?.name ?? null;
    const suffix = (when: "always" | "overCap") =>
        targets.reminderId === null ? "" : reminderRefusedSuffix(targets.reminderId, when);
    if (targets.role !== null && isEveryoneRole(targets.role)) {
        await refuseRecipients(client, author, "sendAdhesion: rôle @everyone visé, envoi en MP refusé.", EVERYONE_REFUSED_NOTICE + suffix("always"));
        targets.refusals?.push(EVERYONE_REFUSED_NOTICE);
        return false;
    }
    const {recipients, roleCount, roleUnreadable} = await collectRecipients(client, targets.role, targets.member, targets.roleMembers);
    if (roleUnreadable) {
        await notifyRoleUnreadable(client, author, roleName);
        // Rôle illisible sans membre désigné : l'avis ci-dessus suffit.
        if (recipients.length === 0) return false;
    }
    if (recipients.length > MAX_ADHESION_DMS) {
        const notice = recipientCapNotice(roleName, roleCount, recipients.length, MAX_ADHESION_DMS);
        await refuseRecipients(client, author,
            "sendAdhesion: " + recipients.length + " destinataires au-delà du plafond de " + MAX_ADHESION_DMS + ", envoi en MP refusé.",
            notice + suffix("overCap"));
        targets.refusals?.push(notice);
        return false;
    }
    return (await deliverToMembers(client, recipients, files, content, author, roleName)) && !roleUnreadable;
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

export {sendAdhesion, sendAdhesionReminder};
