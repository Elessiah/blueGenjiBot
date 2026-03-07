import {type ChatInputCommandInteraction, type Client, MessageFlags, Snowflake} from "discord.js";

import {checkPermissions} from "@/check/checkPermissions.js";
import {safeReply} from "@/safe/safeReply.js";
import {_resetServer} from "./resetServer.js";
import {status} from "@/types.js";

/**
 * Réinitialise la configuration d'un serveur partenaire distant.
 * @param client Client Discord utilisé pour les appels API.
 * @param interaction Interaction utilisateur en cours.
 * @returns `false` si permissions/paramètres invalides; sinon reflète `status.success` de `_resetServer`.
 */
async function remoteServerReset(client: Client,
                                 interaction: ChatInputCommandInteraction): Promise<boolean> {
    if (!checkPermissions(interaction)) {
        await safeReply(interaction, "You don't have permission to ban users.\n" +
            "Please contact 'Elessiah' or your server administrators to take appropriate action if needed.\n");
        return false;
    }
    await interaction.deferReply({flags: MessageFlags.Ephemeral});
    const serverId: string | null = interaction.options.getString("server");
    if (!serverId) {
        await safeReply(interaction, "Server is missing into the parameters !");
        return false;
    }
    const result: status = await _resetServer(client, serverId);
    await safeReply(interaction, result.message, true, true);
    return result.success;
}

export {remoteServerReset};
