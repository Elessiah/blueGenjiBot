import { ban } from "./ban.js";
import { safeReply } from "@/safe/safeReply.js";
async function ban_id(client, interaction) {
    const user = interaction.options.getMember("user");
    const reason = interaction.options.getString("reason");
    if (!user || !reason || !("user" in user)) {
        await safeReply(interaction, "Missing one or more parameter. Please try again.");
        return false;
    }
    return await ban(client, interaction, user.user, reason);
}
export { ban_id };
//# sourceMappingURL=ban_id.js.map