/**
 * Conservation du journal privé du staff : le salon `INFO_SERV` et les
 * messages privés que `sendLog` envoie au propriétaire (`OWNER_ID`).
 *
 * Avis d'exclusion, motifs libres (qui peuvent citer un pseudo), erreurs et
 * journal du site s'y accumulaient sans limite. Deux règles :
 *
 * - **chaque nuit**, les messages **du bot** de plus de
 *   `STAFF_LOG_RETENTION_DAYS` sont supprimés (`purgeStaffLogs`) — sauf ceux
 *   qui décrivent une exclusion **en cours** : son motif est relu pour
 *   prévenir l'exclu (`checkBan`), il vit autant qu'elle ;
 * - **à la levée d'une exclusion** (`/unban`), ses messages sont supprimés
 *   sur-le-champ (`deleteBanMessages`), quel que soit leur âge — avec l'avis
 *   remis en message privé à l'exclu.
 *
 * Seuls les messages écrits par le bot sont touchés : ce que le staff écrit
 * lui-même dans le salon n'est pas un journal du bot.
 */

import type { Client, DMChannel, Message, TextChannel } from "discord.js";

import { getBddInstance } from "../bdd/Bdd.js";
import type { Ban } from "../bdd/types.js";
import { STAFF_LOG_RETENTION_DAYS } from "./retentionPeriods.js";
import { DISCORD_UNKNOWN_MESSAGE, DISCORD_UNKNOWN_USER, errorCode } from "../safe/errorGuards.js";
import { sendLog } from "../safe/sendLog.js";

/** Ce que la purge lit d'un message : de quoi décider, rien de son contenu. */
export interface LogMessageLike {
  id: string;
  authorId: string;
  createdTimestamp: number;
  delete: () => Promise<unknown>;
}

/** Un salon parcouru du plus ancien au plus récent, par pages. */
export interface LogChannelLike {
  /**
   * Messages qui suivent immédiatement `after` (au plus une page).
   * @param after Identifiant à partir duquel lire ; `"0"` pour le début du salon.
   */
  fetchAfter: (after: string) => Promise<LogMessageLike[]>;
}

/** Plafond de suppressions par passe : Discord limite le débit, la nuit suivante reprend. */
export const MAX_LOG_DELETIONS_PER_RUN = 500;
/** Plafond de pages lues par salon et par passe (100 messages par page). */
export const MAX_LOG_PAGES_PER_RUN = 200;

/**
 * Identifiants de messages du journal qu'une exclusion désigne.
 * @param ban Ligne `Ban`.
 * @returns Les identifiants renseignés (salon et messages privés confondus).
 */
export function banMessageIds(ban: Ban): string[] {
  return [ban.id_reason, ban.id_reason_owner, ban.id_notice_admin].filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
}

/**
 * Choisit, dans une page, les messages à supprimer.
 * @param messages Page de messages.
 * @param cutoff Instant (ms) avant lequel un message est périmé.
 * @param botId Identifiant du bot : seuls ses messages sont visés.
 * @param protectedIds Messages d'une exclusion en cours, jamais supprimés.
 * @returns Les messages périmés à supprimer.
 */
export function selectExpiredLogMessages(
  messages: LogMessageLike[],
  cutoff: number,
  botId: string,
  protectedIds: ReadonlySet<string>,
): LogMessageLike[] {
  return messages.filter(
    (message) =>
      message.authorId === botId && message.createdTimestamp < cutoff && !protectedIds.has(message.id),
  );
}

/** Le plus grand de deux identifiants Discord (nombres sur 64 bits écrits en décimal). */
function maxSnowflake(a: string, b: string): string {
  return BigInt(a) >= BigInt(b) ? a : b;
}

/** Résultat d'une passe sur un salon. */
export interface LogPurgeResult {
  /** Messages supprimés. */
  deleted: number;
  /**
   * Où reprendre à la passe suivante : `"0"` quand le salon a été parcouru
   * jusqu'aux messages récents, sinon le dernier identifiant entièrement
   * traité (plafond de pages ou de suppressions atteint).
   */
  resumeAfter: string;
}

