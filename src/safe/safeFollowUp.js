import sendLog from "./sendLog";

async function safeFollowUp(interaction=null, content="Empty FollowUp", is_ephemeral=true) {
    if (interaction === null) {
        return false;
    }
    let nTry = 0;
    let success = false;
    let err_msg = "";
    while (nTry < 10 && success === false) {
        try {
            await interaction.followUp({content: content, ephemeral: is_ephemeral});
            success = true;
        } catch (err) {
            err_msg = err.message;
            nTry++;
        }
    }
    if (nTry === 10) {
        await sendLog("safeFollowUp failed : " + err_msg);
        return false;
    }
    return true;
}

module.exports = safeFollowUp;