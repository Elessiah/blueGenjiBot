const {getBddInstance} = require("./Bdd");
const sendLog = require("./safe/sendLog");

async function buildServerChoices(client) {
    const bdd = await getBddInstance()
    if (!bdd) {
        return (await sendLog(client, "Bdd failed in build server choices !"));
    }
    let guilds = await bdd.get("ChannelPartner", ["id_guild"]);
    if (guilds.length === 0) {
        return ([]);
    }
    guilds = [...new Map(guilds.map(obj => [obj.id_guild, obj])).values()];
    let res;
    res = [];
    for (const guild of guilds) {
        try {
            const guildName = (await client.guilds.fetch(guild.id_guild)).name;
            res.push({name: guildName, value: `${guild.id_guild}`});
        } catch (e) {
            await sendLog(client, "Failed to recover name for guild id : " + guild.id_guild + ". Error: " + e.message);
        }
    }
    return res;
}

module.exports = buildServerChoices;