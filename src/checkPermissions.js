async function checkPermissions(interaction) {
    try {
        const member = interaction.guild.members.cache.get(interaction.user.id);
        return !((member.permissions.has("ADMINISTRATOR")) && interaction.member.id !== process.env.OWNER_ID);
    } catch (e) {
        console.log(e);
        return interaction.member.id === process.env.OWNER_ID;

    }
}

module.exports = checkPermissions;
