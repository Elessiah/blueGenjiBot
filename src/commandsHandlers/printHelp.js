const fs = require('fs').promises;
const safeReply = require('../safe/safeReply');
const sendLog = require("../safe/sendLog");
const safeFollowUp = require("../safe/safeFollowUp");

const printHelp = async(client, interaction) => {
    try {
        await interaction.deferReply({ephemeral: true});
        const lang = interaction.options.getString("language");
        let help;
        if (lang === "en")
            help = await fs.readFile('./help.md', 'utf8');
        else
            help = await fs.readFile('./helpfr.md', 'utf8');
        if (help.length > 2000) {
            const msgs = help.split("##");
            await safeReply(interaction, "Showing help in " + lang + " language", true, true);
            for (const msg of msgs) {
                await safeFollowUp(interaction, "##" + msg, true);
            }
        }
        else
            await safeReply(interaction, help, true, true);
    } catch (err) {
        await safeReply(interaction, err.message + "\n Please contact elessiah", true, true);
        await sendLog(client, "Print help error : \n" + err);
    }
}

module.exports = printHelp;