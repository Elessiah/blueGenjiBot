function checkPermissions(interaction) {
    try {
        if (!interaction.member || !("id" in interaction.member)) {
            return false;
        }
        if (interaction.member.id === process.env.OWNER_ID || interaction.member.id === process.env.PRESIDENT) {
            return true;
        }
        if (!interaction.guild || !interaction.channel) {
            return false;
        }
        const member = interaction.guild.members.cache.get(interaction.user.id);
        if (!member) {
            return false;
        }
        const targetChannel = interaction.channel;
        if (!targetChannel) {
            return false;
        }
        const channelPermissions = targetChannel.permissionsFor(member);
        if (!channelPermissions) {
            return false;
        }
        const isAdmin = channelPermissions.has("Administrator");
        if (isAdmin) {
            return true;
        }
    }
    catch (e) {
        console.error("Error while checking permissions : " + e.message);
    }
    return false;
}
export { checkPermissions };
//# sourceMappingURL=checkPermissions.js.map