const ban = require("./ban")

async function ban_id(client, interaction) {
    const user = interaction.options.getMember("user");
    const reason = interaction.options.getString("reason");
    return await ban(client, interaction, user.user, reason);
}

module.exports = ban_id;