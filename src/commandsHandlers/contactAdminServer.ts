import {PermissionsBitField, MessageFlags} from "discord.js";
import type { Client, ChatInputCommandInteraction, Guild, User, Collection, Role} from "discord.js";

import {checkPermissions} from "../check/checkPermissions.js";
import {safeReply} from "../safe/safeReply.js";
import {safeUser} from "../safe/safeUser.js";
import {sendLog} from "../safe/sendLog.js";

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
    if (interaction && !checkPermissions(interaction, true)) {
        await safeReply(interaction, "You don't have permission to contact admin users.\n" +
            "Please contact 'Elessiah' or your server administrators to take appropriate action if needed.\n");
        return false;
    }
    let serverId: string | null = null;
    if (interaction) {
        await interaction.deferReply({flags: MessageFlags.Ephemeral});
        serverId = interaction.options.getString("server");
    } else if (guildID) {
        serverId = guildID;
    }
    if (!serverId) {
        if (interaction)
            await safeReply(interaction, "Failed to retrieve the parameter 'server'. Please try again !");
        return false;
    }
    let server: Guild;
    try {
        server = await client.guilds.fetch(serverId);
    } catch (err) {
        if (interaction)
            await safeReply(
                interaction,
                "Internal error : Failed to fetch the targeted server ! Please try again."
            );
        await sendLog(client, "Failed to fetch the targeted server : " + (err as TypeError).message);
        return false;
    }
    const adminRoles: Collection<string, Role> = server.roles.cache.filter(r =>
        r.permissions.has(PermissionsBitField.Flags.Administrator)
    );
    const targets: User[] = [];
    for (const [roleId, role] of adminRoles) {
        targets.push(...(role.members.map(member => member.user)));
    }
    if (targets.length === 0) {
        targets.push(await client.users.fetch(server.ownerId));
    }
    if (interaction) {
        msg = interaction.options.getString("message") ?? undefined;
    }
    if (!msg) {
        if (interaction)
            await safeReply(interaction, "Parameter 'message' not found. Please try again.");
        else
            await sendLog(client, "Parameter 'message' not found. Please try again.");
        return false;
    }
    let errMsg: string = "";
    for (const target of targets) {
        if (!await safeUser(client, target, undefined, [], msg))
            {errMsg += "Echec de l'envoi pour " + target.globalName + "\n";}
    }
    if (errMsg.length > 0) {
        await sendLog(client, "Erreur pour l'envoies au admins : \n" + errMsg);
    }
    if (interaction)
        await safeReply(interaction, `Message successfully sent to ${targets.length} admin(s) !`, true, true);
    return true;
}

export {contactAdminServer};
