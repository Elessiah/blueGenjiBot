import { getBddInstance } from "../bdd/Bdd.js";
async function manageMsgExpiration(client) {
    const bdd = await getBddInstance();
    const expiration = new Date(await bdd.getCurrentTimestamp());
    expiration.setHours(expiration.getHours() - 72);
    await bdd.rm('DPMsg', {}, { query: "date < ?", values: [expiration.toISOString()] });
    const expiredMsgs = await bdd.get("OGMsg", ["id_msg"], {}, { query: "date < ?", values: [expiration.toISOString()] });
    for (const expiredMsg of expiredMsgs) {
        await bdd.rm('MessageService', {}, { query: "id_msg = ?", values: [expiredMsg.id_msg] });
    }
    await bdd.rm('OGMsg', {}, { query: "OGMsg.date < ?", values: [expiration.toISOString()] });
}
export { manageMsgExpiration };
//# sourceMappingURL=manageMsgExpiration.js.map