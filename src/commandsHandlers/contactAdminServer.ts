import {PermissionsBitField, MessageFlags} from "discord.js";
import type { Client, ChatInputCommandInteraction, Guild, GuildMember, User, Collection, Role} from "discord.js";

import {checkPermissions} from "../check/checkPermissions.js";
import {safeReply} from "../safe/safeReply.js";
import {safeUser} from "../safe/safeUser.js";
import {sendLog} from "../safe/sendLog.js";
import {getAdminRole} from "../utils/getAdminRole.js";
import {fetchRoleMembers} from "../utils/fetchRoleMembers.js";

/**
 * Transmet un message à l'équipe d'administration du serveur concerné.
 * @param client Client Discord utilisé pour les appels API.
 * @param interaction Interaction utilisateur en cours.
 * @param guildID Identifiant du serveur cible (utilisé en appel interne sans interaction).
 * @param msg Contenu à transmettre aux administrateurs (fourni directement hors interaction).
 * @returns `true` si la demande est traitée jusqu'à la phase d'envoi; `false` si paramètres, permissions ou serveur sont invalides.
 */
async function contactAdminServer(client: Client,
                                  interaction?: ChatInputCommandInteraction,
                                  guildID?: string,
                                  msg?: string): Promise<boolean> {
    if (interaction == undefined && (guildID == undefined || msg == undefined)) {
        await sendLog(client, "Missing parameters for contactAdminServer!");
        return false;
    }
    if (interaction && !(await checkPermissions(interaction))) {
        await safeReply(interaction, "You don't have permission to contact admin users.\n" +
            "Please contact 'Elessiah' or your server administrators to take appropriate action if needed.\n");
        return false;
    }
    const serverId = await resolveServerId(interaction, guildID);
    if (!serverId) {
        if (interaction)
            await safeReply(interaction, "Failed to retrieve the parameter 'server'. Please try again !");
        return false;
    }
    const server = await fetchServer(client, serverId, interaction);
    if (!server) {
        return false;
    }
    const {targets, incomplete} = await collectAdmins(client, server);
    const content = interaction ? interaction.options.getString("message") ?? undefined : msg;
    if (!content) {
        await refuse(client, interaction, "Parameter 'message' not found. Please try again.");
        return false;
    }
    await sendToAdmins(client, targets, content);
    if (interaction)
        await safeReply(interaction, `Message successfully sent to ${targets.length} admin(s) !` +
            (incomplete ? INCOMPLETE_WARNING : ""), true, true);
    return true;
}

/**
 * Ajouté à la confirmation quand les membres d'un rôle d'administration n'ont
 * pas pu être lus : seuls ceux déjà connus du bot (ou, à défaut, le propriétaire)
 * ont reçu le message.
 */
const INCOMPLETE_WARNING = "\nWarning: Discord did not let the bot read every admin role, " +
    "so some admins may not have received it. Please try again later if needed.";

/** Destinataires, et si les membres d'un rôle d'administration sont restés illisibles. */
type AdminTargets = {
    targets: User[],
    incomplete: boolean,
};

/**
 * Lecteur des membres des rôles d'un serveur : après récupération des membres
 * du serveur (le cache seul paraît vide après un redémarrage). Au premier
 * échec, journalisé par identifiant sans aucun nom, il se rabat sur le cache
 * pour ce rôle et les suivants : une nouvelle tentative par rôle échouerait
 * de même, contre la limite de débit de Discord.
 */
type RoleReader = {
    read: (role: Role) => Promise<GuildMember[]>,
    failed: () => boolean,
};

/**
 * Crée le lecteur des rôles d'un serveur, pour un seul envoi.
 * @param client Client Discord utilisé pour le journal.
 * @param server Serveur des rôles.
 * @returns Le lecteur, et l'état de ses lectures.
 */
function roleReader(client: Client, server: Guild): RoleReader {
    let failed = false;
    return {
        read: async (role: Role) => {
            if (!failed) {
                try {
                    return await fetchRoleMembers(server, role);
                } catch (err) {
                    failed = true;
                    const reason = err instanceof Error ? err.message : String(err);
                    await sendLog(client, `Failed to read admin role members on guild '${server.id}' (role '${role.id}'), cache used : ${reason}`);
                }
            }
            return [...role.members.values()];
        },
        failed: () => failed,
    };
}

