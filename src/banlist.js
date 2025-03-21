const {getBddInstance} = require('./Bdd');
const sendLog = require("./safe/sendLog");
const safeReply = require("./safe/safeReply");

async function banlist(client, interaction) {
    const bdd = await getBddInstance();
    if (!bdd) {
        await sendLog(client, "Bdd failed in ban !");
        return false;
    }
    const ban_users = await bdd.get("Ban");
    if (ban_users.length === 0) {
        await safeReply(interaction, "There is no banned users");
        return;
    }
    let msg = "Banned users :\n";
    for (const user of ban_users) {
        console.log(user);
        let banned;
        let moderator;
        let reason;
        try {
            banned = (await client.users.fetch(user.id_user)).username;
        } catch (e) {
            banned = "UnknownUser";
        }
        try {
            moderator = (await client.users.fetch(user.id_moderator)).username;
        } catch (e) {
            moderator = "UnknownUser";
        }
        try {
            reason = (await (await client.channels.fetch(process.env.INFO_SERV)).messages.fetch(user.id_reason));
        } catch (e) {
            reason = "UnknownReason";
        }
        msg += ` - \`${banned}\` banned by \`${moderator}\` for the \`${reason}\` (${user.date}). ID ban : ${user.id_user}\n`;
    }
    await safeReply(interaction, msg);
}

module.exports = banlist;