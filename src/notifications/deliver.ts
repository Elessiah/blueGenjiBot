import type { Client, GuildMember, Role } from "discord.js";
import { getBddInstance } from "@/bdd/Bdd.js";
import { sendLog } from "@/safe/sendLog.js";
import { resolveDiscordHandle } from "@/notifications/resolveHandle.js";
import type { DirectMessageRecipient } from "@/notifications/notifications.js";

/**
 * Distribution effective des messages poussés par l'app web.
 *
 * Séparé du module pur `notifications.ts` : ici seulement les effets — Discord,
 * la base, le canal de logs. Rien n'y lève : un DM refusé (compte fermé aux
 * messages privés, joueur absent du serveur) est un **résultat**, pas une
 * panne — l'app doit pouvoir dire au staff qui n'a pas été joint.
 */

/** Bilan d'une distribution de messages privés. */
export interface DeliveryReport {
  /** Messages effectivement remis. */
  sent: number;
  /** Destinataires dont le tag n'a été trouvé sur aucun serveur du bot. */
  unresolved: string[];
  /** Destinataires trouvés mais injoignables (DM fermés, compte supprimé). */
  failed: string[];
}

/**
 * Envoie un message privé à chaque destinataire.
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

  for (const recipient of recipients) {
    let discordId: string | null = recipient.discordId;
    if (!discordId && recipient.handle) {
      const resolved = await resolveDiscordHandle(client, recipient.handle);
      discordId = resolved?.discordId ?? null;
    }

    if (!discordId) {
      report.unresolved.push(recipient.label);
      continue;
    }

    try {
      const user = await client.users.fetch(discordId);
      await user.send(message);
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
