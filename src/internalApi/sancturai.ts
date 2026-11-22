/**
 * Pont SancturAI ↔ Discord : notifications du relais en DM au propriétaire, et
 * réponse de l'administrateur renvoyée à SancturAI par `/sancturai-reply`.
 *
 * Le texte vient d'agents (non fiable) : seul l'en-tête `[SancturAI] …` est
 * produit par le bot, tout texte variable est échappé puis cité, et les DM
 * partent sans aucune mention résolue.
 */

import { MessageFlags, type Client, type User } from "discord.js";
import { sliceWithoutSplittingPair } from "../utils/cutText.js";
import { splitForDiscord } from "../utils/splitForDiscord.js";

export type SancturaiNotify = {
  kind: "log" | "agent_message";
  text: string;
  agent?: { handle: string; agent_id: string };
  short_id?: string;
};

const MAX_DISCORD = 2000;
const SHORT_ID = /^[0-9a-f]{4}$/;
const QUOTED_LINE_MAX = 1900; // + "> " : une ligne citée tient toujours dans un DM
// Bornes du contrat SancturAI (outbox : 1 800 pour un journal, 4 000 pour un message d'agent ; agent_id VARCHAR(64), pseudo ≤ 32).
// Un corps plus gros ferait des dizaines de DM ; un en-tête plus long que 2 000 serait coupé hors citation.
const MAX_TEXT = 4000;
const MAX_HEADER_FIELD = 64;
// Contrôles, formats (bidi, largeur nulle) et séparateurs de ligne : rien de tout cela dans l'en-tête du bot.
const UNSAFE_HEADER_CHAR = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

/**
 * Longueur en points de code, comme `len()` côté SancturAI (Python) : `.length` compte les unités UTF-16,
 * si bien qu'un message légitime de 4 000 émojis (8 000 unités) serait refusé. Coût borné : au-delà de
 * deux unités par point de code, la limite est forcément dépassée.
 */
function withinCodePoints(text: string, max: number): boolean {
  return text.length <= max || (text.length <= 2 * max && [...text].length <= max);
}

/** Pseudo ou identifiant d'agent affiché dans l'en-tête : court, sans caractère invisible ni saut de ligne. */
function isHeaderField(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && withinCodePoints(value, MAX_HEADER_FIELD) && !UNSAFE_HEADER_CHAR.test(value);
}

/**
 * Valide le corps envoyé par le relais.
 * @param body Corps JSON brut.
 * @returns La notification normalisée, ou `null` si le corps est invalide.
 */
export function parseNotify(body: unknown): SancturaiNotify | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if ((b.kind !== "log" && b.kind !== "agent_message") || typeof b.text !== "string" || !b.text.trim()) return null;
  if (!withinCodePoints(b.text, MAX_TEXT)) return null;
  const out: SancturaiNotify = { kind: b.kind, text: b.text };
  if (typeof b.short_id === "string" && SHORT_ID.test(b.short_id)) out.short_id = b.short_id;
  if (b.agent !== undefined && b.agent !== null) {
    const agent = b.agent as Record<string, unknown>;
    if (typeof agent !== "object" || !isHeaderField(agent.handle) || !isHeaderField(agent.agent_id)) return null;
    out.agent = { handle: agent.handle, agent_id: agent.agent_id };
  }
  // Un message d'agent sans fil ni auteur valides ne doit pas se déguiser en journal : refus explicite.
  if (out.kind === "agent_message" && (!out.short_id || !out.agent)) return null;
  return out;
}

// CR, U+2028, U+2029, NEL (U+0085) : séparateurs de ligne que Discord peut rendre comme un saut.
const EXOTIC_BREAKS = new RegExp(`\r\n|[${String.fromCharCode(13, 0x2028, 0x2029, 0x85)}]`, "g");

/** Ramène CRLF, CR seul, U+2028, U+2029 et NEL (U+0085) à un saut de ligne : aucune ligne ne doit échapper à la citation. */
export function normalizeNewlines(text: string): string {
  return text.replace(EXOTIC_BREAKS, "\n");
}

/** Variante mono-ligne pour l'en-tête (pseudo, identifiant) : tout saut de ligne devient une espace. */
function inline(text: string): string {
  return normalizeNewlines(text).replace(/\n/g, " ");
}

