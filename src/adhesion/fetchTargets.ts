import {Client, Guild, GuildBasedChannel, GuildMember, Role, TextChannel, User} from "discord.js";
import {Bdd} from "@/bdd/Bdd.js";
import {adhesionIntervalIds, adhesionIntervalObj} from "@/adhesion/types.js";
import {sendLog} from "@/safe/sendLog.js";
import {safeUser} from "@/safe/safeUser.js";
import {removeIntervalle} from "@/adhesion/removeIntervalle.js";
import {checkTargets} from "@/adhesion/checkTargets.js";
import {isGone} from "@/adhesion/isGone.js";
import {fetchRoleMembers} from "@/utils/fetchRoleMembers.js";

/**
 * Lecture reportée au prochain passage : Discord a échoué sans dire que l'objet
 * n'existe plus (limite de débit, coupure). Rien n'est envoyé ni effacé.
 */
const POSTPONED = Symbol("postponed");

/** Colonnes de cible d'un rappel. */
type TargetColumn = "channel_id" | "role_id" | "member_id";

/**
 * Récupère les objets Discord (serveur, canal, rôle, membre, auteur) à partir des ids en base.
 * Nettoie les cibles invalides et supprime l'intervalle si aucune cible valable ne reste.
 * @param client Client Discord utilisé pour les récuperations API.
 * @param bdd Instance de base de données utilisée pour les mises à jour/suppressions.
 * @param interval Intervalle d'adhésion contenant les ids a résoudre.
 * @returns L'intervalle enrichi des objets Discord, ou `null` si l'intervalle est invalidé/supprimé.
 */
