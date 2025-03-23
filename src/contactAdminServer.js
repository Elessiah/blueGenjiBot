const checkPermissions = require("./checkPermissions");
const { PermissionsBitField } = require("discord.js");
const safeReply = require("./safe/safeReply");
const {getBddInstance} = require("./Bdd");
const sendLog = require("./safe/sendLog");
const safeUser = require("./safe/safeUser");

async function contactAdminServer(client, interaction) {
    if (await checkPermissions(interaction) === false) {
        await safeReply(interaction, "You don't have permission to ban users.\n" +
            "Please contact 'Elessiah' or your server administrators to take appropriate action if needed.\n");
        return false;
    }
    const bdd = await getBddInstance();
    if (!bdd) {
        await sendLog(client, "Bdd failed in ban !");
        return false;
    }
    const serverId = interaction.options.getString("server");
    const server = await client.guilds.fetch(serverId);
    const adminRoles = server.roles.cache.filter(r =>
        r.permissions.has(PermissionsBitField.Flags.Administrator)
    );
    let targets;
    targets = [];
    for (const [roleId, role] of adminRoles) {
        targets.push(...(role.members.map(member => member.user)));
    }
    const msg = interaction.options.getString("message");
    let errMsg = "";
    for (const target of targets) {
        if (await safeUser(client, target, null, [], msg) === false) {
            errMsg += "Echec de l'envoi pour " + target.globalName + "\n";
        }
    }
    if (errMsg.length > 0) {
        await sendLog(client, "Erreur pour l'envoies au admins : \n" + errMsg);
    }
    await safeReply(interaction, "Message successfully sent.");
}

module.exports = contactAdminServer;