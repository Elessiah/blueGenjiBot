import type { Client, Guild, GuildMember, Role } from "discord.js";
import { getBddInstance } from "@/bdd/Bdd.js";
import { sendLog } from "@/safe/sendLog.js";
import { findGuildMemberByHandle, parseDiscordHandle } from "@/notifications/resolveHandle.js";
import { capRefereeTargets, homeGuildIds, leadershipIds, MAX_REFEREE_DMS } from "@/notifications/notifications.js";
import type { DirectMessageRecipient } from "@/notifications/notifications.js";

/**
 * Distribution effective des messages poussés par l'app web.
 *
 * Séparé du module pur `notifications.ts` : ici seulement les effets — Discord,
 * la base, le canal de logs. Rien n'y lève : un DM refusé (compte fermé aux
 * messages privés, joueur parti du serveur) est un **résultat**, pas une
 * panne — l'app doit pouvoir dire au staff qui n'a pas été joint.
 */

/** Bilan d'une distribution de messages privés. */
export interface DeliveryReport {
  /** Messages effectivement remis. */
  sent: number;
  /** Destinataires absents du serveur BlueGenji : aucun envoi n'est tenté. */
  unresolved: string[];
  /** Membres du serveur mais injoignables (DM fermés, compte supprimé). */
  failed: string[];
}

/**
 * Aucun serveur BlueGenji n'est joignable : l'envoi n'a pas eu lieu.
 *
 * Levée plutôt que rendue en bilan. Le bot répondait `200` en déclarant tous
 * les destinataires « introuvables » — donc absents du serveur, ce qui est un
 * **résultat** que le site garde pour définitif (il ne réécrit pas à qui n'est
 * pas membre). Une configuration absente n'est pas un résultat : la route en
 * fait un `503`, et le site rend sa réservation pour réessayer.
 */
export class HomeGuildUnavailableError extends Error {
  constructor() {
    super("HOME_GUILD_UNAVAILABLE");
    this.name = "HomeGuildUnavailableError";
  }
}

/**
 * Serveurs BlueGenji, seule population que le bot démarche.
 *
 * Un rappel de match ne s'envoie qu'à un joueur de BlueGenji : c'est la règle
 * posée côté site (« ils devront être sur le serveur Discord »), et elle borne
 * aussi le risque — sans elle, un tag mal saisi pourrait faire écrire le bot à
 * un inconnu croisé sur un serveur partenaire. Les identifiants viennent de
 * {@link homeGuildIds}.
 *
 * @param client Client Discord.
 * @returns Les serveurs joignables, vide si aucun n'est configuré ou atteint.
 */
async function fetchHomeGuilds(client: Client): Promise<Guild[]> {
  const guilds: Guild[] = [];
  for (const guildId of homeGuildIds(process.env)) {
    try {
      guilds.push(await client.guilds.fetch(guildId));
    } catch {
      // Serveur quitté ou identifiant faux : les autres suffisent peut-être.
    }
  }
  return guilds;
}

/**
 * Retrouve un destinataire **parmi les membres du serveur BlueGenji**.
 *
 * L'ID prime quand l'app le connaît (compte lié par code Discord) : il évite la
 * recherche par tag. Dans les deux cas, la réponse vaut appartenance — un
 * `null` signifie « pas sur le serveur », donc pas d'envoi.
 */
async function findMemberIn(
  guild: Guild,
  recipient: DirectMessageRecipient,
): Promise<GuildMember | null> {
  if (recipient.discordId) {
    try {
      return await guild.members.fetch(recipient.discordId);
    } catch {
      // Membre inconnu de la guilde : on ne retombe pas sur le tag, l'ID est
      // l'identité la plus sûre et son absence tranche déjà la question.
      return null;
    }
  }

  const parsed = recipient.handle ? parseDiscordHandle(recipient.handle) : null;
  if (!parsed) { return null; }
  if (parsed.kind === "id") {
    try {
      return await guild.members.fetch(parsed.discordId);
    } catch {
      return null;
    }
  }

  return findGuildMemberByHandle(guild, parsed);
}

/**
 * Retrouve un destinataire sur **l'un** des serveurs BlueGenji — le premier qui
 * le connaît. Être membre de l'un suffit à être joignable.
 */
async function findHomeMember(
  guilds: Guild[],
  recipient: DirectMessageRecipient,
): Promise<GuildMember | null> {
  for (const guild of guilds) {
    const member = await findMemberIn(guild, recipient);
    if (member) { return member; }
  }
  return null;
}

/**
 * Envoie un message privé à chaque destinataire présent sur l'un des serveurs
 * BlueGenji.
 *
 * @param client Client Discord.
 * @param message Texte déjà rédigé et borné par l'app.
 * @param recipients Destinataires normalisés et dédoublonnés.
 * @returns Le bilan de la distribution.
 * @throws {HomeGuildUnavailableError} Aucun serveur BlueGenji joignable : rien n'est parti.
 */
