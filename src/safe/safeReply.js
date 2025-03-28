const sendLog = require("./sendLog");

async function safeReply(interaction=null, content="Empty Reply", is_ephemeral=true, lateReply=false) {
    if (interaction == null) {
        return false;
    }
    let nTry = 0;
    let success = false;
    let err_msg = "";
    while (nTry < 3 && success === false) {
        try {
            if (!lateReply)
                await interaction.reply({content: content, ephemeral: is_ephemeral});
            else
                await interaction.editReply({content: content });
            success = true;
        } catch (err) {
            err_msg = err.message;
            nTry++;
        }
    }
    if (!success) {
        await sendLog(interaction.client, "safeReply failed : " + err_msg);
        return false;
    }
    return true;
}

module.exports = safeReply;