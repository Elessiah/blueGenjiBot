import { rankChoices } from "../config/rankChoices.js";
async function formatRawRanks(rawRanks) {
    let prettyRanks = "";
    for (const rank of rawRanks) {
        for (const choice of rankChoices) {
            if (choice.value === rank) {
                prettyRanks += `- **${choice.name}**\n`;
            }
        }
    }
    return prettyRanks;
}
export { formatRawRanks };
//# sourceMappingURL=formatRawRanks.js.map