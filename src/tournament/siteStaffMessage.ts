/**
 * Appel du bot **vers le site** pour `/message-tournoi` : la seule exception au
 * sens habituel (le site appelle le bot, jamais l'inverse), décidée le
 * 2026-11-25 (`doc/internal-api.md`, côté site `BOT_INTEGRATION.md`).
 *
 * Le bot ne décide de rien : il transmet l'identifiant Discord de l'auteur, le
 * tournoi, les catégories et le texte ; le site vérifie le compte rattaché, la
 * permission `tournaments`, l'état du tournoi et ses engagés, puis rend des
 * **nombres** (jamais un nom ni un identifiant de destinataire). L'envoi des
 * messages privés repasse par l'API interne du bot (`/internal/notify/dm`),
 * comme toute notification du site.
 *
 * Le site est joint en boucle locale seulement (`SITE_INTERNAL_URL`, http vers
 * 127.0.0.1, localhost ou [::1]) avec le jeton `SITE_INTERNAL_TOKEN` : le jeton
 * ne quitte jamais la machine.
 */

import { isLoopbackHttp } from "../utils/loopbackUrl.js";

/** Catégories de destinataires, dans l'ordre du menu (`ALL` emporte le reste). */
export const STAFF_MESSAGE_CATEGORIES = ["PLAYERS", "MANAGERS", "CAPTAINS", "OWNERS", "ALL"] as const;
export type StaffMessageCategory = (typeof STAFF_MESSAGE_CATEGORIES)[number];

/** Longueur maximale du texte (même borne que le site, `STAFF_MESSAGE_MAX_LENGTH`). */
export const STAFF_MESSAGE_MAX_LENGTH = 1200;

/** Chemin de la route du site. */
export const SITE_STAFF_MESSAGE_PATH = "/api/internal/tournament-message";

/** Aperçu : relu à chaque changement de sélection, il doit répondre vite. */
export const PREVIEW_TIMEOUT_MS = 15_000;
/**
 * Envoi : le site attend le bot, qui écrit à chaque destinataire l'un après
 * l'autre. Sous les cinq minutes au bout desquelles `fetch` (undici) abandonne
 * de lui-même l'attente des en-têtes.
 */
export const SEND_TIMEOUT_MS = 280_000;

/** Codes du bot pour un site muet ; les autres viennent du site lui-même. */
export const SITE_UNREACHABLE = "SITE_UNREACHABLE";
export const SITE_TIMEOUT = "SITE_TIMEOUT";
export const SITE_BAD_RESPONSE = "SITE_BAD_RESPONSE";
export const SITE_NOT_CONFIGURED = "SITE_NOT_CONFIGURED";

/** Adresse et jeton du site, lus dans l'environnement. */
export type SiteConfig = { baseUrl: string; token: string };

/**
 * @param env Environnement du processus.
 * @returns La configuration, ou `null` si l'adresse manque, n'est pas du http en
 *   boucle locale, ou si le jeton est vide : aucun appel n'est alors tenté.
 */
export function siteConfig(env: NodeJS.ProcessEnv = process.env): SiteConfig | null {
  const baseUrl = env.SITE_INTERNAL_URL?.trim() ?? "";
  const token = env.SITE_INTERNAL_TOKEN?.trim() ?? "";
  if (!baseUrl || !token || !isLoopbackHttp(baseUrl)) { return null; }
  return { baseUrl: baseUrl.replace(/\/+$/, ""), token };
}

/** Destinataires comptés par le site. */
export type RecipientCounts = { total: number; reachable: number; withoutDiscord: number; optedOut: number };

/** Bilan d'un envoi, compté par le site. */
export type DeliveryCounts = { sent: number; failed: number; skipped: number; pushed: number; botUnreachable: boolean };

export type StaffMessagePreview = { tournament: { id: number; name: string }; recipients: RecipientCounts };
export type StaffMessageSent = StaffMessagePreview & { delivery: DeliveryCounts };

/** Issue d'un appel : la réponse lue, ou un code (du site, ou du bot pour un site muet). */
export type SiteResult<T> = { ok: true; data: T } | { ok: false; code: string };

export type StaffMessageCall = {
  discordId: string;
  tournamentId: number;
  categories: readonly StaffMessageCategory[];
  message: string;
};

/** Code d'erreur du site : des mots en capitales joints par `_`, jamais une phrase. */
const ERROR_CODE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function readTournament(value: unknown): { id: number; name: string } | null {
  if (typeof value !== "object" || value === null) { return null; }
  const raw = value as Record<string, unknown>;
  const id = count(raw.id);
  if (id === null || id === 0 || typeof raw.name !== "string") { return null; }
  return { id, name: raw.name };
}