/** Neutralise le markdown Discord, les mentions (@, <@id>, <#id>) et les liens masqués [x](url). */
export function escapeDiscord(text: string): string {
  return text.replace(/[\\*_~`|>#[\]()<@]/g, "\\$&");
}

/** Texte non fiable → citation : chaque ligne (et chaque morceau d'une ligne trop longue) commence par "> ". */
export function quoteBlock(text: string): string {
  const out: string[] = [];
  for (const line of escapeDiscord(normalizeNewlines(text)).split("\n")) {
    if (!line) {
      out.push(">");
      continue;
    }
    let rest = line;
    while (rest) {
      const piece = sliceWithoutSplittingPair(rest, QUOTED_LINE_MAX);
      out.push(`> ${piece}`);
      rest = rest.slice(piece.length);
    }
  }
  return out.join("\n");
}

/** Message DM d'une notification : en-tête du bot, puis texte échappé et cité. */
export function formatNotify(n: SancturaiNotify): string {
  if (n.kind === "agent_message" && n.short_id && n.agent) {
    return `[SancturAI] #${n.short_id} de ${escapeDiscord(inline(n.agent.handle))} (${escapeDiscord(inline(n.agent.agent_id))}) :\n`
      + `${quoteBlock(n.text)}\n\n→ /sancturai-reply id:${n.short_id} texte:...`;
  }
  return `[SancturAI] journal :\n${quoteBlock(n.text)}`;
}

/** Valide les arguments de `/sancturai-reply` (identifiant à 4 hexa, éventuellement précédé de `#`). */
export function parseReplyArgs(id: string, text: string): { shortId: string; text: string } | null {
  const shortId = id.trim().replace(/^#/, "").toLowerCase();
  const body = text.trim();
  if (!SHORT_ID.test(shortId) || !body || !withinCodePoints(body, MAX_TEXT)) return null;
  return { shortId, text: body };
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** `SANCTURAI_INTERNAL_URL` doit viser SancturAI en boucle locale (http) : le jeton ne quitte jamais la machine. */
function isLoopbackHttp(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

/**
 * Transmet la réponse de l'administrateur à SancturAI.
 * @returns Le statut HTTP de SancturAI.
 * @throws Si le jeton est vide (jamais d'appel non authentifié), si l'URL n'est pas du http en boucle
 *   locale (127.0.0.1, localhost, ::1), ou si SancturAI répond par une redirection (jeton jamais renvoyé ailleurs).
 */
export async function postReply(baseUrl: string, token: string, shortId: string, text: string,
                                fetchImpl: typeof fetch = fetch): Promise<number> {
  if (!token) throw new Error("SANCTURAI_INTERNAL_TOKEN manquant");
  if (!isLoopbackHttp(baseUrl)) throw new Error("SANCTURAI_INTERNAL_URL doit être en http vers 127.0.0.1, localhost ou [::1]");
  const res = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/internal/admin-replies`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-internal-token": token },
    body: JSON.stringify({ short_id: shortId, text }),
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  return res.status;
}

/** Envoie `text` en DM au propriétaire (`OWNER_ID`) uniquement, sans aucune mention résolue. */
export async function sendOwnerDm(client: Client, text: string): Promise<boolean> {
  const ownerId = process.env.OWNER_ID;
  if (!ownerId) {
    console.error("[sancturai] OWNER_ID non défini — DM annulé.");
    return false;
  }
  try {
    const owner: User = await client.users.fetch(ownerId);
    // aucune mention résolue (ni @everyone, ni rôle, ni utilisateur), même si l'échappement était contourné ;
    // aucun aperçu de lien : l'embed d'une URL de l'agent s'afficherait hors citation, sous la forme qu'il choisit.
    // Les lignes citées font ≤ 1902 caractères : splitForDiscord ne coupe donc jamais une ligne (le "> " resterait en tête).
    let sent = 0;
    try {
      for (const part of splitForDiscord(text, MAX_DISCORD)) {
        await owner.send({ content: part, allowedMentions: { parse: [] }, flags: MessageFlags.SuppressEmbeds });
        sent += 1;
      }
    } catch (err) {
      // Un nouvel essai renverrait les morceaux déjà partis : une fois le premier livré, on ne signale plus d'échec.
      if (sent === 0) throw err;
      console.error(`[sancturai] DM owner partial: ${sent} morceau(x) envoyé(s), le reste a échoué:`, (err as Error).message);
    }
    return true;
  } catch (err) {
    console.error("[sancturai] DM owner failed:", (err as Error).message);
    return false;
  }
}
