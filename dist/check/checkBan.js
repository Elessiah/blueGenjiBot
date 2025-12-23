import { getBddInstance } from "../bdd/Bdd.js";
import { safeUser } from "../safe/safeUser.js";
import { sendLog } from "../safe/sendLog.js";
async function checkBan(client, id_author, alertUser = true) {
    try {
        const bdd = await getBddInstance();
        let isBanned = false;
        let banInfo;
        try {
            const result = await bdd.get("Ban", ['id_user', 'id_reason', 'date'], {}, { query: "id_user = ?", values: [id_author] });
            isBanned = result.length > 0;
            banInfo = result[0];
        }
        catch (e) {
            await sendLog(client, "Failed to check ban : " + e.message);
            return false;
        }
        if (!isBanned) {
            return false;
        }
        else if (!alertUser) {
            return true;
        }
        const user = await client.users.fetch(banInfo.id_user);
        const logChannel = await client.channels.fetch(process.env.INFO_SERV);
        if (!logChannel) {
            await sendLog(client, "Failed to fetch admin channel for ban reason");
            return true;
        }
        const reasonMsg = await logChannel.messages.fetch(banInfo.id_reason);
        if (!reasonMsg) {
            await sendLog(client, "Failed to fetch ban reason in admin channel");
            return true;
        }
        const banReason = "You have been banned since " + banInfo.date + " : \n" + reasonMsg.content;
        await safeUser(client, user, undefined, [], banReason);
        return true;
    }
    catch (error) {
        await sendLog(client, "Error while checking ban : " + error.message);
        return false;
    }
}
export { checkBan };
//# sourceMappingURL=checkBan.js.map