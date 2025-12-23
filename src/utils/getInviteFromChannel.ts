import type {TextChannel} from "discord.js";

async function getInviteFromChannel(channel: TextChannel): Promise<string> {
    try {
        const invite = await channel.createInvite({
            maxAge: 0,
            maxUses: 0,
            unique: false
        });
        return invite.url;
    } catch (error) {
        return "";
    }
}

export {getInviteFromChannel};