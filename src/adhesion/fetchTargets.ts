import {Client, Guild, GuildBasedChannel, GuildMember, Role, TextChannel, User} from "discord.js";
import {Bdd, getBddInstance} from "@/bdd/Bdd.js";
import {adhesionIntervalIds, adhesionIntervalObj} from "@/adhesion/types.js";
import {sendAdhesion} from "@/adhesion/sendAdhesion.js";
import {sendLog} from "@/safe/sendLog.js";
import {safeUser} from "@/safe/safeUser.js";
import {removeIntervalle} from "@/adhesion/removeIntervalle.js";
import {checkTargets} from "@/adhesion/checkTargets.js";

async function fetchTargets(client: Client, bdd: Bdd, intervalle: adhesionIntervalIds): Promise<adhesionIntervalObj | null> {
    let user: User;
    try {
        user = await client.users.fetch(intervalle.author_id);
    } catch(e) {
        await sendLog(client, "L'auteur de l'intervalle " + intervalle.guild_id + " est perdu. Suppression de l'interval...");
        await removeIntervalle(client, bdd, undefined, intervalle.id,"");
        return null;
    }
    let guild: Guild;
    try {
        guild = await client.guilds.fetch(intervalle.guild_id);
    } catch (e) {
        const msg: string = "Intervale n°" + intervalle.id + " annulée car le bot n'est plus sur le serveur concerné.";
        await removeIntervalle(client, bdd, user, intervalle.id, msg);
        return null;
    }

    if (!guild)
    {

    }
    let channel: TextChannel | null = null;
    if (intervalle.channel_id != null) {
        let fetchResult: GuildBasedChannel | null;
        try {
            fetchResult = await guild.channels.fetch(intervalle.channel_id);
        } catch (e) {
            fetchResult = null;
        }
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
        const fetchResult: Role | null = await guild.roles.fetch(intervalle.role_id);
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
        try {
            member = await guild.members.fetch(intervalle.member_id);
        } catch (e) {
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
        interval_days: intervalle.interval_days,
        nextTransmission: new Date(intervalle.nextTransmission),
    }
}

export {fetchTargets}