function readCounts<K extends string>(value: unknown, keys: readonly K[]): Record<K, number> | null {
  if (typeof value !== "object" || value === null) { return null; }
  const raw = value as Record<string, unknown>;
  const out = {} as Record<K, number>;
  for (const key of keys) {
    const n = count(raw[key]);
    if (n === null) { return null; }
    out[key] = n;
  }
  return out;
}

/**
 * Lit l'aperçu rendu par le site.
 * @param body Corps JSON reçu.
 * @returns L'aperçu, ou `null` s'il n'a pas la forme attendue.
 */
export function parsePreview(body: unknown): StaffMessagePreview | null {
  if (typeof body !== "object" || body === null) { return null; }
  const raw = body as Record<string, unknown>;
  const tournament = readTournament(raw.tournament);
  const recipients = readCounts(raw.recipients, ["total", "reachable", "withoutDiscord", "optedOut"] as const);
  return tournament && recipients ? { tournament, recipients } : null;
}

/**
 * Lit le bilan d'un envoi rendu par le site.
 * @param body Corps JSON reçu.
 * @returns Le bilan, ou `null` s'il n'a pas la forme attendue.
 */
export function parseSent(body: unknown): StaffMessageSent | null {
  const preview = parsePreview(body);
  if (!preview) { return null; }
  const raw = (body as Record<string, unknown>).delivery;
  const counts = readCounts(raw, ["sent", "failed", "skipped", "pushed"] as const);
  if (!counts) { return null; }
  const botUnreachable = (raw as Record<string, unknown>).botUnreachable === true;
  return { ...preview, delivery: { ...counts, botUnreachable } };
}

/**
 * Appelle la route du site. Ne lève jamais : un site muet (connexion refusée,
 * délai dépassé, réponse illisible) devient un code, comme un refus du site.
 * Aucune redirection n'est suivie (le jeton ne part jamais ailleurs).
 */
async function callSite<T>(
  config: SiteConfig,
  mode: "preview" | "send",
  call: StaffMessageCall,
  parse: (body: unknown) => T | null,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<SiteResult<T>> {
  let response: Response;
  try {
    response = await fetchImpl(`${config.baseUrl}${SITE_STAFF_MESSAGE_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-token": config.token },
      body: JSON.stringify({ mode, ...call }),
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const name = (error as { name?: unknown })?.name;
    return { ok: false, code: name === "TimeoutError" || name === "AbortError" ? SITE_TIMEOUT : SITE_UNREACHABLE };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, code: response.ok ? SITE_BAD_RESPONSE : SITE_UNREACHABLE };
  }
  if (!response.ok) {
    const code = (body as { error?: unknown } | null)?.error;
    return { ok: false, code: typeof code === "string" && code.length <= 64 && ERROR_CODE.test(code) ? code : SITE_BAD_RESPONSE };
  }
  const data = parse(body);
  return data ? { ok: true, data } : { ok: false, code: SITE_BAD_RESPONSE };
}

/**
 * Aperçu : qui recevrait le message, compté par le site.
 * @param config Adresse et jeton du site.
 * @param call Auteur, tournoi, catégories et texte.
 * @param fetchImpl `fetch` (remplacé dans les tests).
 * @returns L'aperçu, ou le code du refus.
 */
export function previewStaffMessage(config: SiteConfig, call: StaffMessageCall, fetchImpl: typeof fetch = fetch): Promise<SiteResult<StaffMessagePreview>> {
  return callSite(config, "preview", call, parsePreview, PREVIEW_TIMEOUT_MS, fetchImpl);
}

/**
 * Envoi : le site relit tout, réserve l'envoi à son plafond, puis distribue.
 * @param config Adresse et jeton du site.
 * @param call Auteur, tournoi, catégories et texte.
 * @param fetchImpl `fetch` (remplacé dans les tests).
 * @returns Le bilan, ou le code du refus.
 */
export function sendStaffMessage(config: SiteConfig, call: StaffMessageCall, fetchImpl: typeof fetch = fetch): Promise<SiteResult<StaffMessageSent>> {
  return callSite(config, "send", call, parseSent, SEND_TIMEOUT_MS, fetchImpl);
}

/**
 * Catégories choisies dans le menu : connues, sans doublon, dans l'ordre du
 * menu ; `ALL` emporte le reste ; rien de connu → tout le monde.
 * @param values Valeurs du menu déroulant.
 * @returns Les catégories à transmettre au site.
 */
export function normalizeCategories(values: readonly string[]): StaffMessageCategory[] {
  const picked = new Set(values.filter((value): value is StaffMessageCategory => (STAFF_MESSAGE_CATEGORIES as readonly string[]).includes(value)));
  if (picked.size === 0 || picked.has("ALL")) { return ["ALL"]; }
  return STAFF_MESSAGE_CATEGORIES.filter((category) => picked.has(category));
}
