const sendLog = require("../safe/sendLog");

async function checkPermissions(interaction) {
    try {
        if (interaction.member.id === process.env.OWNER_ID || interaction.member.id === process.env.PRESIDENT)
            return true;
        const member = interaction.guild.members.cache.get(interaction.user.id);
        const isAdmin = interaction.channel.permissionsFor(member).has();
        if (isAdmin)
            return true;
    } catch (e) {
        // await sendLog(interaction.client, "Error while checking permissions : " + e.message);
        console.error("Error while checking permissions : " + e.message);
    }
    return false;
}

module.exports = checkPermissions;