export async function deliverDirectMessages(
  client: Client,
  message: string,
  recipients: DirectMessageRecipient[],
): Promise<DeliveryReport> {
  const report: DeliveryReport = { sent: 0, unresolved: [], failed: [] };

  const guilds = await fetchHomeGuilds(client);
  if (guilds.length === 0) {
    // Sans serveur de référence, l'appartenance est invérifiable : on n'écrit à
    // personne plutôt que d'écrire à n'importe qui — et on le **dit**, au lieu
    // de déclarer tout le monde absent du serveur.
    await sendLog(
      client,
      "notify/dm: aucun serveur BlueGenji joignable (GUILD_ID, sinon SERV_GENJI / SERV_RIVALS), aucun message envoyé.",
    );
    throw new HomeGuildUnavailableError();
  }

  for (const recipient of recipients) {
    const member = await findHomeMember(guilds, recipient);
    if (!member) {
      report.unresolved.push(recipient.label);
      continue;
    }

    try {
      await member.send(message);
      report.sent += 1;
    } catch {
      report.failed.push(recipient.label);
    }
  }

  return report;
}

/**
 * Alerte les arbitres : log de supervision **et** message privé à chaque membre
 * du rôle arbitre configuré, sur chaque serveur qui en a défini un.
 *
 * Les deux canaux, pas l'un ou l'autre : le log garde la trace consultable même
 * si aucun arbitre n'est joignable, et le DM sort le signalement du salon que
 * personne ne regarde en pleine soirée de tournoi.
 *
 * @param client Client Discord.
 * @param message Texte déjà rédigé et borné par l'app.
 * @returns Le bilan de la distribution aux arbitres.
 */
export async function alertReferees(client: Client, message: string): Promise<DeliveryReport> {
  const report: DeliveryReport = { sent: 0, unresolved: [], failed: [] };

  await sendLog(client, message);

  const bdd = await getBddInstance();
  const alreadyNotified = new Set<string>();

  for (const guild of client.guilds.cache.values()) {
    const roleId = await bdd.getRefereeRole(guild.id);
    if (!roleId) { continue; }

    let members: GuildMember[];
    try {
      const role: Role | null = await guild.roles.fetch(roleId);
      if (!role) {
        report.unresolved.push(`${guild.name}: rôle ${roleId} introuvable`);
        continue;
      }
      // Le cache des membres d'un rôle n'est peuplé que si la guilde entière a
      // été récupérée : on force la récupération plutôt que d'alerter un sous-
      // ensemble arbitraire des arbitres.
      await guild.members.fetch();
      members = [...role.members.values()];
    } catch {
      report.unresolved.push(`${guild.name}: membres du rôle illisibles`);
      continue;
    }

    // Borne dure, indépendante de ce qu'a choisi l'administrateur du serveur :
    // un rôle large transformerait chaque signalement en envoi de masse, que
    // Discord traite comme du spam.
    const humans = members.filter((member) => !member.user.bot);
    const { kept, skipped } = capRefereeTargets(humans);
    if (skipped > 0) {
      report.unresolved.push(`${guild.name}: ${skipped} membre(s) au-delà du plafond de ${MAX_REFEREE_DMS}`);
      await sendLog(
        client,
        `notify/referees: role arbitre de ${guild.name} trop large (${humans.length} membres), ${skipped} non prevenu(s).`,
      );
    }

    for (const member of kept) {
      if (alreadyNotified.has(member.id)) { continue; }
      alreadyNotified.add(member.id);
      try {
        await member.send(message);
        report.sent += 1;
      } catch {
        report.failed.push(member.user.username);
      }
    }
  }

  return report;
}

/**
 * Alerte la direction de l'association : log de supervision **et** message
 * privé au propriétaire (`OWNER_ID`) et au président (`PRESIDENT`).
 *
 * Sert aux signalements du site (contenu illicite, contestation) : le salon de
 * logs garde la trace, le message privé sort l'alerte du salon. Les deux
 * destinataires sont joints **directement** par leur identifiant, sans passer
 * par les serveurs BlueGenji : ce sont eux qui administrent le bot, le bot les
 * connaît déjà.
 *
 * @param client Client Discord.
 * @param message Texte déjà rédigé et borné par l'app.
 * @returns Le bilan de la distribution.
 */
export async function alertLeadership(client: Client, message: string): Promise<DeliveryReport> {
  const report: DeliveryReport = { sent: 0, unresolved: [], failed: [] };

  await sendLog(client, message);

  for (const id of leadershipIds(process.env)) {
    try {
      const user = await client.users.fetch(id);
      await user.send(message);
      report.sent += 1;
    } catch {
      report.failed.push(id);
    }
  }
  return report;
}
