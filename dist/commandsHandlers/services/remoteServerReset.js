import { MessageFlags } from "discord.js";
import { checkPermissions } from "../../check/checkPermissions.js";
import { safeReply } from "../../safe/safeReply.js";
import { _resetServer } from "./resetServer.js";
async function remoteServerReset(client, interaction) {
    if (!await checkPermissions(interaction)) {
        await safeReply(interaction, "You don't have permission to ban users.\n" +
            "Please contact 'Elessiah' or your server administrators to take appropriate action if needed.\n");
        return false;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const serverId = interaction.options.getString("server");
    if (!serverId) {
        await safeReply(interaction, "Server is missing into the parameters !");
        return false;
    }
    const result = await _resetServer(client, serverId);
    await safeReply(interaction, result.message, true, true);
    return result.success;
}
export { remoteServerReset };
//# sourceMappingURL=remoteServerReset.js.map