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

/** Un salon rendu encore occupé est supprimé au plus tard à cette échéance (site : `VOICE_BOT_RELEASED_MAX_HOURS`). */
const RELEASED_MAX_AGE_HOURS = 24;

/** Un salon jamais rendu resté vide est supprimé à cette échéance (site : `VOICE_BOT_UNRELEASED_MAX_HOURS`). */
const UNRELEASED_MAX_AGE_HOURS = 48;

/**
 * Passé ce délai, une ligne qu'on n'arrive pas à solder (suppression refusée
 * sans fin) est abandonnée : mieux vaut cesser d'appeler Discord chaque passe
 * que réessayer pour toujours (site : `VOICE_BOT_ABANDONED_MAX_HOURS`).
 */
const ABANDONED_MAX_AGE_HOURS = 96;

/** Période du balayage des salons à supprimer (site : `VOICE_BOT_SWEEP_MINUTES`). */
const SWEEP_INTERVAL_MS = 30 * 60 * 1000;

/** Lignes examinées par passe : le reste attend la suivante, rien n'est affamé (les plus anciennes d'abord). */
const SWEEP_BATCH = 200;

/** Longueur maximale d'un nom de salon côté Discord. */
const NAME_MAX_LENGTH = 100;

/** Identifiant Discord : des chiffres, comme le site les attend en retour. */
const SNOWFLAKE = /^\d{5,32}$/;

/** Clé du site : `match:<matchId>:team:<teamId>`. */
const VOICE_KEY = /^[A-Za-z0-9:_-]{1,120}$/;

/** « Unknown Channel » : le seul refus de Discord qui prouve un salon disparu. */
const DISCORD_UNKNOWN_CHANNEL = 10003;

/** Issue d'une demande : une valeur, ou un code que le site sait lire. */
export type VoiceResult<T> = { ok: true; value: T } | { ok: false; code: string; status: number };

type Row = { channel_id: string; voice_key: string; guild_id: string; created_at: string; released_at: string | null };

/** Un salon vu par Discord : trouvé, bel et bien disparu, ou injoignable — trois cas, jamais deux. */
type Lookup = { kind: "found"; channel: VoiceChannel } | { kind: "gone" } | { kind: "error" };

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

/**
 * Ligne d'une clé, **rendue ou non** : une clé rendue dont le salon vit encore
 * doit être retrouvée, sinon la demande suivante créerait un second salon et
 * perdrait le premier (`MATCH_VOICE.md` : « jamais un salon sans ligne »).
 */
async function rowByKey(key: string): Promise<Row | null> {
  const bdd = await getBddInstance();
  const rows = await bdd.raw<Row>("SELECT * FROM VoiceChannel WHERE voice_key = ?", [key]);
  return rows[0] ?? null;
}

async function rowByChannel(channelId: string): Promise<Row | null> {
  const bdd = await getBddInstance();
  const rows = await bdd.raw<Row>("SELECT * FROM VoiceChannel WHERE channel_id = ?", [channelId]);
  return rows[0] ?? null;
}

async function dropRow(channelId: string): Promise<void> {
  const bdd = await getBddInstance();
  await bdd.raw("DELETE FROM VoiceChannel WHERE channel_id = ?", [channelId]);
}

/**
 * Retrouve un salon sur Discord. Seul « Unknown Channel » vaut « disparu » :
 * une coupure, un 5xx ou un rate-limit laissent un salon bien vivant, et le
 * prendre pour disparu le ferait recréer (deux salons, le premier sans ligne).
 */
async function fetchVoice(client: Client, channelId: string): Promise<Lookup> {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel) { return { kind: "gone" }; }
    return channel.type === ChannelType.GuildVoice ? { kind: "found", channel: channel as VoiceChannel } : { kind: "gone" };
  } catch (error) {
    if (error instanceof DiscordAPIError && error.code === DISCORD_UNKNOWN_CHANNEL) { return { kind: "gone" }; }
    console.error("[voice] salon illisible :", (error as Error).message);
    return { kind: "error" };
  }
}

