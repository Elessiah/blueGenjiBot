import type {Client, Channel, TextChannel, Message} from "discord.js";

import {sendLog} from "../safe/sendLog.js";

import {type Bdd, getBddInstance} from "./Bdd.js";
import type {DPMsg} from "./types.js";

/**
 * Nettoie les messages privés envoyés par le bot devenus obsolètes.
 * @param client Client Discord utilisé pour les appels API.
 * @param OGMessageID Identifiant du message source dont les copies privées doivent être supprimées.
 */
async function deleteDPMsgs(client: Client, OGMessageID: string): Promise<void> {
    const bdd: Bdd = await getBddInstance();
    const DPMsgs: DPMsg[] = await bdd.get("DPMsg", ["id_msg", "id_channel"], {}, {query: "id_og = ?", values: [OGMessageID]}) as DPMsg[];
    for (const dPMsg of DPMsgs) {
        const channel: Channel | null = await client.channels.fetch(dPMsg.id_channel);
        if (!channel)
            {return;}
        const msg: Message = await (channel as TextChannel).messages.fetch(dPMsg.id_msg);
        try {
            if (msg)
            {await msg.delete();}
        } catch (err) {
            await sendLog(client, "Failed to delete: " + (err as TypeError).message);
        }
    }
}

export {deleteDPMsgs};
