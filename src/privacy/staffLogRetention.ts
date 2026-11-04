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
import { BAN_NOTICE_WITHDRAWAL_RETRY_DAYS, STAFF_LOG_RETENTION_DAYS } from "./retentionPeriods.js";
import {
  DISCORD_MISSING_ACCESS,
  DISCORD_MISSING_PERMISSIONS,
  DISCORD_UNKNOWN_CHANNEL,
  DISCORD_UNKNOWN_MESSAGE,
  DISCORD_UNKNOWN_USER,
  errorCode,
} from "../safe/errorGuards.js";
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

/**
 * Issue de l'effacement d'un message privé : effacé à l'instant (`deleted`),
 * déjà absent (`gone` : message ou compte disparu), à réessayer, ou refusé pour de bon.
 */
export type DirectMessageDeletion = "deleted" | "gone" | "retry" | "refused";

const GONE_CODES = new Set([DISCORD_UNKNOWN_MESSAGE, DISCORD_UNKNOWN_USER]);
const REFUSED_CODES = new Set([DISCORD_UNKNOWN_CHANNEL, DISCORD_MISSING_ACCESS, DISCORD_MISSING_PERMISSIONS]);

/**
 * Efface un message que le bot a remis en message privé.
 * @param client Client Discord.
 * @param idUser Destinataire du message.
 * @param messageId Identifiant du message.
 * @returns `deleted` ou `gone` si le message n'existe plus, `refused` si
 *   Discord le refuse pour de bon (conversation inconnue, accès refusé),
 *   `retry` sinon (réseau, Discord indisponible).
 */
export async function deleteDirectMessage(client: Client, idUser: string, messageId: string): Promise<DirectMessageDeletion> {
  try {
    const user = await client.users.fetch(idUser);
    const cached = user.dmChannel;
    try {
      await (cached ?? await user.createDM()).messages.delete(messageId);
    } catch (error) {
      // Conversation gardée en cache, que Discord ne connaît plus : rouverte une
      // fois avant de conclure au refus (pas une conversation ouverte à l'instant).
      if (!cached || errorCode(error) !== DISCORD_UNKNOWN_CHANNEL) {
        throw error;
      }
      await (await user.createDM(true)).messages.delete(messageId);
    }
    return "deleted";
  } catch (error) {
    const code = errorCode(error);
    if (typeof code === "number" && GONE_CODES.has(code)) {
      return "gone";
    }
    return typeof code === "number" && REFUSED_CODES.has(code) ? "refused" : "retry";
  }
}

/** Avis repris au plus par purge de nuit : chacun coûte d'un appel Discord (compte et conversation en cache) à quatre, sur la file que partage le relais. */
export const MAX_NOTICE_WITHDRAWALS_PER_RUN = 50;

/** Part du plafond garantie aux lignes échues ; celle que les plus récentes laissent leur revient aussi. */
export const MAX_EXPIRED_LAST_TRIES_PER_RUN = MAX_NOTICE_WITHDRAWALS_PER_RUN / 2;

/**
 * La ligne `Ban` d'une exclusion en cours oublie un avis qui ne sera jamais
 * effacé : l'avis du jour ne le remet pas en file, et le remplace.
 * @param idUser Exclu.
 * @param messageId Avis abandonné.
 */
async function forgetBanNotice(idUser: string, messageId: string): Promise<void> {
  const bdd = await getBddInstance();
  await bdd.write("UPDATE Ban SET id_notice_user = NULL WHERE id_user = ? AND id_notice_user = ?", [idUser, messageId]);
}

/** Issue d'un retrait d'avis : effacé, remis à la purge de nuit, refusé pour de bon, ou perdu de vue. */
export type NoticeWithdrawal = "gone" | "queued" | "refused" | "lost";

