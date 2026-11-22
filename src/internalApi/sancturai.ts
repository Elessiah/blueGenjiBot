/**
 * Pont SancturAI ↔ Discord : notifications du relais en DM au propriétaire, et
 * réponse de l'administrateur renvoyée à SancturAI par `/sancturai-reply`.
 *
 * Le texte vient d'agents (non fiable) : seul l'en-tête `[SancturAI] …` est
 * produit par le bot, tout texte variable est échappé puis cité, et les DM
 * partent sans aucune mention résolue.
 */

import { timingSafeEqual } from "node:crypto";
import type { Client, User } from "discord.js";

export type SancturaiNotify = {
  kind: "log" | "agent_message";
  text: string;
  agent?: { handle: string; agent_id: string };
  short_id?: string;
};

const MAX_DISCORD = 2000;
const SHORT_ID = /^[0-9a-f]{4}$/;
const QUOTED_LINE_MAX = 1900; // + "> " : une ligne citée tient toujours dans un DM

/**
 * Valide le corps envoyé par le relais.
 * @param body Corps JSON brut.
 * @returns La notification normalisée, ou `null` si le corps est invalide.
 */
export function parseNotify(body: unknown): SancturaiNotify | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if ((b.kind !== "log" && b.kind !== "agent_message") || typeof b.text !== "string" || !b.text.trim()) return null;
  const out: SancturaiNotify = { kind: b.kind, text: b.text };
  if (typeof b.short_id === "string" && SHORT_ID.test(b.short_id)) out.short_id = b.short_id;
  const agent = b.agent as Record<string, unknown> | undefined;
  if (agent && typeof agent.handle === "string" && typeof agent.agent_id === "string") {
    out.agent = { handle: agent.handle, agent_id: agent.agent_id };
  }
  return out;
}

/**
 * Compare un jeton reçu au jeton attendu, en échouant fermé : un jeton attendu
 * absent ou vide refuse tout (contrairement au middleware `authorize` historique).
 * @param expected Jeton configuré côté bot.
 * @param provided Valeur de l'en-tête `x-internal-token`.
 */
export function tokenAllows(expected: string | undefined, provided: string | undefined): boolean {
  if (!expected || !provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
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
    for (let i = 0; i < line.length; i += QUOTED_LINE_MAX) out.push(`> ${line.slice(i, i + QUOTED_LINE_MAX)}`);
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

/**
 * Découpe en morceaux ≤ `size` caractères (2000 : limite Discord) sur les fins de ligne, sans rien perdre :
 * une ligne citée n'est jamais coupée, donc chaque DM ne contient que l'en-tête du bot ou des lignes "> ".
 */
export function chunkDiscord(text: string, size: number = MAX_DISCORD): string[] {
  const parts: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    const pieces: string[] = [];
    for (let i = 0; i < line.length; i += size) pieces.push(line.slice(i, i + size));
    for (const piece of pieces.length ? pieces : [""]) {
      const next = current ? `${current}\n${piece}` : piece;
      if (next.length <= size) {
        current = next;
        continue;
      }
      parts.push(current);
      current = piece;
    }
  }
  parts.push(current);
  return parts;
}

/** Valide les arguments de `/sancturai-reply` (identifiant à 4 hexa, éventuellement précédé de `#`). */
export function parseReplyArgs(id: string, text: string): { shortId: string; text: string } | null {
  const shortId = id.trim().replace(/^#/, "").toLowerCase();
  const body = text.trim();
  if (!SHORT_ID.test(shortId) || !body || body.length > 4000) return null;
  return { shortId, text: body };
}

/**
 * Transmet la réponse de l'administrateur à SancturAI.
 * @returns Le statut HTTP de SancturAI.
 * @throws Si le jeton est vide (jamais d'appel non authentifié).
 */
export async function postReply(baseUrl: string, token: string, shortId: string, text: string,
                                fetchImpl: typeof fetch = fetch): Promise<number> {
  if (!token) throw new Error("SANCTURAI_INTERNAL_TOKEN manquant");
  const res = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/internal/admin-replies`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-internal-token": token },
    body: JSON.stringify({ short_id: shortId, text }),
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
    // aucune mention résolue (ni @everyone, ni rôle, ni utilisateur), même si l'échappement était contourné
    for (const part of chunkDiscord(text)) await owner.send({ content: part, allowedMentions: { parse: [] } });
    return true;
  } catch (err) {
    console.error("[sancturai] DM owner failed:", (err as Error).message);
    return false;
  }
}
