import { PermissionsBitField, MessageFlags } from "discord.js";
import { checkPermissions } from "../check/checkPermissions.js";
import { safeReply } from "../safe/safeReply.js";
import { safeUser } from "../safe/safeUser.js";
import { sendLog } from "../safe/sendLog.js";
async function contactAdminServer(client, interaction) {
    if (!await checkPermissions(interaction)) {
        await safeReply(interaction, "You don't have permission to ban users.\n" +
            "Please contact 'Elessiah' or your server administrators to take appropriate action if needed.\n");
        return false;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const serverId = interaction.options.getString("server");
    if (!serverId) {
        await safeReply(interaction, "Failed to retrieve the parameter 'server'. Please try again !");
        return false;
    }
    let server;
    try {
        server = await client.guilds.fetch(serverId);
    }
    catch (err) {
        await safeReply(interaction, "Internal error : Failed to fetch the targeted server ! Please try again.");
        await sendLog(client, "Failed to fetch the targeted server : " + err.message);
        return false;
    }
    const adminRoles = server.roles.cache.filter(r => r.permissions.has(PermissionsBitField.Flags.Administrator));
    const targets = [];
    for (const [roleId, role] of adminRoles) {
        targets.push(...(role.members.map(member => member.user)));
    }
    if (targets.length === 0) {
        targets.push(await client.users.fetch(server.ownerId));
    }
    const msg = interaction.options.getString("message");
    if (!msg) {
        await safeReply(interaction, "Parameter 'message' not found. Please try again.");
        return false;
    }
    let errMsg = "";
    for (const target of targets) {
        if (!await safeUser(client, target, undefined, [], msg)) {
            errMsg += "Echec de l'envoi pour " + target.globalName + "\n";
        }
    }
    if (errMsg.length > 0) {
        await sendLog(client, "Erreur pour l'envoies au admins : \n" + errMsg);
    }
    await safeReply(interaction, `Message successfully sent to ${targets.length} admin(s) !`, true, true);
    return true;
}
export { contactAdminServer };
//# sourceMappingURL=contactAdminServer.js.map