/**
 * Écrit l'issue d'un effacement : la ligne `Ban` oublie un avis effacé ou
 * jamais effaçable, la file garde ce qui reste à réessayer. La base est
 * ouverte dans chaque essai : indisponible (restauration), rien ne lève.
 * @param client Client Discord (alertes au staff).
 * @param idUser Exclu.
 * @param messageId Identifiant de l'avis.
 * @param deletion Issue de l'effacement.
 * @param now Instant du retrait (ms).
 * @returns `lost` si l'avis à réessayer n'a pu être gardé, `night` si la
 * purge de nuit annoncera le refus, `done` sinon.
 */
async function recordWithdrawal(
  client: Client, idUser: string, messageId: string, deletion: DirectMessageDeletion, now: number,
): Promise<"lost" | "night" | "done"> {
  const write = async (query: string, values: unknown[]): Promise<void> => {
    await (await getBddInstance()).write(query, values);
  };
  let keepQueued = deletion === "retry";
  if (!keepQueued) {
    try {
      await forgetBanNotice(idUser, messageId);
    } catch {
      if (deletion === "refused") {
        // Gardé en file : la purge de nuit, refusée de nouveau, refera l'oubli.
        await sendLog(client, "Ban notice refusal not recorded");
        keepQueued = true;
      } else {
        // Sans conséquence pour l'exclu (le message est parti) : un effacement
        // sera de nouveau tenté sur cet identifiant, qui répondra « déjà parti ».
        await sendLog(client, "Ban notice deletion not recorded");
      }
    }
  }
  if (!keepQueued) {
    try {
      await write("DELETE FROM BanNoticeWithdrawal WHERE id_user = ? AND id_message = ?", [idUser, messageId]);
    } catch {
      // Une ligne restée en file sera reprise cette nuit.
      await sendLog(client, "Ban notice withdrawal not cleared from the queue");
    }
    return "done";
  }
  try {
    await write("INSERT OR IGNORE INTO BanNoticeWithdrawal (id_user, id_message, queued_at) VALUES (?, ?, ?)", [idUser, messageId, now]);
  } catch {
    if (deletion === "retry") {
      await sendLog(client, "Ban notice could not be withdrawn");
      return "lost";
    }
    await sendLog(client, "Ban notice withdrawal not queued");
    return "done";
  }
  return deletion === "refused" ? "night" : "done";
}

/**
 * Retire un avis remis à l'exclu. S'il ne peut pas l'être tout de suite
 * (Discord indisponible), son identifiant est gardé pour la purge de nuit,
 * qui le réessaie pendant `BAN_NOTICE_WITHDRAWAL_RETRY_DAYS` jours — sinon,
 * rien ne permettrait plus de le retrouver. Effacé, il quitte la file s'il y
 * était (`/unban` l'y met avant de lever l'exclusion). Le staff est averti
 * d'un report ou d'un refus, sans nom ni identifiant.
 * @param client Client Discord.
 * @param idUser Exclu.
 * @param messageId Identifiant de l'avis.
 * @param now Instant du retrait (ms).
 * @returns L'issue du retrait.
 */
export async function withdrawBanNotice(client: Client, idUser: string, messageId: string, now: number = Date.now()): Promise<NoticeWithdrawal> {
  const deletion = await deleteDirectMessage(client, idUser, messageId);
  const recorded = await recordWithdrawal(client, idUser, messageId, deletion, now);
  if (recorded === "lost") {
    return "lost";
  }
  if (deletion === "deleted" || deletion === "gone") {
    return "gone";
  }
  if (deletion === "refused") {
    // Gardé pour la nuit, le refus est déjà dit (« refusal not recorded ») :
    // la purge l'annoncera de nouveau s'il se répète, une seule alerte chacun.
    if (recorded !== "night") {
      await sendLog(client, "Ban notice withdrawal refused by Discord");
    }
    return "refused";
  }
  await sendLog(client, "Ban notice withdrawal postponed to the nightly purge");
  return "queued";
}

