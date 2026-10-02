import type {Client, GuildMember, Role, User} from "discord.js";
import {logAdhesionError} from "@/adhesion/adhesionLog.js";
import {fetchRoleMembers} from "@/utils/fetchRoleMembers.js";

/** Destinataires d'un envoi en MP, et si les membres du rôle ont pu être lus. */
type AdhesionRecipients = {
    /** Utilisateurs à servir, dans l'ordre d'envoi (doublons conservés). */
    recipients: User[],
    /** Un rôle était visé mais ses membres n'ont pas pu être lus. */
    roleUnreadable: boolean,
};

/**
 * Liste les utilisateurs à servir en MP : les membres du rôle, puis le membre
 * désigné.
 *
 * Les membres du rôle sont lus après récupération des membres du serveur (le
 * cache seul paraît vide après un redémarrage). Si cette lecture échoue, elle
 * est journalisée sans aucun nom et signalée par `roleUnreadable` ; le membre
 * désigné, lu indépendamment, est servi quand même.
 * @param client Client Discord utilisé pour le journal.
 * @param role Rôle dont chaque membre est servi, ou `null`.
 * @param member Membre servi individuellement, ou `null`.
 * @param knownRoleMembers Membres du rôle déjà lus par l'appelant, servis sans
 *   nouvelle lecture ; `null` pour les lire ici.
 * @returns Les destinataires et l'état de la lecture du rôle.
 */
async function collectRecipients(client: Client,
                                 role: Role | null,
                                 member: GuildMember | null,
                                 knownRoleMembers: GuildMember[] | null = null): Promise<AdhesionRecipients> {
    const recipients: User[] = [];
    let roleUnreadable = false;
    if (role !== null) {
        try {
            const members = knownRoleMembers ?? await fetchRoleMembers(role.guild, role);
            recipients.push(...members.map(m => m.user));
        } catch (err) {
            roleUnreadable = true;
            await logAdhesionError(client, "sendAdhesion membres du rôle illisibles", err);
        }
    }
    if (member) {
        recipients.push(member.user);
    }
    return {recipients, roleUnreadable};
}

export {collectRecipients};
export type {AdhesionRecipients};
