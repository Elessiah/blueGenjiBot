import { safeMsgReply } from "@/safe/safeMsgReply.js";
async function _deleteTempMsg(target) {
    if (target) {
        await target.delete();
    }
}
async function answerTmp(client, message, content, time) {
    const temp_msg = await safeMsgReply(client, message, content);
    setTimeout(() => {
        void _deleteTempMsg(temp_msg);
    }, time);
}
export { answerTmp };
//# sourceMappingURL=answerTmp.js.map