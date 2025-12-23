import { getBddInstance } from "../bdd/Bdd.js";
import { sendLog } from "../safe/sendLog.js";
async function buildServerChoices(client) {
    const bdd = await getBddInstance();
    if (!bdd) {
        await sendLog(client, "Bdd failed in build server choices !");
        return ([]);
    }
    const partners = await bdd.get("ChannelPartner", ["id_guild"]);
    if (partners.length === 0) {
        return ([]);
    }
    const uniquePartners = [...new Map(partners.map(obj => [obj.id_guild, obj])).values()];
    const res = [];
    for (const guild of uniquePartners) {
        try {
            const guildName = (await client.guilds.fetch(guild.id_guild)).name;
            res.push({ name: guildName, value: `${guild.id_guild}` });
        }
        catch (e) {
            await sendLog(client, "Failed to recover name for guild id : " + guild.id_guild + ". Error: " + e.message);
        }
    }
    return res;
}
export { buildServerChoices };
//# sourceMappingURL=buildServerChoices.js.map