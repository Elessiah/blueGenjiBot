const safeReply = require("../safe/safeReply");
const { exec } = require("child_process");

async function restartBot(client, interaction) {
    const userTry = interaction.options.getString("password");
    if (process.env.PASSWORD === userTry) {
        await safeReply(interaction, "See you soon ! Restarting...");
        exec('../bot.sh &');
    } else {
        await safeReply(interaction, "Wrong password ! Are you sure you have right to do this ?");
    }
}

module.exports = restartBot;