/**
 * Parcourt un salon du plus ancien au plus récent et supprime les messages
 * périmés.
 *
 * S'arrête au premier message récent (la suite l'est aussi), à une page vide,
 * ou à l'un des plafonds — et rend alors l'endroit où reprendre : sans lui, un
 * début de salon encombré de messages qu'on ne supprime pas (écrits par le
 * staff, ou d'une exclusion en cours) serait relu chaque nuit sans que la purge
 * n'atteigne jamais la suite. Une suppression qui échoue (message déjà effacé)
 * n'interrompt pas la passe.
 * @param channel Salon à parcourir.
 * @param cutoff Instant (ms) avant lequel un message est périmé.
 * @param botId Identifiant du bot.
 * @param protectedIds Messages à ne jamais supprimer.
 * @param budget Suppressions encore permises pendant cette passe.
 * @param start Identifiant après lequel commencer (`"0"` : début du salon).
 * @returns Le nombre de messages supprimés et le point de reprise.
 */
export async function purgeLogChannel(
  channel: LogChannelLike,
  cutoff: number,
  botId: string,
  protectedIds: ReadonlySet<string>,
  budget: number = MAX_LOG_DELETIONS_PER_RUN,
  start: string = "0",
): Promise<LogPurgeResult> {
  let cursor = start;
  let deleted = 0;
  for (let page = 0; page < MAX_LOG_PAGES_PER_RUN && deleted < budget; page++) {
    const pageStart = cursor;
    const messages = await channel.fetchAfter(cursor);
    if (messages.length === 0) {
      return { deleted, resumeAfter: "0" };
    }
    for (const message of selectExpiredLogMessages(messages, cutoff, botId, protectedIds)) {
      if (deleted >= budget) {
        // Page entamée : la reprendre en entier la prochaine fois.
        return { deleted, resumeAfter: pageStart };
      }
      const ok = await message.delete().then(
        () => true,
        () => false,
      );
      if (ok) {
        deleted++;
      }
    }
    if (messages.some((message) => message.createdTimestamp >= cutoff)) {
      return { deleted, resumeAfter: "0" };
    }
    cursor = messages.reduce((max, message) => maxSnowflake(max, message.id), cursor);
  }
  return { deleted, resumeAfter: cursor };
}

/**
 * Points de reprise par salon, gardés le temps du processus : un redémarrage
 * repart du début, ce qui ne coûte qu'une relecture.
 */
const resumePoints: { channel: string; dm: string } = { channel: "0", dm: "0" };

/**
 * Adapte un salon discord.js (texte ou message privé) à `LogChannelLike`.
 * @param channel Salon discord.js.
 * @returns L'adaptateur.
 */
function asLogChannel(channel: TextChannel | DMChannel): LogChannelLike {
  return {
    fetchAfter: async (after) => {
      const page = await channel.messages.fetch({ after, limit: 100 });
      return [...page.values()].map((message: Message) => ({
        id: message.id,
        authorId: message.author.id,
        createdTimestamp: message.createdTimestamp,
        delete: () => message.delete(),
      }));
    },
  };
}

/**
 * Identifiants des messages qu'une exclusion en cours protège.
 *
 * Lève si la table ne peut pas être lue : purger sans savoir quelles
 * exclusions sont en cours effacerait leurs motifs.
 * @returns L'ensemble des identifiants protégés.
 */
async function activeBanMessageIds(): Promise<Set<string>> {
  const bdd = await getBddInstance();
  // `get` lève sur une base fermée (restauration en cours) : la purge n'est
  // alors pas jouée, jamais jouée sans protection.
  const bans = (await bdd.get("Ban", ["*"])) as Ban[];
  return new Set(bans.flatMap(banMessageIds));
}

