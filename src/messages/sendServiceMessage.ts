import {sendLog} from "../safe/sendLog.js";
import {safeChannel} from "../safe/safeChannel.js";
import type {TextChannel, Client, Embed, EmbedBuilder, Message} from "discord.js";
import type {Bdd} from "../bdd/Bdd.js";


async function sendServiceMessage(client: Client,
                                  targets: {id_channel: string}[],
                                  message: Message,
                                  embed: EmbedBuilder | Embed | undefined,
                                  bdd: Bdd,
                                  ranks: string[]): Promise<number> {
    let nbPartner: number = 0;
    for (const target of targets) {
        if (target.id_channel === message.channel.id || !(await bdd.partnerHasRanks(target.id_channel, ranks))) {
            continue;
        }
        const channel: TextChannel | null = await client.channels.fetch(target.id_channel) as TextChannel | null;
        if (!channel)
        {
            await sendLog(client, `Failed to fetch channel ${target.id_channel} for sending service message`);
            return -1;
        }
        const sentMsg: Message | null = await safeChannel(client, channel, embed);
        if (sentMsg) {
            const ret = await bdd.set("DPMsg",
                ['id_msg', 'id_channel', 'id_og'],
                [sentMsg.id, channel.id, message.id]);
            if (!ret.success) {
                await sendLog(client, "In manageDistribution : " + ret.message);
            }
            nbPartner++;
        }
    }
    return nbPartner;
}

export {sendServiceMessage};