/**
 * Code d'un refus de Discord. La permission, le nom et la catégorie pleine se
 * distinguent du reste : les trois valent pour tous les salons, et le site
 * arrête sa passe au lieu de redemander chaque salon toutes les minutes.
 */
function discordFailure(error: unknown): VoiceResult<never> {
  if (error instanceof DiscordAPIError) {
    if (error.code === 50013 || error.code === 50001) { return fail("VOICE_MISSING_PERMISSIONS"); }
    if (error.code === 50035) { return fail("INVALID_VOICE_CHANNEL_NAME", 400); }
    // 30xxx : « Maximum number of … reached » (50 salons par catégorie, 500 par serveur).
    if (typeof error.code === "number" && error.code >= 30000 && error.code < 31000) {
      return fail("VOICE_CATEGORY_UNAVAILABLE");
    }
  }
  return fail("VOICE_DISCORD_ERROR");
}

/** Demandes en vol, par clé : deux appels simultanés ne créent qu'un salon. */
const inFlight = new Map<string, Promise<VoiceResult<string>>>();

/**
 * Crée le salon vocal d'une équipe, ou rend celui qui suit déjà cette clé. Le
 * salon supprimé à la main entre-temps est recréé ; le site peut donc rappeler
 * la même clé sans fin sans multiplier les salons.
 */
export function ensureVoiceChannel(client: Client, key: string, name: string): Promise<VoiceResult<string>> {
  const pending = inFlight.get(key);
  if (pending) { return pending; }
  const run = createOrFind(client, key, name).finally(() => { inFlight.delete(key); });
  inFlight.set(key, run);
  return run;
}

