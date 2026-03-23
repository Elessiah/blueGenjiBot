import { Client, ChatInputCommandInteraction,MessageFlags, type TextChannel} from "discord.js";

import type {Bdd} from "../bdd/Bdd.js";
import { getBddInstance} from "../bdd/Bdd.js";
import {checkPermissions} from "../check/checkPermissions.js";
import {safeChannel} from "../safe/safeChannel.js";
import {safeReply} from "../safe/safeReply.js";
import {sendLog} from "../safe/sendLog.js";

/**
 * Diffuse un message administratif vers tous les channels partenaires
 * @param client Client Discord utilisé pour les appels API.
 * @param interaction Interaction utilisateur en cours.
 * @returns `false` si permissions insuffisantes; sinon `true` après tentative de diffusion globale (même avec erreurs partielles).
 */
async function broadcast(client: Client,
                         interaction: ChatInputCommandInteraction): Promise<boolean> {
    if (!await checkPermissions(interaction)) {
        await safeReply(interaction, "You don't have permission to broadcast !");
        return false;
    }
    const bdd: Bdd = await getBddInstance();
    await interaction.deferReply({flags: MessageFlags.Ephemeral});
    const targets: {id_channel: string}[] = await bdd.get("ChannelPartner", ["id_channel"]) as {id_channel: string}[];
    const msg = `# Developer Announcement Broadcast!\n> ${interaction.options.getString("message")}`;
    for (const target of targets) {
        try {
            const channel: TextChannel | null = await client.channels.fetch(target.id_channel) as TextChannel | null;
            if (channel == null) {
                continue;
            }
            await safeChannel(client, channel, undefined, [], msg);
        } catch (e) {
            await sendLog(client, "Broadcast channel has failed one time : " + (e as TypeError).message);
        }
    }
    await safeReply(interaction, "Broadcast executed !", true, true);
    return true;
}

export {broadcast};
