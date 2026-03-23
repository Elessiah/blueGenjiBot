import {Bdd, getBddInstance} from "../bdd/Bdd.js";
import type {Client} from "discord.js";

/**
 * Supprime ou invalide les messages de service expirés.
 * @param client Client Discord utilisé pour les appels API.
 */
async function manageMsgExpiration(client: Client): Promise<void> {
    const bdd: Bdd = await getBddInstance();
    const expiration = new Date(await bdd.getCurrentTimestamp());
    expiration.setHours(expiration.getHours() - 72);
    await bdd.rm('DPMsg', {}, {query: "date < ?", values: [expiration.toISOString()]});
    const expiredMsgs: {id_msg: string}[] = await bdd.get("OGMsg", ["id_msg"], {}, {query: "date < ?", values: [expiration.toISOString()]}) as {id_msg: string}[];
    for (const expiredMsg of expiredMsgs) {
        await bdd.rm('MessageService', {}, {query: "id_msg = ?", values: [expiredMsg.id_msg]});
    }
    await bdd.rm('OGMsg', {}, {query: "OGMsg.date < ?", values: [expiration.toISOString()]});
}

export {manageMsgExpiration};
