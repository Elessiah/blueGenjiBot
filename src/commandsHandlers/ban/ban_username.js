const ban = require("./ban")

async function ban_username(client, interaction) {
    const username = interaction.options.getString("username");
    const user = client.users.cache.find(u => u.tag === username);
    const reason = interaction.options.getString("reason");
    return await ban(client, interaction, user, reason);
}

module.exports = ban_username;