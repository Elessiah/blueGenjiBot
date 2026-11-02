/**
 * Salons vocaux d'équipe d'un match (MATCH-VOICE).
 *
 * Le site demande, un quart d'heure avant un match, un salon vocal par équipe
 * dans la catégorie `VOICE_CATEGORY_ID` ; il en lit l'occupation (un nombre,
 * jamais qui) pour autoriser le lancement, puis le rend une fois le score
 * confirmé. Le bot crée, compte et supprime ; il ne décide de rien.
 *
 * Règles tenues ici :
 * - **idempotence** : une même clé (`match:<id>:team:<id>`) rend toujours le
 *   même salon, recréé s'il a été supprimé à la main ;
 * - **seul un salon suivi** (table `MatchVoiceChannel`) peut être compté ou
 *   supprimé : un identifiant quelconque envoyé par le site n'y donne accès à
 *   rien ;
 * - **suppression** : à la libération si le salon est vide, sinon dès qu'il se
 *   vide (`voiceStateUpdate`, sans scrutation) ; balayage au démarrage et toutes
 *   les 30 min (libéré et vide, libéré depuis plus de 24 h, jamais libéré
 *   depuis plus de 48 h) ;
 * - **vie privée** : aucun membre, identifiant de membre ni pseudo n'est lu
 *   au-delà du compte, stocké ou journalisé.
 */

import { ChannelType, type Client, type VoiceState } from "discord.js";
import { getBddInstance } from "../bdd/Bdd.js";
import { discordJsonCode } from "../safe/errorGuards.js";
import { sendAlert, sendLog } from "../safe/sendLog.js";

/** Catégorie des salons vocaux de match sur le serveur BlueGenji, quand `VOICE_CATEGORY_ID` n'est pas posé. */
export const DEFAULT_VOICE_CATEGORY_ID = "676735851119640577";

/** Places d'un salon vocal d'équipe : cinq joueurs. */
export const VOICE_USER_LIMIT = 5;

/** Longueur maximale d'un nom de salon Discord. */
export const MAX_VOICE_NAME_LENGTH = 100;

/** Longueur maximale du nom reçu, avant nettoyage : au-delà, la demande est refusée. */
const MAX_RAW_NAME_LENGTH = 200;

/** Nom retenu quand le nom d'équipe ne garde aucun caractère affichable. */
export const FALLBACK_VOICE_NAME = "Salon d'équipe";