/** Ligne de `BanNoticeWithdrawal` reprise par la purge de nuit. */
type PendingWithdrawal = { id_user: string; id_message: string };

/**
 * Un essai de la purge de nuit sur une ligne en file. Effacé, refusé, ou échu
 * et toujours là : la ligne `Ban` l'oublie et il quitte la file, annoncé au
 * staff s'il n'a pas pu être effacé. Une écriture en échec n'annonce rien : la
 * ligne reste, reprise la nuit suivante (ou, échue, par l'abandon d'un bloc).
 * @param client Client Discord connecté.
 * @param row Ligne essayée.
 * @param isExpired Dernier essai avant l'échéance.
 * @param run Bilan de la nuit, complété ici (première erreur gardée).
 * @returns `null` si la ligne est réglée (ou gardée pour la nuit suivante),
 * sinon l'issue de l'effacement dont l'écriture a échoué (la ligne reste en file).
 */
async function tryWithdrawal(
  client: Client, row: PendingWithdrawal, isExpired: boolean, run: { settled: number; failure: unknown },
): Promise<DirectMessageDeletion | null> {
  let deletion: DirectMessageDeletion = "retry";
  try {
    deletion = await deleteDirectMessage(client, row.id_user, row.id_message);
    if (deletion === "retry" && !isExpired) {
      return null;
    }
    // L'oubli d'abord : si la ligne de file restait, la nuit suivante le refait.
    await forgetBanNotice(row.id_user, row.id_message);
    const bdd = await getBddInstance();
    run.settled += await bdd.write("DELETE FROM BanNoticeWithdrawal WHERE id_user = ? AND id_message = ?", [row.id_user, row.id_message]);
    if (deletion === "refused") {
      await sendLog(client, "Ban notice withdrawal refused by Discord");
    } else if (deletion === "retry") {
      await sendLog(client, "Ban notice withdrawal abandoned after " + BAN_NOTICE_WITHDRAWAL_RETRY_DAYS + " days");
    }
    return null;
  } catch (error) {
    run.failure ??= error;
    return deletion;
  }
}

/**
 * Réessaie, chaque nuit, les avis d'exclusion qui n'ont pas pu être retirés.
 * Un avis effacé (ou déjà absent) quitte la table ; un avis refusé pour de
 * bon, ou toujours là à la dernière nuit avant `BAN_NOTICE_WITHDRAWAL_RETRY_DAYS`
 * jours, aussi, signalé au staff — et la ligne `Ban` encore en cours l'oublie,
 * pour que l'avis du jour ne le remette pas en file (comme un avis effacé :
 * la ligne `Ban` ne pointe jamais un message parti). Une ligne qui échoue
 * n'arrête pas les suivantes. Au plus `MAX_NOTICE_WITHDRAWALS_PER_RUN` avis
 * essayés par nuit : les plus récents, tirés au hasard, en ont la moitié au
 * plus — des avis durablement en échec ne les bloquent pas —, les échues le
 * reste, pour un dernier essai (les plus anciennes en tête ; une ligne datée
 * du futur, horloge reculée, repart de maintenant). Les échues passent d'abord, puis celles au-delà sont abandonnées
 * d'un bloc, sans appel, avant les récentes : une nuit interrompue ne laisse
 * aucune ligne passer l'échéance annoncée.
 * @param client Client Discord connecté.
 * @param now Instant de référence (ms).
 * @returns Le nombre d'avis retirés de la table (effacés ou abandonnés).
 * @throws La première erreur de base rencontrée, une fois toutes les lignes essayées.
 */
