import { sendLog } from "../safe/sendLog.js";
import { getBddInstance } from "./Bdd.js";
async function deleteDPMsgs(client, OGMessageID) {
    const bdd = await getBddInstance();
    const DPMsgs = await bdd.get("DPMsg", ["id_msg", "id_channel"], {}, { query: "id_og = ?", values: [OGMessageID] });
    for (const dPMsg of DPMsgs) {
        const channel = await client.channels.fetch(dPMsg.id_channel);
        if (!channel) {
            return;
        }
        const msg = await channel.messages.fetch(dPMsg.id_msg);
        try {
            if (msg) {
                await msg.delete();
            }
        }
        catch (err) {
            await sendLog(client, "Failed to delete: " + err.message);
        }
    }
}
export { deleteDPMsgs };
//# sourceMappingURL=deleteDPMsgs.js.map