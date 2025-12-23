import { safeReply } from "../../safe/safeReply.js";
import { ban } from "./ban.js";
async function ban_username(client, interaction) {
    const username = interaction.options.getString("username");
    const reason = interaction.options.getString("reason");
    if (!username || !reason) {
        await safeReply(interaction, "Missing one or more parameter ! Please try again !");
        return false;
    }
    const user = client.users.cache.find(u => u.tag === username);
    if (!user) {
        await safeReply(interaction, "User was not find ! Please try again !");
        return true;
    }
    return await ban(client, interaction, user, reason);
}
export { ban_username };
//# sourceMappingURL=ban_username.js.map