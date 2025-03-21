const safeReply = require("./safe/safeReply");
const checkPermissions = require("./checkPermissions");
const {getBddInstance} = require("./Bdd");
const sendLog = require("./safe/sendLog");

async function unban(client, interaction) {
    const guild = interaction.guild;
    if (guild.id !== process.env.SERV_RIVALS && guild.id !== process.env.SERV_GENJI && guild.memberCount < 50) {
        await safeReply(interaction, "Your server doesn't have enough members to unban users.\n" +
            "A minimum of 50 members is required.\n" +
            "If necessary, please contact 'Elessiah' or the administrators of a server that meets the requirements to take appropriate measures.\n");
        return false;
    }
    if (await checkPermissions(interaction) === false) {
        await safeReply(interaction, "You don't have permission to unban users.\n" +
            "Please contact 'Elessiah' or your server administrators to take appropriate action if needed.\n");
        return false;
    }
    const bdd = await getBddInstance();
    if (!bdd) {
        await sendLog(client, "Bdd failed in ban !");
        return false;
    }
    const target = interaction.options.getString("id_ban");
    console.log("Target: ", target);
    const user = bdd.get("Ban", ["*"], {}, {id_user: target});
    if (user == null || user.length === 0) {
        await safeReply(interaction, "Unknown ID ban !");
    } else {
        await bdd.rm("Ban", {}, {id_user: target});
        await safeReply(interaction, "User successfully unbanned.");
    }
    return true;
}

module.exports = unban;