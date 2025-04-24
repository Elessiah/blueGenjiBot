const safeMsgReply = require("../safe/safeMsgReply");
const delay = require("./delay");

async function answerTmp(client, message, content, time) {
    const temp_msg = await safeMsgReply(client, message, content);
    if (temp_msg == null)
        return;
    await delay(time);
    await temp_msg.delete();
}

module.exports = answerTmp ;