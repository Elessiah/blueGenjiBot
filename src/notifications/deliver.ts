import type { Client, Guild, GuildMember, Role } from "discord.js";
import { getBddInstance } from "@/bdd/Bdd.js";
import { sendLog } from "@/safe/sendLog.js";
import { findGuildMemberByHandle, parseDiscordHandle } from "@/notifications/resolveHandle.js";
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
 * Serveur BlueGenji, seule population que le bot démarche.
 *
 * Un rappel de match ne s'envoie qu'à un joueur du serveur : c'est la règle
 * posée côté site (« ils devront être sur le serveur Discord »), et elle borne
 * aussi le risque — sans elle, un tag mal saisi pourrait faire écrire le bot à
 * un inconnu croisé sur un serveur partenaire.
 *
 * @param client Client Discord.
 * @returns La guilde, ou `null` si `GUILD_ID` n'est pas configuré ou injoignable.
 */
async function fetchHomeGuild(client: Client): Promise<Guild | null> {
  const guildId = process.env.GUILD_ID?.trim();
  if (!guildId) { return null; }
  try {
    return await client.guilds.fetch(guildId);
  } catch {
    return null;
  }
}

/**
 * Retrouve un destinataire **parmi les membres du serveur BlueGenji**.
 *
 * L'ID prime quand l'app le connaît (compte lié par code Discord) : il évite la
 * recherche par tag. Dans les deux cas, la réponse vaut appartenance — un
 * `null` signifie « pas sur le serveur », donc pas d'envoi.
 */
async function findHomeMember(
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
 * Envoie un message privé à chaque destinataire présent sur le serveur BlueGenji.
 *
 * @param client Client Discord.
 * @param message Texte déjà rédigé et borné par l'app.
 * @param recipients Destinataires normalisés et dédoublonnés.
 * @returns Le bilan de la distribution.
 */
export async function deliverDirectMessages(
  client: Client,
  message: string,
  recipients: DirectMessageRecipient[],
): Promise<DeliveryReport> {
  const report: DeliveryReport = { sent: 0, unresolved: [], failed: [] };

  const guild = await fetchHomeGuild(client);
  if (!guild) {
    // Sans serveur de référence, l'appartenance est invérifiable : on n'écrit à
    // personne plutôt que d'écrire à n'importe qui.
    report.unresolved.push(...recipients.map((r) => r.label));
    await sendLog(client, "notify/dm: GUILD_ID absent ou injoignable, aucun message envoyé.");
    return report;
  }

  for (const recipient of recipients) {
    const member = await findHomeMember(guild, recipient);
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

    for (const member of members) {
      if (member.user.bot || alreadyNotified.has(member.id)) { continue; }
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