async function createOrFind(client: Client, key: string, name: string): Promise<VoiceResult<string>> {
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
    const lookup = await fetchVoice(client, known.channel_id);
    // Injoignable : on ne recrée rien, le salon existe peut-être encore.
    if (lookup.kind === "error") { return fail("VOICE_DISCORD_ERROR"); }
    if (lookup.kind === "found") {
      // Ligne rendue dont le salon vit : elle se rouvre, le salon est réutilisé.
      if (known.released_at !== null) {
        try {
          const bdd = await getBddInstance();
          await bdd.raw("UPDATE VoiceChannel SET released_at = NULL, created_at = datetime('now') WHERE channel_id = ?", [known.channel_id]);
        } catch (error) {
          console.error("[voice] réouverture non écrite :", (error as Error).message);
          return fail("VOICE_STORAGE_ERROR");
        }
      }
      return { ok: true, value: lookup.channel.id };
    }
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
    // `raw` ne rend ni `changes` ni erreur quand la base est absente : on relit.
    const written = await rowByChannel(created.id);
    if (!written) { throw new Error("ligne du salon absente après écriture"); }
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
 * le site n'a rien à redemander. **Seul un salon que le bot suit est
 * supprimé** : un identifiant périmé ne doit pas emporter un salon du serveur.
 */
export async function releaseVoiceChannel(
  client: Client,
  channelId: string,
): Promise<VoiceResult<{ released: true; deleted: boolean }>> {
  if (!client.isReady()) { return fail("DISCORD_NOT_READY", 503); }

  let known: Row | null;
  try {
    await ensureTable();
    known = await rowByChannel(channelId);
    if (known) {
      const bdd = await getBddInstance();
      await bdd.raw("UPDATE VoiceChannel SET released_at = datetime('now') WHERE channel_id = ? AND released_at IS NULL", [channelId]);
    }
  } catch (error) {
    console.error("[voice] rendu non écrit :", (error as Error).message);
    return fail("VOICE_STORAGE_ERROR");
  }

  // Jamais suivi : rien à supprimer, et le site peut clore sa ligne.
  if (!known) { return { ok: true, value: { released: true, deleted: true } }; }

  const lookup = await fetchVoice(client, channelId);
  if (lookup.kind === "error") { return fail("VOICE_DISCORD_ERROR"); }
  if (lookup.kind === "gone") {
    await dropRow(channelId).catch(() => undefined);
    return { ok: true, value: { released: true, deleted: true } };
  }

  if (lookup.channel.members.size > 0) { return { ok: true, value: { released: true, deleted: false } }; }

  try {
    await lookup.channel.delete("salon de match rendu");
  } catch (error) {
    console.error("[voice] suppression refusée par Discord :", (error as Error).message);
    return discordFailure(error);
  }
  await dropRow(channelId).catch(() => undefined);
  return { ok: true, value: { released: true, deleted: true } };
}

/** Une seule passe à la fois : deux passes sur les mêmes lignes doubleraient les appels. */
let sweeping = false;

/**
 * Balayage : supprime les salons rendus devenus vides (et ceux rendus depuis
 * plus de 24 h, occupés ou non), ceux jamais rendus et vides depuis 48 h,
 * oublie les lignes dont le salon a disparu, et abandonne au bout de 96 h une
 * ligne qu'il n'arrive pas à solder.
 */
export async function sweepVoiceChannels(client: Client): Promise<void> {
  if (!client.isReady() || sweeping) { return; }
  sweeping = true;
  try {
    let rows: Row[];
    try {
      await ensureTable();
      const bdd = await getBddInstance();
      rows = await bdd.raw<Row>(
        `SELECT channel_id, voice_key, guild_id, created_at, released_at FROM VoiceChannel
          WHERE released_at IS NOT NULL
             OR created_at <= datetime('now', ?)
          ORDER BY created_at
          LIMIT ${SWEEP_BATCH}`,
        [`-${UNRELEASED_MAX_AGE_HOURS} hour`]
      );
    } catch (error) {
      console.error("[voice] balayage : suivi illisible :", (error as Error).message);
      return;
    }

    for (const row of rows) {
      const ageMs = Date.now() - sqliteTime(row.created_at);
      if (Number.isFinite(ageMs) && ageMs >= ABANDONED_MAX_AGE_HOURS * 3600_000) {
        console.warn(`[voice] ligne abandonnée après ${ABANDONED_MAX_AGE_HOURS} h : salon ${row.channel_id}`);
        await dropRow(row.channel_id).catch(() => undefined);
        continue;
      }

      const lookup = await fetchVoice(client, row.channel_id);
      if (lookup.kind === "error") { continue; }
      if (lookup.kind === "gone") {
        await dropRow(row.channel_id).catch(() => undefined);
        continue;
      }

      const releasedMs = row.released_at === null ? null : Date.now() - sqliteTime(row.released_at);
      const forced = releasedMs !== null && Number.isFinite(releasedMs) && releasedMs >= RELEASED_MAX_AGE_HOURS * 3600_000;
      if (lookup.channel.members.size > 0 && !forced) { continue; }
      try {
        await lookup.channel.delete("salon de match vide");
        await dropRow(row.channel_id).catch(() => undefined);
      } catch (error) {
        console.error("[voice] balayage : suppression refusée :", (error as Error).message);
      }
    }
  } finally {
    sweeping = false;
  }
}

/** Heure SQLite (`datetime('now')`, UTC, sans fuseau) en millisecondes. */
function sqliteTime(value: string): number {
  return Date.parse(`${value.replace(" ", "T")}Z`);
}

/**
 * Démarre le balayage périodique, après une première passe au démarrage (un
 * redémarrage ne doit pas laisser un salon vide attendre la demi-heure).
 * L'intervalle ne retient pas le processus.
 */
export function startVoiceSweep(client: Client): NodeJS.Timeout {
  void sweepVoiceChannels(client);
  const timer = setInterval(() => { void sweepVoiceChannels(client); }, SWEEP_INTERVAL_MS);
  timer.unref?.();
  return timer;
}
