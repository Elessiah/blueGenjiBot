import { ChannelType, DiscordAPIError, type CategoryChannel, type Client, type VoiceChannel } from "discord.js";
import { getBddInstance } from "@/bdd/Bdd.js";

/**
 * Salons vocaux d'équipe demandés par le site (`AppBlueGenji`,
 * `docs/features/MATCH_VOICE.md`). Le site appelle `POST /internal/voice/channels`
 * 15 min avant un match et rend le salon quand le match est fini : ici, une
 * ligne par salon suivi, la création dans la catégorie des matchs, et un
 * balayage qui supprime les salons vides.
 *
 * Aucun pseudo n'arrive jamais ici : le site n'envoie que le nom d'une équipe.
 */

/** Catégorie Discord qui accueille les salons de match. */
const VOICE_CATEGORY_ID = process.env.VOICE_CATEGORY_ID ?? "676735851119640577";

/** Places par salon, comme l'annonce le site. */
const VOICE_CHANNEL_CAPACITY = 5;

/** Un salon rendu encore occupé est supprimé au plus tard à cette échéance. */
const RELEASED_FORCE_HOURS = 24;

/** Un salon jamais rendu resté vide est supprimé à cette échéance. */
const UNRELEASED_MAX_HOURS = 48;

/** Période du balayage des salons à supprimer. */
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/** Longueur maximale d'un nom de salon côté Discord. */
const NAME_MAX_LENGTH = 100;

/** Identifiant Discord : des chiffres, comme le site les attend en retour. */
const SNOWFLAKE = /^\d{5,32}$/;

/** Clé du site : `match:<matchId>:team:<teamId>`. */
const VOICE_KEY = /^[A-Za-z0-9:_-]{1,120}$/;

/** Issue d'une demande : une valeur, ou un code que le site sait lire. */
export type VoiceResult<T> = { ok: true; value: T } | { ok: false; code: string; status: number };

type Row = { channel_id: string; voice_key: string; guild_id: string; created_at: string; released_at: string | null };

function fail(code: string, status = 500): VoiceResult<never> {
  return { ok: false, code, status };
}

/**
 * Nom de salon acceptable : du texte visible, sans retour à la ligne, borné par
 * la limite de Discord. Un nom vide ou illisible est refusé sous
 * `INVALID_VOICE_CHANNEL_NAME` — le site redemande alors « Salon d'équipe ».
 */
export function sanitizeChannelName(raw: unknown): string | null {
  if (typeof raw !== "string") { return null; }
  // eslint-disable-next-line no-control-regex
  const name = raw.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (name.length === 0 || name.length > NAME_MAX_LENGTH) { return null; }
  return name;
}

/** Clé du site, telle quelle ou rien. */
export function readVoiceKey(raw: unknown): string | null {
  return typeof raw === "string" && VOICE_KEY.test(raw) ? raw : null;
}

/** Identifiant de salon, tel que le site le renvoie au rendu. */
export function readChannelId(raw: unknown): string | null {
  return typeof raw === "string" && SNOWFLAKE.test(raw) ? raw : null;
}

async function ensureTable(): Promise<void> {
  const bdd = await getBddInstance();
  await bdd.raw(
    `CREATE TABLE IF NOT EXISTS VoiceChannel
      (
        channel_id TEXT PRIMARY KEY,
        voice_key TEXT NOT NULL UNIQUE,
        guild_id TEXT NOT NULL,
        created_at DATETIME NOT NULL,
        released_at DATETIME
      );`
  );
}

async function rowByKey(key: string): Promise<Row | null> {
  const bdd = await getBddInstance();
  const rows = await bdd.raw<Row>("SELECT * FROM VoiceChannel WHERE voice_key = ? AND released_at IS NULL", [key]);
  return rows[0] ?? null;
}

async function dropRow(channelId: string): Promise<void> {
  const bdd = await getBddInstance();
  await bdd.raw("DELETE FROM VoiceChannel WHERE channel_id = ?", [channelId]);
}

/**
 * Retrouve un salon sur Discord. `null` : il n'existe plus (supprimé à la main),
 * et la ligne qui le suivait ne vaut plus rien.
 */
async function fetchVoice(client: Client, channelId: string): Promise<VoiceChannel | null> {
  try {
    const channel = await client.channels.fetch(channelId);
    return channel?.type === ChannelType.GuildVoice ? (channel as VoiceChannel) : null;
  } catch {
    return null;
  }
}

/** Code d'un refus de Discord : la permission et le nom se distinguent du reste. */
function discordFailure(error: unknown): VoiceResult<never> {
  if (error instanceof DiscordAPIError) {
    if (error.code === 50013 || error.code === 50001) { return fail("VOICE_MISSING_PERMISSIONS"); }
    if (error.code === 50035) { return fail("INVALID_VOICE_CHANNEL_NAME", 400); }
  }
  return fail("VOICE_DISCORD_ERROR");
}

/**
 * Crée le salon vocal d'une équipe, ou rend celui qui suit déjà cette clé. Le
 * salon supprimé à la main entre-temps est recréé ; le site peut donc rappeler
 * la même clé sans fin sans multiplier les salons.
 */
