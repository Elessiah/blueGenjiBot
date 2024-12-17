const fs = require('fs').promises;
const safeReply = require('./safe/safeReply');
const sendLog = require("./safe/sendLog");

const printHelp = async(interaction) => {
    try {
        const lang = interaction.options.getString("language");
        let help;
        if (lang === "en")
            help = await fs.readFile('./help.md', 'utf8');
        else
            help = await fs.readFile('./helpfr.md', 'utf8');
        if (help.length > 2000) {
            const msgs = help.split("##");
            await safeReply(interaction, "Showing help in " + lang + " language", true);
            for (const msg of msgs) {
                await safeReply(interaction, "##" + msg, true);
            }
        }
        else
            await safeReply(interaction, help, true);
    } catch (err) {
        await safeReply(interaction, err.message + "\n Please contact elessiah", true);
        await sendLog("Print help error : \n" + err);
    }
}

module.exports = printHelp;