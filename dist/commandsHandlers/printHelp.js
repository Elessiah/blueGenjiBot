import { MessageFlags } from "discord.js";
const fs = require('fs').promises;
import { safeReply } from '../safe/safeReply.js';
import { sendLog } from "../safe/sendLog.js";
import { safeFollowUp } from "../safe/safeFollowUp.js";
async function printHelp(client, interaction) {
    try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const lang = interaction.options.getString("language");
        if (!lang) {
            await safeReply(interaction, "Missing parameter 'langage'. Please try again !");
            return;
        }
        let help;
        if (lang == "en")
            help = await fs.readFile('./help.md', 'utf8');
        else
            help = await fs.readFile('./helpfr.md', 'utf8');
        if (help.length > 2000) {
            const msgs = help.split("##");
            await safeReply(interaction, "Showing help in " + lang + " language", true, true);
            for (const msg of msgs) {
                await safeFollowUp(interaction, "##" + msg, true, []);
            }
        }
        else
            await safeReply(interaction, help, true, true);
    }
    catch (err) {
        await safeReply(interaction, err.message + "\n Please contact elessiah", true, true);
        await sendLog(client, "Print help error : \n" + err.message);
    }
}
export { printHelp };
//# sourceMappingURL=printHelp.js.map