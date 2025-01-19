const sendLog = require("./sendLog");

async function safeFollowUp(interaction=null, content="Empty FollowUp", is_ephemeral=true, attachements = []) {
    if (interaction === null) {
        return false;
    }
    let nTry = 0;
    let err_msg = "";
    while (nTry < 10) {
        try {
            return await interaction.followUp({content: content, ephemeral: is_ephemeral, files: attachements});
        } catch (err) {
            err_msg = err.message;
            nTry++;
        }
    }
    await sendLog(interaction.client, "safeFollowUp failed : " + err_msg);
    return false;
}

module.exports = safeFollowUp;