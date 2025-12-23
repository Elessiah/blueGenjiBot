import { sendLog } from "@/safe/sendLog.js";
async function safeMsgReply(client, msg, content) {
    let nTry = 0;
    let err_msg = "";
    while (nTry < 3) {
        try {
            return await msg.reply(content);
        }
        catch (err) {
            err_msg = err.message;
            nTry += 1;
        }
    }
    await sendLog(client, "Error safeMsgReply : " + err_msg);
    return null;
}
export { safeMsgReply };
//# sourceMappingURL=safeMsgReply.js.map