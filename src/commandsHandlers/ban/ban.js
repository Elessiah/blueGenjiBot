const safeReply = require("../../safe/safeReply");
const checkPermissions = require("../../check/checkPermissions");
const {getBddInstance} = require("../../bdd/Bdd");
const sendLog = require("../../safe/sendLog");
const checkBan = require("../../check/checkBan");
const deleteDPMsgs = require("../../bdd/deleteDPMsgs");

async function ban(client, interaction, user, reason) {
    await interaction.deferReply({ephemeral: true});
    const guild = interaction.guild;
    if (guild.id !== process.env.SERV_RIVALS && guild.id !== process.env.SERV_GENJI && guild.memberCount < 50) {
        await safeReply(interaction, "Your server doesn't have enough members to ban users.\n" +
            "A minimum of 50 members is required.\n" +
            "If necessary, please contact 'Elessiah' or the administrators of a server that meets the requirements to take appropriate measures.\n",
            true,
            true);
        return false;
    }
    if (await checkPermissions(interaction) === false) {
        await safeReply(interaction, "You don't have permission to ban users.\n" +
            "Please contact 'Elessiah' or your server administrators to take appropriate action if needed.\n",
            true,
            true);
        return false;
    }
    const bdd = await getBddInstance();
    if (!bdd) {
        await sendLog(client, "Bdd failed in ban !");
        return false;
    }
    if (await checkBan(client, user.id, false) === true) {
        await safeReply(interaction, "This user has been already banned.", true, true);
        return true;
    }
    await sendLog(client, "**" + user.username + "** *has been banned by " + interaction.user.username + "*");
    let ids = {admin: 0};
    await sendLog(client, "**Reason:** " + reason, ids);
    try {
        await bdd.set('Ban', ['id_user', 'id_moderator', 'id_reason'], [user.id, interaction.user.id, ids.admin]);
    } catch (e) {
        await sendLog(client, 'Error while register ban : ' + e.message);
        return false;
    }
    let OGMsgs;
    try {
        OGMsgs = await bdd.get('OGMsg', ['id_msg'], {}, {id_author: user.id});
    } catch (e) {
        await sendLog(client, 'Error while getting old ban message : ' + e.message);
        return false;
    }
    for (let OGMsg of OGMsgs) {
        await deleteDPMsgs(client, OGMsg.id_msg);
    }
    await safeReply(interaction, "Member has been successfully banned !", true, true);
    return true;
}

module.exports = ban;