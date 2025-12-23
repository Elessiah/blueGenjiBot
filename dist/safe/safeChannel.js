import { sendLog } from "./sendLog.js";
async function safeChannel(client, channel, embed, attachements = [], content) {
    if ((embed === null && content === "")) {
        await sendLog(client, "Wrong parameter for safeChannel : \nEmbed : " + embed);
        return null;
    }
    let nTry = 0;
    let err_msg = "";
    while (nTry < 3) {
        try {
            if (embed) {
                return await channel.send({ content: content, embeds: [embed], files: attachements });
            }
            else {
                return await channel.send({ content: content, files: attachements });
            }
        }
        catch (err) {
            err_msg = err.message;
        }
        nTry++;
    }
    await sendLog(client, "SafeMessage failed  to `" + channel.guild.name + "` : " + err_msg);
    return null;
}
export { safeChannel };
//# sourceMappingURL=safeChannel.js.map