/**
 * Supprime les messages du bot de plus de `STAFF_LOG_RETENTION_DAYS` dans le
 * salon du staff et dans les messages privés au propriétaire.
 * @param client Client Discord connecté.
 * @param now Instant de référence, en millisecondes.
 * @returns Le nombre de messages supprimés, ou `null` si la purge n'a pas été jouée (client pas prêt).
 * @throws Si la liste des exclusions en cours ne peut pas être lue.
 */
export async function purgeStaffLogs(client: Client, now: number = Date.now()): Promise<number | null> {
  if (!client.isReady()) {
    return null;
  }
  const botId = client.user.id;
  const protectedIds = await activeBanMessageIds();
  const cutoff = now - STAFF_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let deleted = 0;

  // Deux salons indépendants : l'un injoignable (salon effacé, accès retiré)
  // ne prive pas l'autre de sa purge. La première erreur remonte ensuite.
  let failure: unknown = null;
  if (process.env.INFO_SERV) {
    try {
      const channel = (await client.channels.fetch(process.env.INFO_SERV)) as TextChannel | null;
      if (channel && "messages" in channel) {
        const result = await purgeLogChannel(
          asLogChannel(channel),
          cutoff,
          botId,
          protectedIds,
          MAX_LOG_DELETIONS_PER_RUN,
          resumePoints.channel,
        );
        deleted += result.deleted;
        resumePoints.channel = result.resumeAfter;
      }
    } catch (error) {
      failure = error;
    }
  }
  if (process.env.OWNER_ID) {
    try {
      const owner = await client.users.fetch(process.env.OWNER_ID);
      const dm = await owner.createDM();
      const result = await purgeLogChannel(
        asLogChannel(dm),
        cutoff,
        botId,
        protectedIds,
        Math.max(0, MAX_LOG_DELETIONS_PER_RUN - deleted),
        resumePoints.dm,
      );
      deleted += result.deleted;
      resumePoints.dm = result.resumeAfter;
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure !== null) {
    throw failure;
  }
  return deleted;
}

/** Jours pendant lesquels un avis d'exclusion qui n'a pas pu être retiré est réessayé, chaque nuit. */
export const BAN_NOTICE_WITHDRAWAL_RETRY_DAYS = 30;

/**
 * Efface un avis remis à l'exclu dans sa conversation privée.
 * @param client Client Discord.
 * @param idUser Exclu.
 * @param messageId Identifiant de l'avis.
 * @returns `true` si l'avis n'existe plus (effacé, déjà absent, ou compte disparu).
 */
export async function deleteBanNotice(client: Client, idUser: string, messageId: string): Promise<boolean> {
  try {
    const user = await client.users.fetch(idUser);
    const dm = user.dmChannel ?? await user.createDM();
    await dm.messages.delete(messageId);
    return true;
  } catch (error) {
    const code = errorCode(error);
    return code === DISCORD_UNKNOWN_MESSAGE || code === DISCORD_UNKNOWN_USER;
  }
}

/** Issue d'un retrait d'avis : effacé, remis à la purge de nuit, ou perdu de vue. */
export type NoticeWithdrawal = "gone" | "queued" | "lost";

/**
 * Retire un avis remis à l'exclu. S'il ne peut pas l'être tout de suite
 * (Discord indisponible), son identifiant est gardé pour la purge de nuit,
 * qui le réessaie pendant `BAN_NOTICE_WITHDRAWAL_RETRY_DAYS` jours — sinon,
 * rien ne permettrait plus de le retrouver. Le staff en est averti, sans nom
 * ni identifiant.
 * @param client Client Discord.
 * @param idUser Exclu.
 * @param messageId Identifiant de l'avis.
 * @param now Instant du retrait (ms).
 * @returns L'issue du retrait.
 */
export async function withdrawBanNotice(client: Client, idUser: string, messageId: string, now: number = Date.now()): Promise<NoticeWithdrawal> {
  if (await deleteBanNotice(client, idUser, messageId)) {
    return "gone";
  }
  try {
    const bdd = await getBddInstance();
    await bdd.write(
      "INSERT OR IGNORE INTO BanNoticeWithdrawal (id_user, id_message, queued_at) VALUES (?, ?, ?)",
      [idUser, messageId, now],
    );
  } catch {
    await sendLog(client, "Ban notice could not be withdrawn");
    return "lost";
  }
  await sendLog(client, "Ban notice withdrawal postponed to the nightly purge");
  return "queued";
}

/**
 * Réessaie, chaque nuit, les avis d'exclusion qui n'ont pas pu être retirés.
 * Un avis effacé (ou déjà absent) quitte la table ; un avis toujours là au
 * bout de `BAN_NOTICE_WITHDRAWAL_RETRY_DAYS` jours aussi, signalé au staff.
 * @param client Client Discord connecté.
 * @param now Instant de référence (ms).
 * @returns Le nombre d'avis retirés de la table (effacés ou abandonnés).
 */
export async function retryBanNoticeWithdrawals(client: Client, now: number = Date.now()): Promise<number> {
  const bdd = await getBddInstance();
  const pending = await bdd.raw<{ id_user: string; id_message: string; queued_at: number }>(
    "SELECT id_user, id_message, queued_at FROM BanNoticeWithdrawal ORDER BY queued_at",
  );
  let settled = 0;
  for (const row of pending) {
    const gone = await deleteBanNotice(client, row.id_user, row.id_message);
    const expired = now - Number(row.queued_at) >= BAN_NOTICE_WITHDRAWAL_RETRY_DAYS * 24 * 60 * 60 * 1000;
    if (!gone && !expired) {
      continue;
    }
    await bdd.write("DELETE FROM BanNoticeWithdrawal WHERE id_user = ? AND id_message = ?", [row.id_user, row.id_message]);
    if (!gone) {
      await sendLog(client, "Ban notice withdrawal abandoned after " + BAN_NOTICE_WITHDRAWAL_RETRY_DAYS + " days");
    }
    settled += 1;
  }
  return settled;
}

/**
 * Supprime les messages du journal qui décrivent une exclusion levée, et le
 * dernier avis remis en message privé à l'exclu (`checkBan`).
 *
 * Au mieux : un message déjà effacé (ménage du staff, purge d'un an) ou un
 * salon injoignable n'empêche pas les autres de partir. Ce qui resterait est
 * repris par la purge de nuit, la ligne `Ban` ne le protégeant plus ; l'avis
 * à l'exclu, qu'elle ne parcourt pas, par `withdrawBanNotice`.
 * @param client Client Discord.
 * @param ban Ligne `Ban` de l'exclusion levée (rendue par sa suppression).
 * @returns Le nombre de messages supprimés.
 */
export async function deleteBanMessages(client: Client, ban: Ban): Promise<number> {
  const attempts: Promise<boolean>[] = [];
  const settle = (task: Promise<unknown>): Promise<boolean> => task.then(() => true, () => false);

  const channelIds = [ban.id_reason, ban.id_notice_admin].filter((id): id is string => !!id);
  if (process.env.INFO_SERV && channelIds.length > 0) {
    const channel = await client.channels.fetch(process.env.INFO_SERV).catch(() => null);
    if (channel && "messages" in channel) {
      const text = channel as TextChannel;
      attempts.push(...channelIds.map((id) => settle(text.messages.delete(id))));
    }
  }
  // Messages privés à effacer, en même temps : celui du propriétaire (le motif)
  // et l'avis remis à l'exclu par `checkBan`.
  if (process.env.OWNER_ID && ban.id_reason_owner) {
    const messageId = ban.id_reason_owner;
    attempts.push(settle(client.users
      .fetch(process.env.OWNER_ID)
      .then((user) => user.dmChannel ?? user.createDM())
      .then((dm) => dm.messages.delete(messageId))));
  }
  if (ban.id_notice_user) {
    attempts.push(withdrawBanNotice(client, ban.id_user, ban.id_notice_user).then((outcome) => outcome === "gone"));
  }
  return (await Promise.all(attempts)).filter(Boolean).length;
}
