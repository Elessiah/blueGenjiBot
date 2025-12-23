import { getBddInstance } from "../../bdd/Bdd.js";
import { sendLog } from "../../safe/sendLog.js";
import { safeReply } from "../../safe/safeReply.js";
import { regions } from "../../utils/globals.js";
import { getInviteFromChannel } from "../../utils/getInviteFromChannel.js";
import { MessageFlags } from "discord.js";
async function listPartner(client, interaction) {
    try {
        const bdd = await getBddInstance();
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const service_name = interaction.options.getString("service");
        const channels = await bdd.get("ChannelPartnerService", ["ChannelPartnerService.id_channel", "region"], {
            "Service": "ChannelPartnerService.id_service = Service.id_service",
            "ChannelPartner": "ChannelPartnerService.id_channel = ChannelPartner.id_channel",
        }, { query: "name = ?", values: [service_name] });
        let guilds = new Array(regions.length);
        for (const channel_info of channels) {
            const channel = await client.channels.fetch(channel_info.id_channel);
            if (!channel) {
                await sendLog(client, "Failed to fetch channel : " + channel_info.id_channel);
                continue;
            }
            guilds[channel_info.region].push(" - [" + channel.guild.name + "](" + (await getInviteFromChannel(channel)) + ")");
        }
        let subContent = "";
        for (let i = 0; i < regions.length; i++) {
            if (guilds[i].length > 0)
                subContent += `## ${regions[i]}\n` + guilds[i].join("\n") + '\n';
        }
        const content = `List of all affiliated servers for service \`${service_name}\` *(Invite link embedded in a hyperlink with their name)* : \n` + subContent + '----------\nThanks again for using our services !';
        await safeReply(interaction, content, true, true);
    }
    catch (e) {
        await safeReply(interaction, "An error occurred while trying to retrieve list. Please try again.", false, true);
        console.error("Error while displaying listPartner : ", e.message);
    }
}
export { listPartner };
//# sourceMappingURL=listPartner.js.map