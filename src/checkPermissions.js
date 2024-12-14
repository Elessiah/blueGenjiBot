async function checkPermissions(interaction) {
    try {
        return !((!interaction.member || !interaction.member.permissions ||
            !interaction.member.permissions.has("ADMINISTRATOR")) && interaction.member.id !== process.env.OWNER_ID);
    } catch (e) {
        console.log(e);
        return false;
    }
}

module.exports = checkPermissions;
