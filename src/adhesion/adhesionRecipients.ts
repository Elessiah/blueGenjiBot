import type {Client, Guild, GuildMember, Role, User} from "discord.js";
import {logAdhesionError} from "./adhesionLog.js";
import {fetchRoleMembers} from "../utils/fetchRoleMembers.js";

/**
 * Plafond de messages privés par envoi d'adhésion. Au-delà, rien ne part :
 * contrairement aux alertes arbitres (`MAX_REFEREE_DMS`, qui servent les
 * premiers), servir une partie du rôle choisirait arbitrairement qui reçoit.
 */
const MAX_ADHESION_DMS = 50;

/**
 * @param role Rôle visé.
 * @returns `true` pour `@everyone`, dont l'identifiant est celui du serveur.
 */
function isEveryoneRole(role: Role): boolean {
    return role.id === role.guild.id;
}

/** Destinataires d'un envoi en MP, et si les membres du rôle ont pu être lus. */
type AdhesionRecipients = {
    /** Utilisateurs à servir, dans l'ordre d'envoi, chacun une seule fois. */
    recipients: User[],
    /** Membres du rôle parmi `recipients` (bots écartés). */
    roleCount: number,
    /** Un rôle était visé mais ses membres n'ont pas pu être lus. */
    roleUnreadable: boolean,
};

/**
 * Membres d'un rôle visé par une adhésion.
 *
 * `@everyone` est refusé à l'envoi (`isEveryoneRole`) ; un rappel enregistré
 * avant ce refus le vise encore : il reste lu dans le seul cache, pour ne pas
 * récupérer tout le serveur avant un envoi qui sera refusé.
 * @param guild Serveur du rôle.
 * @param role Rôle visé.
 * @returns Les membres du rôle.
 * @throws L'erreur de la récupération des membres du serveur.
 */
async function readAdhesionRoleMembers(guild: Guild, role: Role): Promise<GuildMember[]> {
    if (role.id === guild.id) return [...role.members.values()];
    return await fetchRoleMembers(guild, role);
}

/**
 * Liste les utilisateurs à servir en MP : les membres du rôle, puis le membre
 * désigné.
 *
 * Les membres du rôle sont lus après récupération des membres du serveur (le
 * cache seul paraît vide après un redémarrage) ; les bots en sont écartés. Le
 * membre désigné, s'il est déjà du rôle, n'est pas servi deux fois. Si cette lecture échoue, elle
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
    let roleCount = 0;
    if (role !== null) {
        try {
            const members = knownRoleMembers ?? await readAdhesionRoleMembers(role.guild, role);
            // Un bot ne reçoit pas de MP : il ne compterait que pour un échec.
            recipients.push(...members.filter(m => !m.user.bot).map(m => m.user));
            roleCount = recipients.length;
        } catch (err) {
            roleUnreadable = true;
            await logAdhesionError(client, "sendAdhesion membres du rôle illisibles", err);
        }
    }
    if (member && !recipients.some(u => u.id === member.user.id)) {
        recipients.push(member.user);
    }
    return {recipients, roleCount, roleUnreadable};
}

export {MAX_ADHESION_DMS, collectRecipients, isEveryoneRole, readAdhesionRoleMembers};
export type {AdhesionRecipients};
