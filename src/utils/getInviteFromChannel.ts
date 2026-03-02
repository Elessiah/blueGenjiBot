import type {Client, TextChannel} from "discord.js";

async function getInviteFromChannel(client: Client, channel: TextChannel): Promise<string> {
    try {
        const invites = await channel.guild.invites.fetch();

        let existing = invites.find(inv =>
            inv.inviter?.id === client.user?.id &&
            inv.maxAge === 0 &&
            inv.maxUses === 0
        );

        if (!existing) {
            existing = await channel.createInvite({
                maxAge: 0,
                maxUses: 0,
                unique: false
            });
        }

        return existing.url;
    } catch (error) {
        console.log("Erreur getInviteFromChannel: ", (error as TypeError).message);
        return "";
    }
}

export {getInviteFromChannel};