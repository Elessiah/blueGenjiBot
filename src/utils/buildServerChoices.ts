import type {Client} from "discord.js";

import {getBddInstance} from "../bdd/Bdd.js";
import {sendLog} from "../safe/sendLog.js";

import type {ServerChoice} from "./types.js";

/**
 * Construit les options de sélection de serveurs pour l'autocomplétion.
 * @param client Client Discord utilisé pour les appels API.
 * @returns Liste des choix de serveurs partenaires (`{ name, value }`), ou tableau vide si aucun résultat.
 */
async function buildServerChoices(client: Client): Promise<ServerChoice[]> {
    const bdd = await getBddInstance()
    if (!bdd) {
        await sendLog(client, "Bdd failed in build server choices !");
        return ([]);
    }
    const partners: {id_guild: string}[] = await bdd.get("ChannelPartner", ["id_guild"]) as {id_guild: string}[];
    if (partners.length === 0) {
        return ([]);
    }
    const uniquePartners: {id_guild: string}[] = [...new Map(partners.map(obj => [obj.id_guild, obj])).values()];
    const res: ServerChoice[] = [];
    for (const guild of uniquePartners) {
        try {
            const guildName = (await client.guilds.fetch(guild.id_guild)).name;
            res.push({name: guildName, value: `${guild.id_guild}`});
        } catch (e) {
            await sendLog(client, "Failed to recover name for guild id : " + guild.id_guild + ". Error: " + (e as TypeError).message);
        }
    }
    return res;
}

export {buildServerChoices};
