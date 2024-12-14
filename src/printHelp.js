const fs = require('fs').promises;

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
            await interaction.reply({content: "Showing help in " + lang + " language"})
            for (const msg of msgs) {
                await interaction.followUp({content: "##" + msg});
            }
        }
        else
            await interaction.reply({content: help});
    } catch (err) {
        await interaction.reply({content: err.message + "\n Please contact elessiah", ephemeral: true});
    }
}

module.exports = printHelp;