import {Client, Guild, GuildBasedChannel, GuildMember, Role, TextChannel, User} from "discord.js";
import {Bdd, getBddInstance} from "@/bdd/Bdd.js";
import {adhesionIntervalIds, adhesionIntervalObj} from "@/adhesion/types.js";
import {sendAdhesion} from "@/adhesion/sendAdhesion.js";
import {sendLog} from "@/safe/sendLog.js";
import {safeUser} from "@/safe/safeUser.js";
import {removeIntervalle} from "@/adhesion/removeIntervalle.js";
import {checkTargets} from "@/adhesion/checkTargets.js";

/**
 * Récupère les objets Discord (serveur, canal, rôle, membre, auteur) à partir des ids en base.
 * Nettoie les cibles invalides et supprime l'intervalle si aucune cible valable ne reste.
 * @param client Client Discord utilisé pour les récuperations API.
 * @param bdd Instance de base de données utilisée pour les mises à jour/suppressions.
 * @param interval Intervalle d'adhésion contenant les ids a résoudre.
 * @returns L'intervalle enrichi des objets Discord, ou `null` si l'intervalle est invalidé/supprimé.
 */
async function fetchTargets(client: Client, bdd: Bdd, interval: adhesionIntervalIds): Promise<adhesionIntervalObj | null> {
    let user: User;
    try {
        user = await client.users.fetch(interval.author_id);
    } catch(e) {
        await sendLog(client, "L'auteur de l'interval " + interval.guild_id + " est perdu. Suppression de l'interval...");
        await removeIntervalle(client, bdd, undefined, interval.id,"");
        return null;
    }
    let guild: Guild;
    try {
        guild = await client.guilds.fetch(interval.guild_id);
    } catch (e) {
        const msg: string = "Intervale n°" + interval.id + " annulée car le bot n'est plus sur le serveur concerné.";
        await removeIntervalle(client, bdd, user, interval.id, msg);
        return null;
    }

    let channel: TextChannel | null = null;
    if (interval.channel_id != null) {
        let fetchResult: GuildBasedChannel | null;
        try {
            fetchResult = await guild.channels.fetch(interval.channel_id);
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
                    "Le channel n'est plus valide pour l'interval n°" + interval.id + ", suppression de la cible.")
            }
            interval.channel_id = null;
            await checkTargets(client, bdd, user, interval)
        }
    }
    let role: Role | null = null;
    if (interval.role_id != null) {
        const fetchResult: Role | null = await guild.roles.fetch(interval.role_id);
        if (fetchResult) {
            role = fetchResult;
        } else {
            if (user) {
                await safeUser(
                    client,
                    user,
                    undefined,
                    undefined,
                    "Le role n'est plus valide pour l'interval " + interval.id + ", suppression de la cible.");
            }
            interval.role_id = null;
            await checkTargets(client, bdd, user, interval);
        }
    }
    let member: GuildMember | null = null;
    if (interval.member_id != null) {
        try {
            member = await guild.members.fetch(interval.member_id);
        } catch (e) {
            if (user) {
                await safeUser(
                    client,
                    user,
                    undefined,
                    undefined,
                    "Le membre n'est plus valide pour l'interval " + interval.id + ", suppression de la cible.");
            }
            interval.member_id = null;
            await checkTargets(client, bdd, user, interval);
        }
    }
    return {
        id: interval.id,
        message: interval.message,
        guild: guild,
        channel: channel,
        member: member,
        role: role,
        author: user,
        interval_days: interval.interval_days,
        iteration: interval.iteration,
        nextTransmission: new Date(interval.nextTransmission),
    }
}

export {fetchTargets}
