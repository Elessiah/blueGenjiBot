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
 *   sur-le-champ (`deleteBanMessages`), quel que soit leur âge.
 *
 * Seuls les messages écrits par le bot sont touchés : ce que le staff écrit
 * lui-même dans le salon n'est pas un journal du bot.
 */

import type { Client, DMChannel, Message, TextChannel } from "discord.js";

import { getBddInstance } from "@/bdd/Bdd.js";
import type { Ban } from "@/bdd/types.js";
import { STAFF_LOG_RETENTION_DAYS } from "@/privacy/retentionPeriods.js";

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
  return [ban.id_reason, ban.id_reason_owner, ban.id_notice_admin, ban.id_notice_owner].filter(
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

/**
 * Parcourt un salon depuis son début et supprime les messages périmés.
 *
 * S'arrête au premier message récent (la suite l'est aussi), à une page vide,
 * ou à l'un des plafonds. Une suppression qui échoue (message déjà effacé)
 * n'interrompt pas la passe.
 * @param channel Salon à parcourir.
 * @param cutoff Instant (ms) avant lequel un message est périmé.
 * @param botId Identifiant du bot.
 * @param protectedIds Messages à ne jamais supprimer.
 * @param budget Suppressions encore permises pendant cette passe.
 * @returns Le nombre de messages supprimés.
 */
export async function purgeLogChannel(
  channel: LogChannelLike,
  cutoff: number,
  botId: string,
  protectedIds: ReadonlySet<string>,
  budget: number = MAX_LOG_DELETIONS_PER_RUN,
): Promise<number> {
  let cursor = "0";
  let deleted = 0;
  for (let page = 0; page < MAX_LOG_PAGES_PER_RUN && deleted < budget; page++) {
    const messages = await channel.fetchAfter(cursor);
    if (messages.length === 0) {
      break;
    }
    for (const message of selectExpiredLogMessages(messages, cutoff, botId, protectedIds)) {
      if (deleted >= budget) {
        break;
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
      break;
    }
    cursor = messages.reduce((max, message) => maxSnowflake(max, message.id), cursor);
  }
  return deleted;
}

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

  if (process.env.INFO_SERV) {
    const channel = (await client.channels.fetch(process.env.INFO_SERV)) as TextChannel | null;
    if (channel && "messages" in channel) {
      deleted += await purgeLogChannel(asLogChannel(channel), cutoff, botId, protectedIds);
    }
  }
  if (process.env.OWNER_ID) {
    const owner = await client.users.fetch(process.env.OWNER_ID);
    const dm = await owner.createDM();
    deleted += await purgeLogChannel(
      asLogChannel(dm),
      cutoff,
      botId,
      protectedIds,
      Math.max(0, MAX_LOG_DELETIONS_PER_RUN - deleted),
    );
  }
  return deleted;
}

/**
 * Supprime les messages du journal qui décrivent une exclusion levée.
 *
 * Au mieux : un message déjà effacé (ménage du staff, purge d'un an) ou un
 * salon injoignable n'empêche pas les autres de partir. Ce qui resterait est
 * repris par la purge de nuit, la ligne `Ban` ne le protégeant plus.
 * @param client Client Discord.
 * @param ban Ligne `Ban` de l'exclusion levée (relue avant sa suppression).
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
  const dmIds = [ban.id_reason_owner, ban.id_notice_owner].filter((id): id is string => !!id);
  if (process.env.OWNER_ID && dmIds.length > 0) {
    const dm = await client.users
      .fetch(process.env.OWNER_ID)
      .then((owner) => owner.createDM())
      .catch(() => null);
    if (dm) {
      attempts.push(...dmIds.map((id) => settle(dm.messages.delete(id))));
    }
  }
  return (await Promise.all(attempts)).filter(Boolean).length;
}
