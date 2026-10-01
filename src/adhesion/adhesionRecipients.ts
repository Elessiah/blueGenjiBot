import type {Client, GuildMember, Role, User} from "discord.js";
import {logAdhesionError} from "@/adhesion/adhesionLog.js";

/**
 * Liste les utilisateurs à servir en MP : les membres du rôle, puis le membre
 * désigné.
 *
 * Une lecture qui lève est journalisée et la liste s'arrête là où elle en
 * était : si les membres du rôle sont illisibles, le membre désigné n'est pas
 * ajouté non plus.
 * @param client Client Discord utilisé pour le journal.
 * @param role Rôle dont chaque membre est servi, ou `null`.
 * @param member Membre servi individuellement, ou `null`.
 * @returns Les destinataires, dans l'ordre d'envoi (doublons conservés).
 */
async function collectRecipients(client: Client, role: Role | null, member: GuildMember | null): Promise<User[]> {
    let recipients: User[] = [];
    try {
        if (role !== null) {
            recipients = role.members.map(m => m.user);
        }
        if (member) {
            recipients.push(member.user);
        }
    } catch (err) {
        await logAdhesionError(client, "sendAdhesion targets", err);
    }
    return recipients;
}

export {collectRecipients};