export async function retryBanNoticeWithdrawals(client: Client, now: number = Date.now()): Promise<number> {
  const bdd = await getBddInstance();
  const day = 24 * 60 * 60 * 1000;
  // La purge passe une fois par nuit : une ligne part à la dernière avant
  // l'échéance. Un instant dans le futur (horloge reculée) ne la garde pas indéfiniment.
  const deadline = now - (BAN_NOTICE_WITHDRAWAL_RETRY_DAYS - 1) * day;
  // Horloge reculée : une ligne datée du futur repart de maintenant, pour ses
  // 30 jours d'essais — ni gardée indéfiniment, ni abandonnée sans essai.
  await bdd.write("UPDATE BanNoticeWithdrawal SET queued_at = ? WHERE queued_at > ?", [now, now + day]);
  const candidates = await bdd.raw<PendingWithdrawal>(
    "SELECT id_user, id_message FROM BanNoticeWithdrawal WHERE queued_at <= ? ORDER BY queued_at LIMIT ?",
    [deadline, MAX_NOTICE_WITHDRAWALS_PER_RUN],
  );
  const pending = await bdd.raw<PendingWithdrawal>(
    "SELECT id_user, id_message FROM BanNoticeWithdrawal WHERE queued_at > ? ORDER BY RANDOM() LIMIT ?",
    [deadline, MAX_NOTICE_WITHDRAWALS_PER_RUN - Math.min(MAX_EXPIRED_LAST_TRIES_PER_RUN, candidates.length)],
  );
  const lastTries = candidates.slice(0, MAX_NOTICE_WITHDRAWALS_PER_RUN - pending.length);
  const run = { settled: 0, failure: null as unknown };
  // Derniers essais dont l'écriture a échoué : le bloc les emporte, selon leur issue.
  const unsettled = { erased: 0, refused: 0, retry: 0 };
  for (const row of lastTries) {
    const outcome = await tryWithdrawal(client, row, true, run);
    if (outcome === "deleted" || outcome === "gone") {
      unsettled.erased += 1;
    } else if (outcome !== null) {
      unsettled[outcome] += 1;
    }
  }
  const anyUnsettled = unsettled.erased + unsettled.refused + unsettled.retry > 0;
  // Rien au-delà : la table n'a plus d'échues, inutile de la parcourir.
  if (candidates.length === MAX_NOTICE_WITHDRAWALS_PER_RUN || candidates.length > lastTries.length || anyUnsettled) {
    try {
      // Les échues restées après leur dernier essai partent d'un bloc, oubliées d'abord.
      await bdd.write("UPDATE Ban SET id_notice_user = NULL WHERE EXISTS (SELECT 1 FROM BanNoticeWithdrawal w "
        + "WHERE w.id_user = Ban.id_user AND w.id_message = Ban.id_notice_user AND w.queued_at <= ?)", [deadline]);
      const dropped = await bdd.write("DELETE FROM BanNoticeWithdrawal WHERE queued_at <= ?", [deadline]);
      run.settled += dropped;
      // Une alerte par issue pour le bloc ; un avis effacé n'en demande aucune.
      if (unsettled.refused > 0) {
        await sendLog(client, unsettled.refused + " ban notice withdrawals refused by Discord");
      }
      const abandoned = Math.max(0, dropped - unsettled.erased - unsettled.refused);
      if (abandoned > 0) {
        await sendLog(client, abandoned + " ban notice withdrawals abandoned after " + BAN_NOTICE_WITHDRAWAL_RETRY_DAYS + " days");
      }
    } catch (error) {
      run.failure ??= error;
    }
  }
  for (const row of pending) {
    await tryWithdrawal(client, row, false, run);
  }
  const { settled, failure } = run;
  if (failure !== null) {
    throw failure;
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
    // Seul un effacement réel compte : un `OWNER_ID` erroné ne passe pas pour un succès.
    attempts.push(deleteDirectMessage(client, process.env.OWNER_ID, ban.id_reason_owner).then((outcome) => outcome === "deleted"));
  }
  if (ban.id_notice_user) {
    attempts.push(withdrawBanNotice(client, ban.id_user, ban.id_notice_user).then((outcome) => outcome === "gone"));
  }
  return (await Promise.all(attempts)).filter(Boolean).length;
}
