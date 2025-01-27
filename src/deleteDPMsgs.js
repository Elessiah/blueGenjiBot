const {getBddInstance} = require("./Bdd");
const sendLog = require("./safe/sendLog");

async function deleteDPMsgs(client, OGMessageID) {
    const bdd = await getBddInstance();
    if (!bdd) {
        await sendLog(client, "Failed get bdd instance in deleteDPMsgs");
        return;
    }
    let DPMsgs;
    try {
        DPMsgs = await bdd.get("DPMsg", ["id_msg", "id_channel"], {}, {"id_og": OGMessageID});
    } catch (error) {
        await sendLog(client, "Failed to get duplications messages " + error.message);
        return;
    }
    for (let dPMsg of DPMsgs) {
        let msg = await client.channels.fetch(dPMsg.id_channel);
        msg = await msg.messages.fetch(dPMsg.id_msg);
        try {
            await msg.delete();
        } catch (err) {
            await sendLog(client, "Failed to delete: " + err.message);
        }
    }
}

module.exports = deleteDPMsgs;