/** Un salon libéré mais occupé est supprimé quand même après ce délai. */
export const RELEASED_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Un salon jamais libéré (le site n'a plus répondu) est supprimé après ce délai. */
export const UNRELEASED_MAX_AGE_MS = 48 * 60 * 60 * 1000;

/** Expression cron du balayage : toutes les 30 minutes. */
export const VOICE_SWEEP_CRON = "*/30 * * * *";

/** Un salon suivi que le bot ne voit plus est oublié après ce délai (le double du plafond de 48 h). */
const ABANDONED_MAX_AGE_MS = 2 * UNRELEASED_MAX_AGE_MS;

/** Délai entre deux alertes « permission manquante ». */
const PERMISSION_ALERT_COOLDOWN_MS = 60 * 60 * 1000;

/** Codes Discord d'un salon inconnu (supprimé) et d'un accès refusé. */
const UNKNOWN_CHANNEL = 10003;
const MISSING_ACCESS = 50001;
const MISSING_PERMISSIONS = 50013;

/** Motif d'une clé d'idempotence acceptée. */
const VOICE_KEY_PATTERN = /^[A-Za-z0-9:_-]{1,100}$/;

/** Motif d'un identifiant Discord. */
const SNOWFLAKE_PATTERN = /^\d{17,20}$/;

/** Raison inscrite au journal d'audit Discord à chaque suppression. */
const DELETE_REASON = "Salon vocal de match terminé";

/** Code d'erreur rendu au site. */
export type VoiceErrorCode =
  | "VOICE_CATEGORY_UNAVAILABLE"
  | "VOICE_MISSING_PERMISSIONS"
  | "VOICE_DISCORD_ERROR"
  | "VOICE_CHANNEL_NOT_TRACKED"
  | "VOICE_CHANNEL_NOT_FOUND"
  | "VOICE_STORAGE_ERROR";

/** Statut HTTP de chaque code. */
const STATUS_BY_CODE: Readonly<Record<VoiceErrorCode, number>> = {
  VOICE_CATEGORY_UNAVAILABLE: 503,
  VOICE_MISSING_PERMISSIONS: 503,
  VOICE_DISCORD_ERROR: 502,
  VOICE_CHANNEL_NOT_TRACKED: 404,
  VOICE_CHANNEL_NOT_FOUND: 404,
  VOICE_STORAGE_ERROR: 500,
};

/** Échec d'une opération sur un salon vocal, porteur du code rendu au site. */
export class VoiceChannelError extends Error {
  readonly code: VoiceErrorCode;
  readonly status: number;

  /**
   * @param code Code rendu au site.
   * @param detail Détail technique, pour le journal seulement.
   */
  constructor(code: VoiceErrorCode, detail: string = code) {
    super(detail);
    this.name = "VoiceChannelError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
  }
}

/** Ligne de `MatchVoiceChannel`. */
type TrackedRow = { channel_id: string; voice_key: string; created_at: number; released_at: number | null };

/** Ce que le bot lit d'un salon vocal suivi : son effectif et sa suppression. */
type VoiceHandle = { id: string; members: { size: number }; delete(reason?: string): Promise<unknown> };

/** Bilan d'un balayage. */
export type SweepReport = { deleted: number; untracked: number; kept: number; failed: number };

/** Salons suivis et libérés : ceux qu'un départ peut faire supprimer. Rechargé à chaque balayage. */
const releasedIds = new Set<string>();

/** Créations en cours par clé : deux demandes simultanées ne créent qu'un salon. */
const pendingByKey = new Map<string, Promise<unknown>>();

let lastPermissionAlertAt = Number.NEGATIVE_INFINITY;

/** Remet à zéro l'état du module (alerte limitée, cache des libérés) ; pour les tests. */
export function resetVoiceState(): void {
  lastPermissionAlertAt = Number.NEGATIVE_INFINITY;
  releasedIds.clear();
  pendingByKey.clear();
}

/**
 * Catégorie des salons vocaux : `VOICE_CATEGORY_ID`, sinon la catégorie
 * BlueGenji. Une valeur qui n'est pas un identifiant Discord est ignorée.
 * @returns L'identifiant de la catégorie.
 */
export function voiceCategoryId(): string {
  const configured = process.env.VOICE_CATEGORY_ID?.trim();
  return configured && SNOWFLAKE_PATTERN.test(configured) ? configured : DEFAULT_VOICE_CATEGORY_ID;
}

/**
 * Valide la clé d'idempotence fournie par le site.
 * @param raw Valeur brute du corps.
 * @returns La clé, ou `null` si elle est absente ou hors du motif (lettres, chiffres, `:`, `_`, `-`, 100 caractères au plus).
 */
export function parseVoiceKey(raw: unknown): string | null {
  return typeof raw === "string" && VOICE_KEY_PATTERN.test(raw) ? raw : null;
}

/**
 * Valide un identifiant de salon passé dans le chemin.
 * @param raw Valeur brute.
 * @returns L'identifiant, ou `null`.
 */
export function parseChannelId(raw: unknown): string | null {
  return typeof raw === "string" && SNOWFLAKE_PATTERN.test(raw) ? raw : null;
}

/**
 * Nom du salon tiré du nom d'équipe envoyé par le site.
 *
 * Caractères de contrôle remplacés par une espace, caractères invisibles et de
 * sens d'écriture (espace sans chasse, marques et forçages bidirectionnels,
 * BOM) retirés — le liant `ZWJ` des emoji composés est gardé —, ainsi que ceux qui servent la
 * syntaxe des mentions et du Markdown (`@ < > \` * _ ~ | \\ #`) : un nom
 * d'équipe saisi librement ne doit rien appeler ni rien mettre en forme s'il
 * est repris ailleurs. Espaces resserrés, coupe à 100 caractères (points de
 * code, pour ne pas couper un emoji en deux).
 *
 * @param raw Valeur brute du corps.
 * @returns Le nom nettoyé (`FALLBACK_VOICE_NAME` s'il ne reste rien), ou `null` pour une valeur inexploitable.
 */
export function sanitizeVoiceChannelName(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.trim() === "" || raw.length > MAX_RAW_NAME_LENGTH) { return null; }
  const cleaned = raw
    .normalize("NFC")
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/[\u00AD\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g, "")
    .replace(/[@<>`*_~|\\#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const cut = Array.from(cleaned).slice(0, MAX_VOICE_NAME_LENGTH).join("").trim();
  return cut === "" ? FALLBACK_VOICE_NAME : cut;
}

/**
 * Traduit une erreur Discord en code rendu au site. Une permission manquante
 * déclenche une alerte au staff (au plus une par heure) : il faut accorder
 * « Gérer les salons » au rôle du bot sur la catégorie.
 * @param client Client Discord, pour l'alerte.
 * @param error Erreur capturée.
 * @param action Action en cours, pour le journal.
 * @returns L'erreur à lever.
 */
async function toVoiceError(client: Client, error: unknown, action: string): Promise<VoiceChannelError> {
  if (error instanceof VoiceChannelError) { return error; }
  const code = discordJsonCode(error);
  const detail = `${action} : ${(error as Error)?.message ?? String(error)}`;
  if (code === MISSING_PERMISSIONS || code === MISSING_ACCESS) {
    const now = Date.now();
    if (now - lastPermissionAlertAt >= PERMISSION_ALERT_COOLDOWN_MS) {
      lastPermissionAlertAt = now;
      await sendAlert(
        client,
        `Salons vocaux de match : permission refusée par Discord (${action}). Le rôle du bot doit avoir « Gérer les salons » ` +
          `sur la catégorie ${voiceCategoryId()} (action requise sur Discord ; signalé au plus une fois par heure).`,
      );
    }
    return new VoiceChannelError("VOICE_MISSING_PERMISSIONS", detail);
  }
  return new VoiceChannelError("VOICE_DISCORD_ERROR", detail);
}

/**
 * Lit un salon vocal sur Discord.
 * @param client Client Discord.
 * @param channelId Identifiant du salon.
 * @returns Le salon, ou `null` s'il n'existe plus (supprimé à la main).
 */
async function fetchVoice(client: Client, channelId: string): Promise<VoiceHandle | null> {
  try {
    const channel = await client.channels.fetch(channelId);
    // Un salon d'un autre type n'est pas un salon vocal de match : ses `members`
    // seraient ceux qui le voient, pas ses occupants.
    if (channel?.type !== ChannelType.GuildVoice) { return null; }
    return channel as unknown as VoiceHandle;
  } catch (error) {
    if (discordJsonCode(error) === UNKNOWN_CHANNEL) { return null; }
    throw await toVoiceError(client, error, "lecture du salon");
  }
}

/**
 * Accès à la table, toute panne de base traduite en `VOICE_STORAGE_ERROR`.
 * @param query Requête paramétrée.
 * @param values Valeurs liées.
 * @returns Les lignes lues.
 */
async function db<T>(query: string, values: unknown[] = []): Promise<T[]> {
  try {
    return await (await getBddInstance()).raw<T>(query, values);
  } catch (error) {
    throw new VoiceChannelError("VOICE_STORAGE_ERROR", (error as Error).message);
  }
}

/**
 * Ligne suivie d'un salon.
 * @param channelId Identifiant du salon.
 * @returns La ligne, ou `null` si le bot ne suit pas ce salon.
 */
async function trackedById(channelId: string): Promise<TrackedRow | null> {
  const rows = await db<TrackedRow>(
    "SELECT channel_id, voice_key, created_at, released_at FROM MatchVoiceChannel WHERE channel_id = ?",
    [channelId],
  );
  return rows[0] ?? null;
}

/**
 * Cesse de suivre un salon (supprimé, à la main ou par le bot).
 * @param channelId Identifiant du salon.
 */
async function untrack(channelId: string): Promise<void> {
  releasedIds.delete(channelId);
  await db("DELETE FROM MatchVoiceChannel WHERE channel_id = ?", [channelId]);
}

/**
 * Supprime un salon suivi puis cesse de le suivre. Un salon déjà disparu est
 * seulement retiré du suivi ; tout autre refus le garde, pour le balayage
 * suivant.
 * @param client Client Discord.
 * @param channel Salon à supprimer.
 */
async function deleteTracked(client: Client, channel: VoiceHandle): Promise<void> {
  try {
    await channel.delete(DELETE_REASON);
  } catch (error) {
    if (discordJsonCode(error) !== UNKNOWN_CHANNEL) {
      throw await toVoiceError(client, error, "suppression du salon");
    }
  }
  await untrack(channel.id);
}

/**
 * Exécute `task` après toute autre tâche de même clé.
 * @param key Clé d'idempotence.
 * @param task Tâche à exécuter.
 * @returns Le résultat de la tâche.
 */
async function withKeyLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = pendingByKey.get(key) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(task);
  pendingByKey.set(key, run);
  try {
    return await run;
  } finally {
    if (pendingByKey.get(key) === run) { pendingByKey.delete(key); }
  }
}

/**
 * Exécute `task` sous le verrou de la clé du salon, avec sa ligne relue sous
 * ce verrou : une reprise par le site (`ensureTeamVoiceChannel`), une
 * libération, un départ et le balayage ne se croisent jamais sur un même salon.
 * @param channelId Identifiant du salon.
 * @param task Tâche, appelée avec la ligne à jour (`null` : salon non suivi).
 * @returns Le résultat de la tâche.
 */
async function withChannelLock<T>(channelId: string, task: (row: TrackedRow | null) => Promise<T>): Promise<T> {
  const row = await trackedById(channelId);
  if (!row) { return task(null); }
  return withKeyLock(row.voice_key, async () => task(await trackedById(channelId)));
}

/**
 * Crée le salon dans la catégorie et l'inscrit au suivi.
 * @param client Client Discord.
 * @param key Clé d'idempotence.
 * @param name Nom déjà nettoyé.
 * @param now Instant de création.
 * @returns L'identifiant du salon créé.
 */
async function createInCategory(client: Client, key: string, name: string, now: number): Promise<string> {
  const categoryId = voiceCategoryId();
  let category;
  try {
    category = await client.channels.fetch(categoryId);
  } catch (error) {
    if (discordJsonCode(error) === UNKNOWN_CHANNEL) {
      throw new VoiceChannelError("VOICE_CATEGORY_UNAVAILABLE", `catégorie ${categoryId} introuvable`);
    }
    throw await toVoiceError(client, error, "lecture de la catégorie");
  }
  if (!category || category.type !== ChannelType.GuildCategory) {
    throw new VoiceChannelError("VOICE_CATEGORY_UNAVAILABLE", `catégorie ${categoryId} introuvable`);
  }

  let channelId: string;
  try {
    // Sans `permissionOverwrites`, Discord aligne les permissions du salon sur la catégorie.
    const created = await category.guild.channels.create({
      name,
      type: ChannelType.GuildVoice,
      parent: category.id,
      userLimit: VOICE_USER_LIMIT,
      reason: "Salon vocal d'équipe pour un match",
    });
    channelId = created.id;
  } catch (error) {
    throw await toVoiceError(client, error, "création du salon");
  }

  try {
    await db(
      "INSERT INTO MatchVoiceChannel (channel_id, voice_key, created_at, released_at) VALUES (?, ?, ?, NULL)",
      [channelId, key, now],
    );
  } catch (error) {
    // Un salon que le bot ne suit pas ne serait jamais supprimé : on le retire aussitôt.
    const orphan = await fetchVoice(client, channelId).catch(() => null);
    await orphan?.delete(DELETE_REASON).catch(() => undefined);
    throw error;
  }
  return channelId;
}

/**
 * Rend le salon vocal d'une clé, créé au besoin (`POST /internal/voice/channels`).
 *
 * Même clé, même salon : un nouvel essai du site ou un redémarrage ne crée pas
 * de doublon. Un salon supprimé à la main est recréé. Un salon libéré mais
 * encore là est repris (option rallumée) : il n'est plus libéré.
 *
 * @param client Client Discord.
 * @param key Clé d'idempotence validée.
 * @param name Nom d'équipe nettoyé.
 * @param now Instant courant (ms), pour les tests.
 * @returns L'identifiant du salon et s'il vient d'être créé.
 */
export async function ensureTeamVoiceChannel(
  client: Client,
  key: string,
  name: string,
  now: number = Date.now(),
): Promise<{ channelId: string; created: boolean }> {
  return withKeyLock(key, async () => {
    const rows = await db<TrackedRow>(
      "SELECT channel_id, voice_key, created_at, released_at FROM MatchVoiceChannel WHERE voice_key = ?",
      [key],
    );
    const existing = rows[0];
    if (existing) {
      const channel = await fetchVoice(client, existing.channel_id);
      if (channel) {
        if (existing.released_at !== null) {
          // Repris : un nouveau délai de 48 h court, comme pour un salon neuf.
          await db("UPDATE MatchVoiceChannel SET released_at = NULL, created_at = ? WHERE channel_id = ?", [now, existing.channel_id]);
          releasedIds.delete(existing.channel_id);
        }
        return { channelId: existing.channel_id, created: false };
      }
      await untrack(existing.channel_id);
    }
    return { channelId: await createInCategory(client, key, name, now), created: true };
  });
}

/**
 * Nombre de personnes dans un salon suivi (`GET …/count`). Le compte seul :
 * aucun membre n'est lu ni rendu.
 * @param client Client Discord.
 * @param channelId Identifiant validé.
 * @returns L'effectif du salon.
 */
export async function countVoiceMembers(client: Client, channelId: string): Promise<number> {
  if (!(await trackedById(channelId))) {
    throw new VoiceChannelError("VOICE_CHANNEL_NOT_TRACKED");
  }
  const channel = await fetchVoice(client, channelId);
  if (!channel) {
    await untrack(channelId);
    throw new VoiceChannelError("VOICE_CHANNEL_NOT_FOUND");
  }
  return channel.members.size;
}

/**
 * Libère un salon suivi (`POST …/release`) : supprimé tout de suite s'il est
 * vide, sinon dès que le dernier occupant le quitte.
 * @param client Client Discord.
 * @param channelId Identifiant validé.
 * @param now Instant courant (ms), pour les tests.
 * @returns `deleted` : le salon n'existe plus.
 */
export async function releaseVoiceChannel(
  client: Client,
  channelId: string,
  now: number = Date.now(),
): Promise<{ deleted: boolean }> {
  return withChannelLock(channelId, async (row) => {
    if (!row) {
      throw new VoiceChannelError("VOICE_CHANNEL_NOT_TRACKED");
    }
    await db(
      "UPDATE MatchVoiceChannel SET released_at = COALESCE(released_at, ?) WHERE channel_id = ?",
      [now, channelId],
    );
    releasedIds.add(channelId);
    const channel = await fetchVoice(client, channelId);
    if (!channel) {
      await untrack(channelId);
      return { deleted: true };
    }
    if (channel.members.size === 0) {
      await deleteTracked(client, channel);
      return { deleted: true };
    }
    return { deleted: false };
  });
}

/**
 * `voiceStateUpdate` : un départ qui vide un salon libéré le supprime. Seuls
 * les salons libérés connus du module sont regardés — aucune requête en base
 * pour les autres mouvements vocaux. Ne lève jamais.
 * @param client Client Discord.
 * @param oldState État vocal avant le mouvement.
 */
export async function handleVoiceStateUpdate(client: Client, oldState: Pick<VoiceState, "channelId" | "channel">): Promise<void> {
  const channelId = oldState.channelId;
  if (!channelId || !releasedIds.has(channelId)) { return; }
  const channel = oldState.channel as unknown as VoiceHandle | null;
  if (!channel || channel.members.size > 0) { return; }
  try {
    await withChannelLock(channelId, async (row) => {
      // Relu sous le verrou : repris par le site entre-temps, ou de nouveau occupé.
      if (row === null) { return; }
      if (row.released_at === null) {
        releasedIds.delete(channelId);
        return;
      }
      if (channel.members.size > 0) { return; }
      await deleteTracked(client, channel);
    });
  } catch (error) {
    await sendLog(client, `Salon vocal de match ${channelId} : suppression reportée au balayage (${(error as Error).message}).`);
  }
}

/**
 * `channelDelete` : un salon suivi supprimé à la main cesse d'être suivi.
 * Seul un salon vocal de la catégorie est regardé — aucune écriture en base
 * pour les salons des serveurs partenaires ; un salon suivi sorti de la
 * catégorie avant sa suppression est oublié au balayage suivant. Ne lève jamais.
 * @param client Client Discord.
 * @param channel Salon supprimé.
 */
export async function handleVoiceChannelDeleted(
  client: Client,
  channel: { id: string; type?: ChannelType; parentId?: string | null },
): Promise<void> {
  if (channel.type !== ChannelType.GuildVoice || channel.parentId !== voiceCategoryId()) { return; }
  const channelId = channel.id;
  try {
    await untrack(channelId);
  } catch (error) {
    await sendLog(client, `channelDelete : retrait du suivi vocal ${channelId} échoué (${(error as Error).message}).`);
  }
}

/**
 * Décide du sort d'un salon suivi au balayage.
 * @param row Ligne suivie.
 * @param members Effectif du salon.
 * @param now Instant courant (ms).
 * @returns `true` s'il faut le supprimer.
 */
export function shouldSweep(row: Pick<TrackedRow, "created_at" | "released_at">, members: number, now: number): boolean {
  if (row.released_at !== null) {
    return members === 0 || now - Number(row.released_at) > RELEASED_MAX_AGE_MS;
  }
  return now - Number(row.created_at) > UNRELEASED_MAX_AGE_MS;
}

/**
 * Traite un salon suivi au balayage.
 * @param client Client Discord.
 * @param row Ligne suivie.
 * @param now Instant courant (ms).
 * @returns Le sort du salon.
 */
async function sweepOne(client: Client, row: TrackedRow, now: number): Promise<keyof SweepReport> {
  let channel: VoiceHandle | null;
  try {
    channel = await fetchVoice(client, row.channel_id);
  } catch (error) {
    // Salon que le bot ne voit plus (permission retirée, serveur quitté) depuis
    // longtemps : il ne pourra pas le supprimer, et le garder relancerait
    // l'alerte toutes les heures. Il est oublié.
    if (error instanceof VoiceChannelError && error.code === "VOICE_MISSING_PERMISSIONS"
      && now - Number(row.created_at) > ABANDONED_MAX_AGE_MS) {
      await untrack(row.channel_id);
      return "untracked";
    }
    throw error;
  }
  if (!channel) {
    await untrack(row.channel_id);
    return "untracked";
  }
  if (shouldSweep(row, channel.members.size, now)) {
    await deleteTracked(client, channel);
    return "deleted";
  }
  if (row.released_at === null) {
    releasedIds.delete(row.channel_id);
  } else {
    releasedIds.add(row.channel_id);
  }
  return "kept";
}

/**
 * Balayage des salons suivis, au démarrage et toutes les 30 min : supprime
 * les libérés vides, les libérés depuis plus de 24 h même occupés, et les
 * jamais libérés de plus de 48 h ; oublie ceux supprimés à la main, et ceux
 * que le bot ne voit plus depuis plus de 96 h. Tient à jour le cache des
 * salons libérés (rempli au démarrage). Ne lève jamais ; journalise un bilan s'il y a
 * eu quelque chose à faire.
 * @param client Client Discord.
 * @param now Instant courant (ms), pour les tests.
 * @returns Le bilan du balayage.
 */
export async function sweepVoiceChannels(client: Client, now: number = Date.now()): Promise<SweepReport> {
  const report: SweepReport = { deleted: 0, untracked: 0, kept: 0, failed: 0 };
  let rows: TrackedRow[];
  try {
    rows = await db<TrackedRow>("SELECT channel_id, voice_key, created_at, released_at FROM MatchVoiceChannel");
  } catch (error) {
    await sendLog(client, `Balayage des salons vocaux de match impossible : ${(error as Error).message}`);
    return report;
  }
  for (const snapshot of rows) {
    try {
      // Relu sous le verrou de sa clé : la photo du début du balayage a pu
      // vieillir (salon repris, libéré ou supprimé entre-temps).
      const outcome = await withKeyLock(snapshot.voice_key, async () => {
        const row = await trackedById(snapshot.channel_id);
        return row ? sweepOne(client, row, now) : null;
      });
      if (outcome) { report[outcome]++; }
    } catch {
      // Gardé pour le balayage suivant ; toujours libérable par un départ.
      if (snapshot.released_at !== null) { releasedIds.add(snapshot.channel_id); }
      report.failed++;
    }
  }
  if (report.deleted + report.untracked + report.failed > 0) {
    await sendLog(
      client,
      `Salons vocaux de match : ${report.deleted} supprimé(s), ${report.untracked} disparu(s), ` +
        `${report.failed} en échec, ${report.kept} conservé(s).`,
    );
  }
  return report;
}
