import { sendLog } from "./sendLog.js";
async function safeFollowUp(interaction, content = "Empty FollowUp", is_ephemeral = true, attachements) {
    let nTry = 0;
    let err_msg = "";
    while (nTry < 3) {
        try {
            return await interaction.followUp({ content: content, ephemeral: is_ephemeral, files: attachements });
        }
        catch (err) {
            err_msg = err.message;
            nTry++;
        }
    }
    await sendLog(interaction.client, "safeFollowUp failed : " + err_msg);
    return null;
}
export { safeFollowUp };
//# sourceMappingURL=safeFollowUp.js.map