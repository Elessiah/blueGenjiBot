import type { Client } from "discord.js";

/**
 * Résolution d'un tag Discord vers un ID, par balayage des serveurs du bot.
 *
 * Extrait de `internalApi.ts` (`POST /internal/auth/resolve`) pour être partagé
 * avec l'envoi de messages privés : les deux ont exactement la même contrainte
 * — l'app connaît un tag, Discord n'accepte qu'un ID — et deux implémentations
 * divergeraient sur les cas fins (legacy `pseudo#1234`, casse, guilde
 * momentanément injoignable).
 */

/** Résultat d'une résolution : l'ID trouvé, et par quel biais. */
export interface HandleResolution {
  discordId: string;
  matchedBy: "id" | "tag";
}

const DISCORD_ID_RE = /^\d{5,32}$/;

/**
 * Résout un identifiant Discord fourni par l'app web.
 *
 * Un ID numérique est renvoyé tel quel, sans solliciter Discord. Un tag est
 * cherché parmi les membres des serveurs du bot : seul le `username` est
 * comparé, car `globalName` et le surnom de serveur ne sont **pas** uniques et
 * résoudraient vers le mauvais compte.
 *
 * @param client Client Discord.
 * @param handle ID, `pseudo`, ou legacy `pseudo#1234` (préfixe `@` toléré).
 * @returns L'ID résolu, ou `null` si aucun membre ne correspond.
 */
export async function resolveDiscordHandle(
  client: Client,
  handle: string,
): Promise<HandleResolution | null> {
  const trimmed = handle.trim();
  if (trimmed.length === 0) { return null; }
  if (DISCORD_ID_RE.test(trimmed)) { return { discordId: trimmed, matchedBy: "id" }; }

  let username = trimmed.replace(/^@/, "");
  let discriminator: string | null = null;
  const hashIdx = username.lastIndexOf("#");
  if (hashIdx > 0 && /^\d{4}$/.test(username.slice(hashIdx + 1))) {
    discriminator = username.slice(hashIdx + 1);
    username = username.slice(0, hashIdx);
  }
  const normalized = username.toLowerCase();
  if (normalized.length === 0) { return null; }

  for (const guild of client.guilds.cache.values()) {
    let members;
    try {
      members = await guild.members.fetch({ query: username, limit: 100 });
    } catch {
      continue; // guilde momentanément injoignable : on tente les suivantes.
    }

    const match = members.find((m) => {
      const uname = m.user.username?.toLowerCase() ?? "";
      if (discriminator) {
        return uname === normalized && m.user.discriminator === discriminator;
      }
      return uname === normalized;
    });

    if (match) { return { discordId: match.id, matchedBy: "tag" }; }
  }

  return null;
}