/**
 * Serveur visé : l'option `server` de la commande (la réponse est alors
 * différée), sinon l'identifiant passé en appel interne.
 * @returns L'identifiant, ou `null` s'il manque.
 */
async function resolveServerId(interaction: ChatInputCommandInteraction | undefined, guildID: string | undefined): Promise<string | null> {
    if (interaction) {
        await interaction.deferReply({flags: MessageFlags.Ephemeral});
        return interaction.options.getString("server");
    }
    return guildID || null;
}

/**
 * Lit le serveur visé ; un échec est répondu à l'interaction et journalisé.
 * @returns Le serveur, ou `null` s'il est illisible.
 */
async function fetchServer(client: Client, serverId: string, interaction?: ChatInputCommandInteraction): Promise<Guild | null> {
    try {
        return await client.guilds.fetch(serverId);
    } catch (err) {
        if (interaction)
            await safeReply(
                interaction,
                "Internal error : Failed to fetch the targeted server ! Please try again."
            );
        await sendLog(client, "Failed to fetch the targeted server : " + (err as TypeError).message);
        return null;
    }
}

/**
 * Destinataires : les membres des rôles qui portent la permission
 * Administrateur, puis ceux du rôle admin configuré, chacun une seule fois ;
 * à défaut, le propriétaire du serveur. Les membres sont lus après
 * récupération des membres du serveur ; si elle échoue, ceux du cache sont
 * servis et le résultat le signale.
 * @returns Les destinataires, dans l'ordre d'envoi, et si la lecture est incomplète.
 */
async function collectAdmins(client: Client, server: Guild): Promise<AdminTargets> {
    const targets: Map<string, User> = new Map();
    const reader = roleReader(client, server);
    const adminRoles: Collection<string, Role> = server.roles.cache.filter(r =>
        r.permissions.has(PermissionsBitField.Flags.Administrator)
    );
    for (const role of adminRoles.values()) {
        addMembers(targets, await reader.read(role));
    }
    await addConfiguredAdmins(client, server, targets, reader);

    const targetsArray: User[] = Array.from(targets.values());
    if (targetsArray.length === 0) {
        targetsArray.push(await client.users.fetch(server.ownerId));
    }
    return {targets: targetsArray, incomplete: reader.failed()};
}

/**
 * Ajoute les membres du rôle admin configuré par `/set-admin-role`, s'il y en
 * a un ; un rôle introuvable ou illisible est journalisé.
 */
async function addConfiguredAdmins(client: Client, server: Guild, targets: Map<string, User>, reader: RoleReader): Promise<void> {
    const adminRoleId = await getAdminRole(server);
    if (!adminRoleId) {
        return;
    }
    let configuredRole: Role | null;
    try {
        configuredRole = await server.roles.fetch(adminRoleId);
    } catch (err) {
        await sendLog(client, "Failed to fetch configured admin role : " + (err as TypeError).message);
        return;
    }
    if (configuredRole) {
        addMembers(targets, await reader.read(configuredRole));
    } else {
        await sendLog(client, `Configured admin role with id '${adminRoleId}' not found on guild '${server.id}'.`);
    }
}

/** Ajoute des membres aux destinataires, par identifiant. */
function addMembers(targets: Map<string, User>, members: GuildMember[]): void {
    for (const member of members) {
        targets.set(member.user.id, member.user);
    }
}

/** Refus : répondu à l'interaction, ou journalisé en appel interne. */
async function refuse(client: Client, interaction: ChatInputCommandInteraction | undefined, text: string): Promise<void> {
    if (interaction)
        await safeReply(interaction, text);
    else
        await sendLog(client, text);
}

/** Envoie le message à chaque destinataire ; les échecs sont journalisés par identifiant. */
async function sendToAdmins(client: Client, targets: User[], content: string): Promise<void> {
    let errMsg: string = "";
    for (const target of targets) {
        if (!await safeUser(client, target, undefined, [], content))
            {errMsg += "Echec de l'envoi pour le compte " + target.id + "\n";}
    }
    if (errMsg.length > 0) {
        await sendLog(client, "Erreur pour l'envoies au admins : \n" + errMsg);
    }
}

export {contactAdminServer};
