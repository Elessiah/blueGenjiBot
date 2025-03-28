async function getInviteFromChannel(channel) {
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

module.exports = getInviteFromChannel;