async function fetchTargets(client: Client, bdd: Bdd, interval: adhesionIntervalIds): Promise<adhesionIntervalObj | null> {
    const user = await fetchAuthor(client, bdd, interval);
    if (user === null) return null;
    const guild = await fetchGuild(client, bdd, interval, user);
    if (guild === null) return null;

    const channel = await resolveChannel(client, bdd, interval, guild, user);
    if (channel === POSTPONED) return null;
    const role = await resolveRole(client, bdd, interval, guild, user);
    const member = await resolveMember(client, bdd, interval, guild, user);
    if (member === POSTPONED) return null;
    if (role !== null && !(await roleMembersReadable(client, interval, guild, role))) return null;

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

/**
 * Lit l'auteur du rappel. Disparu, il emporte le rappel ; injoignable pour
 * l'instant, le rappel est reporté.
 * @returns L'auteur, ou `null` si le rappel s'arrête là pour ce passage.
 */
async function fetchAuthor(client: Client, bdd: Bdd, interval: adhesionIntervalIds): Promise<User | null> {
    try {
        return await client.users.fetch(interval.author_id);
    } catch (e) {
        if (!isGone(e)) {
            // Erreur passagère : on repasse au prochain tour, sans rien effacer.
            await sendLog(client, "Interval n°" + interval.id + " : auteur injoignable pour l'instant, report.");
            return null;
        }
        await sendLog(client, "L'auteur de l'interval " + interval.guild_id + " est perdu. Suppression de l'interval...");
        await removeIntervalle(client, bdd, undefined, interval.id,"");
        return null;
    }
}

/**
 * Lit le serveur du rappel. Quitté, il emporte le rappel (l'auteur est
 * prévenu) ; injoignable pour l'instant, le rappel est reporté.
 * @returns Le serveur, ou `null` si le rappel s'arrête là pour ce passage.
 */
async function fetchGuild(client: Client, bdd: Bdd, interval: adhesionIntervalIds, user: User): Promise<Guild | null> {
    try {
        return await client.guilds.fetch(interval.guild_id);
    } catch (e) {
        if (!isGone(e)) {
            await sendLog(client, "Interval n°" + interval.id + " : serveur injoignable pour l'instant, report.");
            return null;
        }
        const msg: string = "Intervale n°" + interval.id + " annulée car le bot n'est plus sur le serveur concerné.";
        await removeIntervalle(client, bdd, user, interval.id, msg);
        return null;
    }
}

/**
 * Lit le salon cible, s'il y en a un. Introuvable ou disparu, la cible est
 * retirée ; seule une erreur passagère reporte le rappel.
 * @returns Le salon, `null` sans salon (ou salon retiré), `POSTPONED` sur une erreur passagère.
 */
async function resolveChannel(client: Client,
                              bdd: Bdd,
                              interval: adhesionIntervalIds,
                              guild: Guild,
                              user: User): Promise<TextChannel | null | typeof POSTPONED> {
    if (interval.channel_id == null) return null;
    let fetchResult: GuildBasedChannel | null;
    try {
        fetchResult = await guild.channels.fetch(interval.channel_id);
    } catch (e) {
        // Même règle que pour l'auteur et le serveur : seul un « inconnu » retire la cible.
        if (!isGone(e)) return POSTPONED;
        fetchResult = null;
    }
    if (fetchResult) return fetchResult as TextChannel;
    await dropTarget(client, bdd, user, interval, "channel_id",
        "Le channel n'est plus valide pour l'interval n°" + interval.id + ", suppression de la cible.");
    return null;
}

/**
 * Lit le rôle cible, s'il y en a un. Introuvable, la cible est retirée ; une
 * erreur de lecture remonte à l'appelant.
 * @returns Le rôle, ou `null` sans rôle (ou rôle retiré).
 */
async function resolveRole(client: Client,
                           bdd: Bdd,
                           interval: adhesionIntervalIds,
                           guild: Guild,
                           user: User): Promise<Role | null> {
    if (interval.role_id == null) return null;
    const fetchResult: Role | null = await guild.roles.fetch(interval.role_id);
    if (fetchResult) return fetchResult;
    await dropTarget(client, bdd, user, interval, "role_id",
        "Le role n'est plus valide pour l'interval " + interval.id + ", suppression de la cible.");
    return null;
}

/**
 * Lit le membre cible, s'il y en a un. Disparu, la cible est retirée ; une
 * erreur passagère reporte le rappel.
 * @returns Le membre, `null` sans membre (ou membre retiré), `POSTPONED` sur une erreur passagère.
 */
async function resolveMember(client: Client,
                             bdd: Bdd,
                             interval: adhesionIntervalIds,
                             guild: Guild,
                             user: User): Promise<GuildMember | null | typeof POSTPONED> {
    if (interval.member_id == null) return null;
    try {
        return await guild.members.fetch(interval.member_id);
    } catch (e) {
        if (!isGone(e)) return POSTPONED;
        await dropTarget(client, bdd, user, interval, "member_id",
            "Le membre n'est plus valide pour l'interval " + interval.id + ", suppression de la cible.");
        return null;
    }
}

/**
 * Récupère les membres du serveur pour que le rôle cible soit lisible à
 * l'envoi. Un échec (délai, limite de débit) reporte tout le rappel au
 * prochain passage, sans consommer d'envoi : sinon les membres du rôle
 * attendraient une période entière, et un rappel à son dernier envoi
 * s'effacerait sans les avoir servis. L'envoi qui suit relit le rôle sans
 * nouvelle récupération, le cache étant alors complet.
 * @returns `true` si les membres du rôle sont lisibles.
 */
async function roleMembersReadable(client: Client,
                                   interval: adhesionIntervalIds,
                                   guild: Guild,
                                   role: Role): Promise<boolean> {
    try {
        await fetchRoleMembers(guild, role);
        return true;
    } catch {
        await sendLog(client, "Interval n°" + interval.id + " : membres du rôle injoignables pour l'instant, report.");
        return false;
    }
}

/**
 * Retire une cible disparue : l'auteur est prévenu, la cible effacée du
 * rappel, et le rappel supprimé s'il ne lui reste aucune cible.
 * @param notice Avis envoyé à l'auteur.
 */
async function dropTarget(client: Client,
                          bdd: Bdd,
                          user: User,
                          interval: adhesionIntervalIds,
                          column: TargetColumn,
                          notice: string): Promise<void> {
    await safeUser(client, user, undefined, undefined, notice);
    interval[column] = null;
    await checkTargets(client, bdd, user, interval);
}

export {fetchTargets}
