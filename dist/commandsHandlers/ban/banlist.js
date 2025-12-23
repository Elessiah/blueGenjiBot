import { getBddInstance } from '@/bdd/Bdd.js';
import { safeReply } from "@/safe/safeReply.js";
import { sendLog } from "@/safe/sendLog.js";
async function banlist(client, interaction) {
    const bdd = await getBddInstance();
    const ban_users = await bdd.get("Ban");
    if (ban_users.length === 0) {
        await safeReply(interaction, "There is no banned users");
        return;
    }
    let msg = "Banned users :\n";
    for (const user of ban_users) {
        let banned;
        let moderator;
        let reason;
        try {
            banned = (await client.users.fetch(user.id_user)).username;
        }
        catch (e) {
            banned = "Unknown User";
        }
        try {
            moderator = (await client.users.fetch(user.id_moderator)).username;
        }
        catch (e) {
            moderator = "Unknown Moderator";
        }
        try {
            const channel = await client.channels.fetch(process.env.INFO_SERV);
            if (!channel) {
                await sendLog(client, "Log channel was not found !");
                reason = "Unknown Reason";
            }
            else {
                reason = (await (channel).messages.fetch(user.id_reason)).content;
            }
        }
        catch (e) {
            reason = "UnknownReason";
            await sendLog(client, "Error while retrieving ban reason : " + e.message);
        }
        msg += ` - \`${banned}\` banned by \`${moderator}\` for the \`${reason}\` (${user.date}). ID ban : ${user.id_user}\n`;
    }
    await safeReply(interaction, msg);
}
export { banlist };
//# sourceMappingURL=banlist.js.map