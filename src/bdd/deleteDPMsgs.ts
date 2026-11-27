import type {Client, Channel, TextChannel, Message} from "discord.js";

import {sendLog} from "../safe/sendLog.js";

import {type Bdd, getBddInstance} from "./Bdd.js";
import type {DPMsg} from "./types.js";

/** Discord : salon ou message inconnu — la copie n'existe plus, rien à supprimer. */
const GONE_CODES = new Set([10003, 10008]);

/**
 * Nettoie les messages privés envoyés par le bot devenus obsolètes.
 * @param client Client Discord utilisé pour les appels API.
 * @param OGMessageID Identifiant du message source dont les copies privées doivent être supprimées.
 */
async function deleteDPMsgs(client: Client, OGMessageID: string): Promise<void> {
    const bdd: Bdd = await getBddInstance();
    const DPMsgs: DPMsg[] = await bdd.get("DPMsg", ["id_msg", "id_channel"], {}, {query: "id_og = ?", values: [OGMessageID]}) as DPMsg[];
    // Chaque copie a sa garde : un salon disparu ou une copie déjà supprimée ne
    // laisse pas les suivantes en place (le partiel `Message` fait passer ici
    // la suppression de tout message hors cache, plus seulement des récents).
    for (const dPMsg of DPMsgs) {
        try {
            const channel: Channel | null = await client.channels.fetch(dPMsg.id_channel);
            if (!channel)
                {continue;}
            const msg: Message = await (channel as TextChannel).messages.fetch(dPMsg.id_msg);
            await msg.delete();
        } catch (err) {
            if (GONE_CODES.has((err as {code?: unknown} | null)?.code as number)) {continue;}
            await sendLog(client, "Failed to delete: " + (err as TypeError).message);
        }
    }
}

export {deleteDPMsgs};
