const {getBddInstance} = require("../bdd/Bdd");
const safeUser = require("../safe/safeUser");
const sendLog = require("../safe/sendLog");

async function checkBan(client, id_author, alertUser=true) {
    try {
        const bdd = await getBddInstance();
        if (!bdd) {
            await sendLog(client, "Error while getting bdd for ban");
            return false;
        }
        let isBanned = false;
        let banInfo;
        try {
            banInfo = await bdd.get("Ban",
                ['id_user', 'id_reason', 'date'],
                {},
                {id_user: id_author});
            isBanned = banInfo.length > 0;
            banInfo = banInfo[0];
        } catch (e) {
            await sendLog(client, "Failed to check ban : " + e.message);
            return false;
        }
        if (!isBanned) {
            return false;
        } else if (!alertUser) {
            return true;
        }
        const user = await client.users.fetch(banInfo.id_user);
        let reasonMsg = await client.channels.fetch(process.env.INFO_SERV);
        if (!reasonMsg) {
            await sendLog(client, "Failed to fetch admin channel for ban reason");
            return true;
        }
        reasonMsg = await reasonMsg.messages.fetch(banInfo.id_reason);
        if (!reasonMsg) {
            await sendLog(client, "Failed to fetch ban reason in admin channel");
            return true;
        }
        reasonMsg = "You have been banned since " + banInfo.date + " : \n" + reasonMsg.content;
        await safeUser(client, user, null, [], reasonMsg);
        return true;
    } catch (error) {
        await sendLog(client, "Error while checking ban : " + error.message);
        return false;
    }
}

module.exports = checkBan;