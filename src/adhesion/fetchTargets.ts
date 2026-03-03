import {Client, Guild, GuildBasedChannel, GuildMember, Role, TextChannel, User} from "discord.js";
import {Bdd, getBddInstance} from "@/bdd/Bdd.js";
import {adhesionIntervalIds, adhesionIntervalObj} from "@/adhesion/types.js";
import {sendAdhesion} from "@/adhesion/sendAdhesion.js";
import {sendLog} from "@/safe/sendLog.js";
import {safeUser} from "@/safe/safeUser.js";
import {removeIntervalle} from "@/adhesion/removeIntervalle.js";
import {checkTargets} from "@/adhesion/checkTargets.js";

async function fetchTargets(client: Client, bdd: Bdd, intervalle: adhesionIntervalIds): Promise<adhesionIntervalObj | null> {
    const guild: Guild | undefined = client.guilds.cache.get(intervalle.guild_id);
    const user: User | undefined = client.users.cache.get(intervalle.author_id)
    if (user === undefined)
    {
        await sendLog(client, "L'auteur de l'intervalle " + intervalle.guild_id + " est perdu. Suppression de l'interval...");
        await removeIntervalle(client, bdd, undefined, intervalle.id,"");
        return null;
    }
    if (!guild)
    {
        const msg: string = "Intervale n°" + intervalle.id + " annulée car le bot n'est plus sur le serveur concerné.";
        await removeIntervalle(client, bdd, user, intervalle.id, msg);
        return null;
    }
    let channel: TextChannel | null = null;
    if (intervalle.channel_id != null) {
        const fetchResult: GuildBasedChannel | undefined = guild.channels.cache.get(intervalle.channel_id);
        if (fetchResult) {
            channel = fetchResult as TextChannel;
        } else {
            if (user) {
                await safeUser(
                    client,
                    user,
                    undefined,
                    undefined,
                    "Le channel n'est plus valide pour l'intervalle n°" + intervalle.id + ", suppression de la cible.")
            }
            intervalle.channel_id = null;
            await checkTargets(client, bdd, user, intervalle)
        }
    }
    let role: Role | null = null;
    if (intervalle.role_id != null) {
        const fetchResult: Role | undefined = guild.roles.cache.get(intervalle.role_id);
        if (fetchResult) {
            role = fetchResult;
        } else {
            if (user) {
                await safeUser(
                    client,
                    user,
                    undefined,
                    undefined,
                    "Le role n'est plus valide pour l'intervalle " + intervalle.id + ", suppression de la cible.");
            }
            intervalle.role_id = null;
            await checkTargets(client, bdd, user, intervalle);
        }
    }
    let member: GuildMember | null = null;
    if (intervalle.member_id != null) {
        const fetchResult: GuildMember | undefined = await guild.members.fetch(intervalle.member_id);
        if (fetchResult) {
            member = fetchResult;
        } else {
            if (user) {
                await safeUser(
                    client,
                    user,
                    undefined,
                    undefined,
                    "Le membre n'est plus valide pour l'intervalle " + intervalle.id + ", suppression de la cible.");
            }
            intervalle.member_id = null;
            await checkTargets(client, bdd, user, intervalle);
        }
    }
    return {
        id: intervalle.id,
        message: intervalle.message,
        guild: guild,
        channel: channel,
        member: member,
        role: role,
        author: user,
        intervalle: intervalle.intervalle,
        nextTransmission: intervalle.nextTransmission,
    }
}

export {fetchTargets}