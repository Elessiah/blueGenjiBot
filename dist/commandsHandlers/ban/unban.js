import { safeReply } from "../../safe/safeReply.js";
import { checkPermissions } from "../../check/checkPermissions.js";
import { getBddInstance } from "../../bdd/Bdd.js";
async function unban(client, interaction) {
    const guild = interaction.guild;
    if (!guild) {
        await safeReply(interaction, "Internal error. The guild was not found with the interaction. Please try again !");
        return false;
    }
    if (guild.id !== process.env.SERV_RIVALS && guild.id !== process.env.SERV_GENJI && guild.memberCount < 50) {
        await safeReply(interaction, "Your server doesn't have enough members to unban users.\n" +
            "A minimum of 50 members is required.\n" +
            "If necessary, please contact 'Elessiah' or the administrators of a server that meets the requirements to take appropriate measures.\n");
        return false;
    }
    if (!await checkPermissions(interaction)) {
        await safeReply(interaction, "You don't have permission to unban users.\n" +
            "Please contact 'Elessiah' or your server administrators to take appropriate action if needed.\n");
        return false;
    }
    const bdd = await getBddInstance();
    const target = interaction.options.getString("id_ban");
    if (!target) {
        await safeReply(interaction, "Parameter 'id_ban' was not found ! Please try again !");
        return false;
    }
    const user = await bdd.get("Ban", ["*"], {}, { query: "id_user = ?", values: [target] });
    if (user.length === 0) {
        await safeReply(interaction, "Unknown ID ban !");
    }
    else {
        await bdd.rm("Ban", {}, { query: "id_user = ?", values: [target] });
        await safeReply(interaction, "User successfully unbanned.");
    }
    return true;
}
export { unban };
//# sourceMappingURL=unban.js.map