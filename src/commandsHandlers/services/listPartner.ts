import {Bdd, getBddInstance} from "../../bdd/Bdd.js";
import {sendLog} from "../../safe/sendLog.js";
import {safeReply} from "../../safe/safeReply.js";
import {regions} from "../../utils/globals.js";
import {getInviteFromChannel} from "../../utils/getInviteFromChannel.js";

import {MessageFlags} from "discord.js";
import type {Client, TextChannel, ChatInputCommandInteraction} from "discord.js";

async function listPartner(client: Client,
                           interaction: ChatInputCommandInteraction): Promise<void> {
    try {
        const bdd: Bdd = await getBddInstance();
        await interaction.deferReply({flags: MessageFlags.Ephemeral});
        const service_name: string | null = interaction.options.getString("service");
        const channels: {id_channel: string, region: number}[] = await bdd.get("ChannelPartnerService",
            ["ChannelPartnerService.id_channel", "region"],
            {
                "Service": "ChannelPartnerService.id_service = Service.id_service",
                "ChannelPartner": "ChannelPartnerService.id_channel = ChannelPartner.id_channel",
            },
            {query: "name = ?", values: [service_name]}
        ) as {id_channel: string, region: number}[];
        let guilds: string[][] = new Array<Array<string>>(regions.length);
        for (let i = 0; i < guilds.length; i++) {
            guilds[i] = new Array<string>();
        }
        for (const channel_info of channels) {
            const channel: TextChannel | null = await client.channels.fetch(channel_info.id_channel) as TextChannel | null;
            if (!channel) {
                await sendLog(client, "Failed to fetch channel : " + channel_info.id_channel);
                continue;
            }
            guilds[channel_info.region].push(" - [" + channel.guild.name + "](" + (await getInviteFromChannel(channel)) + ")");
        }
        let subContent: string = "";
        for (let i: number = 0; i < regions.length; i++) {
            if (guilds[i].length > 0)
                subContent += `## ${regions[i]}\n` + guilds[i].join("\n") + '\n';
        }
        const content: string = `List of all affiliated servers for service \`${service_name}\` *(Invite link embedded in a hyperlink with their name)* : \n` + subContent + '----------\nThanks again for using our services !';
        await safeReply(interaction, content, true, true);
    } catch (e) {
        await safeReply(interaction, "An error occurred while trying to retrieve list. Please try again.", false, true);
        console.error("Error while displaying listPartner : ", (e as TypeError).message);
    }
}

export { listPartner };