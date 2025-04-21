const safeReply = require("../safe/safeReply");
const { spawn } = require("child_process");

async function restartBot(client, interaction) {
    const userTry = interaction.options.getString("password");
    if (process.env.PASSWORD === userTry) {
        await safeReply(interaction, "See you soon ! Restarting...");
        const child = spawn('../bot.sh', {
            detached: true,
            stdio: 'ignore',
        });

        child.unref();
    } else {
        await safeReply(interaction, "Wrong password ! Are you sure you have right to do this ?");
    }
}

module.exports = restartBot;