export async function ensureVoiceChannel(client: Client, key: string, name: string): Promise<VoiceResult<string>> {
  if (!client.isReady()) { return fail("DISCORD_NOT_READY", 503); }

  let known: Row | null;
  try {
    await ensureTable();
    known = await rowByKey(key);
  } catch (error) {
    console.error("[voice] lecture du suivi en échec :", (error as Error).message);
    return fail("VOICE_STORAGE_ERROR");
  }

  if (known) {
    const existing = await fetchVoice(client, known.channel_id);
    if (existing) { return { ok: true, value: existing.id }; }
    await dropRow(known.channel_id).catch(() => undefined);
  }

  const category = await client.channels.fetch(VOICE_CATEGORY_ID).catch(() => null);
  if (!category || category.type !== ChannelType.GuildCategory) { return fail("VOICE_CATEGORY_UNAVAILABLE"); }

  let created: VoiceChannel;
  try {
    created = await (category as CategoryChannel).guild.channels.create({
      name,
      type: ChannelType.GuildVoice,
      parent: category.id,
      userLimit: VOICE_CHANNEL_CAPACITY,
    });
  } catch (error) {
    console.error("[voice] création refusée par Discord :", (error as Error).message);
    return discordFailure(error);
  }

  try {
    const bdd = await getBddInstance();
    // Une clé rendue puis redemandée reprend la ligne : un seul salon par clé.
    await bdd.raw(
      `INSERT INTO VoiceChannel (channel_id, voice_key, guild_id, created_at, released_at)
       VALUES (?, ?, ?, datetime('now'), NULL)
       ON CONFLICT(voice_key) DO UPDATE SET channel_id = excluded.channel_id, created_at = datetime('now'), released_at = NULL`,
      [created.id, key, created.guild.id]
    );
  } catch (error) {
    // Salon sans suivi = salon jamais supprimé : on le retire tout de suite.
    console.error("[voice] suivi non écrit, salon retiré :", (error as Error).message);
    await created.delete("suivi du salon non écrit").catch(() => undefined);
    return fail("VOICE_STORAGE_ERROR");
  }

  return { ok: true, value: created.id };
}

/**
 * Rend un salon au bot : supprimé s'il est vide, sinon dès qu'il se vide (au
 * plus tard 24 h après). Un salon déjà parti ou jamais suivi répond succès —
 * le site n'a rien à redemander.
 */
export async function releaseVoiceChannel(
  client: Client,
  channelId: string,
): Promise<VoiceResult<{ released: true; deleted: boolean }>> {
  if (!client.isReady()) { return fail("DISCORD_NOT_READY", 503); }

  try {
    await ensureTable();
    const bdd = await getBddInstance();
    await bdd.raw("UPDATE VoiceChannel SET released_at = datetime('now') WHERE channel_id = ? AND released_at IS NULL", [channelId]);
  } catch (error) {
    console.error("[voice] rendu non écrit :", (error as Error).message);
    return fail("VOICE_STORAGE_ERROR");
  }

  const channel = await fetchVoice(client, channelId);
  if (!channel) {
    await dropRow(channelId).catch(() => undefined);
    return { ok: true, value: { released: true, deleted: true } };
  }

  if (channel.members.size > 0) { return { ok: true, value: { released: true, deleted: false } }; }

  try {
    await channel.delete("salon de match rendu");
  } catch (error) {
    console.error("[voice] suppression refusée par Discord :", (error as Error).message);
    return discordFailure(error);
  }
  await dropRow(channelId).catch(() => undefined);
  return { ok: true, value: { released: true, deleted: true } };
}

/**
 * Balayage : supprime les salons rendus devenus vides (et ceux rendus depuis
 * plus de 24 h, occupés ou non), ceux jamais rendus et vides depuis 48 h, et
 * oublie les lignes dont le salon a disparu.
 */
export async function sweepVoiceChannels(client: Client): Promise<void> {
  if (!client.isReady()) { return; }
  let rows: Row[];
  try {
    await ensureTable();
    const bdd = await getBddInstance();
    rows = await bdd.raw<Row>(
      `SELECT * FROM VoiceChannel
        WHERE released_at IS NOT NULL
           OR created_at <= datetime('now', ?)`,
      [`-${UNRELEASED_MAX_HOURS} hour`]
    );
  } catch (error) {
    console.error("[voice] balayage : suivi illisible :", (error as Error).message);
    return;
  }

  for (const row of rows) {
    const channel = await fetchVoice(client, row.channel_id);
    if (!channel) {
      await dropRow(row.channel_id).catch(() => undefined);
      continue;
    }
    const releasedAt = row.released_at ? Date.parse(`${row.released_at.replace(" ", "T")}Z`) : null;
    const forced = releasedAt !== null && Number.isFinite(releasedAt)
      && Date.now() - releasedAt >= RELEASED_FORCE_HOURS * 3600_000;
    if (channel.members.size > 0 && !forced) { continue; }
    try {
      await channel.delete("salon de match vide");
      await dropRow(row.channel_id).catch(() => undefined);
    } catch (error) {
      console.error("[voice] balayage : suppression refusée :", (error as Error).message);
    }
  }
}

/** Démarre le balayage périodique ; l'intervalle ne retient pas le processus. */
export function startVoiceSweep(client: Client): NodeJS.Timeout {
  const timer = setInterval(() => { void sweepVoiceChannels(client); }, SWEEP_INTERVAL_MS);
  timer.unref?.();
  return timer;
}
