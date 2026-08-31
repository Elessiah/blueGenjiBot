import type { Client, Guild, GuildMember } from "discord.js";

/**
 * Résolution d'un identifiant Discord fourni par l'app web.
 *
 * Extrait de `internalApi.ts` (`POST /internal/auth/resolve`) pour être partagé
 * avec l'envoi de messages privés : les deux ont exactement la même contrainte
 * — l'app connaît un tag, Discord n'accepte qu'un ID — et deux implémentations
 * divergeraient sur les cas fins (legacy `pseudo#1234`, casse, guilde
 * momentanément injoignable).
 *
 * La lecture du tag (`parseDiscordHandle`) est **pure** ; seules les fonctions
 * qui interrogent Discord touchent au réseau.
 */

/** Résultat d'une résolution : l'ID trouvé, et par quel biais. */
export interface HandleResolution {
  discordId: string;
  matchedBy: "id" | "tag";
}

/** Identifiant lu : un snowflake, ou un tag à chercher parmi les membres. */
export type ParsedHandle =
  | { kind: "id"; discordId: string }
  | { kind: "tag"; username: string; discriminator: string | null };

const DISCORD_ID_RE = /^\d{5,32}$/;

/**
 * Lit un identifiant Discord tel que l'app le transmet.
 *
 * Accepte un ID numérique, un `pseudo` (format actuel, unique globalement) et
 * le legacy `pseudo#1234`. Le préfixe `@` est toléré : c'est ce que copie un
 * joueur depuis le client Discord.
 *
 * @param handle Chaîne saisie ou stockée côté site.
 * @returns L'identifiant lu, ou `null` si la chaîne est inexploitable.
 */
export function parseDiscordHandle(handle: string): ParsedHandle | null {
  const trimmed = handle.trim();
  if (trimmed.length === 0) { return null; }
  if (DISCORD_ID_RE.test(trimmed)) { return { kind: "id", discordId: trimmed }; }

  let username = trimmed.replace(/^@/, "");
  let discriminator: string | null = null;
  const hashIdx = username.lastIndexOf("#");
  if (hashIdx > 0 && /^\d{4}$/.test(username.slice(hashIdx + 1))) {
    discriminator = username.slice(hashIdx + 1);
    username = username.slice(0, hashIdx);
  }
  if (username.length === 0) { return null; }

  return { kind: "tag", username, discriminator };
}

/**
 * Cherche un membre d'une guilde par son tag.
 *
 * Seul le `username` est comparé : `globalName` et le surnom de serveur ne sont
 * **pas** uniques et résoudraient vers le mauvais compte.
 *
 * @param guild Guilde à interroger.
 * @param parsed Tag déjà lu par `parseDiscordHandle`.
 * @returns Le membre trouvé, ou `null` (guilde injoignable comprise).
 */
export async function findGuildMemberByHandle(
  guild: Guild,
  parsed: Extract<ParsedHandle, { kind: "tag" }>,
): Promise<GuildMember | null> {
  const normalized = parsed.username.toLowerCase();

  let members;
  try {
    members = await guild.members.fetch({ query: parsed.username, limit: 100 });
  } catch {
    return null;
  }

  return (
    members.find((m) => {
      const uname = m.user.username?.toLowerCase() ?? "";
      if (parsed.discriminator) {
        return uname === normalized && m.user.discriminator === parsed.discriminator;
      }
      return uname === normalized;
    }) ?? null
  );
}

/**
 * Résout un identifiant Discord en balayant **tous** les serveurs du bot.
 *
 * Sert à la connexion au site (`/internal/auth/resolve`) : un membre d'un
 * serveur partenaire doit pouvoir se connecter sans être sur le serveur
 * BlueGenji. L'envoi de messages privés, lui, se restreint à ce dernier
 * (`deliver.ts`).
 *
 * @param client Client Discord.
 * @param handle ID, `pseudo`, ou legacy `pseudo#1234` (préfixe `@` toléré).
 * @returns L'ID résolu, ou `null` si aucun membre ne correspond.
 */
export async function resolveDiscordHandle(
  client: Client,
  handle: string,
): Promise<HandleResolution | null> {
  const parsed = parseDiscordHandle(handle);
  if (!parsed) { return null; }
  if (parsed.kind === "id") { return { discordId: parsed.discordId, matchedBy: "id" }; }

  for (const guild of client.guilds.cache.values()) {
    const member = await findGuildMemberByHandle(guild, parsed);
    if (member) { return { discordId: member.id, matchedBy: "tag" }; }
  }

  return null;
}
