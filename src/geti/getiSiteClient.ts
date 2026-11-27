/**
 * Appels du bot **vers le site** pour les annonces GETI : seconde exception au
 * sens habituel (le site appelle le bot), après `/message-tournoi`
 * (`doc/internal-api.md`). Même porte : `SITE_INTERNAL_URL` en boucle locale,
 * en-tête `x-internal-token: <SITE_INTERNAL_TOKEN>`, aucune redirection suivie.
 *
 * Aucun appel ne lève : un site muet devient une issue (`retry`), le relais
 * réessaie puis rattrape (`getiQueue.ts`, `getiRelay.ts`).
 */

import type { SiteConfig } from "../tournament/siteStaffMessage.js";
import type { GetiWirePost } from "./getiPayload.js";

/** Routes du site. */
export const SITE_GETI_POSTS_PATH = "/api/internal/geti/posts";
export const SITE_GETI_DELETE_PATH = "/api/internal/geti/posts/delete";
export const SITE_GETI_RECONCILE_PATH = "/api/internal/geti/reconcile";

/** Attente maximale sur un `Retry-After` du site (429) : au-delà, la file retombe sur ses propres reprises. */
export const GETI_RETRY_AFTER_MAX_MS = 60_000;

/** Le site répond en quelques millisecondes ; au-delà, il est tenu pour muet. */
export const GETI_SITE_TIMEOUT_MS = 15_000;

/** Ce que le relais pousse au site. */
export type GetiSiteOp =
  | { kind: "upsert"; posts: GetiWirePost[] }
  | { kind: "delete"; ids: string[] }
  | { kind: "reconcile"; channelId: string; since: string; until: string; ids: string[] };

/**
 * Issue d'un appel : `ok` (reçu), `retry` (site muet, occupé ou fermé — à
 * retenter), `drop` (corps refusé : le renvoyer tel quel ne changerait rien).
 */
export type GetiSiteOutcome = "ok" | "retry" | "drop";

/** Refus qui tiennent au corps envoyé : mal formé, trop lourd, mal déclaré. */
const BODY_REFUSALS = new Set([400, 413, 415, 422]);
/**
 * Refus qui tiennent à la configuration (jeton, adresse hors boucle locale) :
 * journalisés à part. Un 404 reste un site pas encore à jour (bot déployé le
 * premier) : retenté, il se rattrape dès que les routes existent.
 */
const CONFIG_REFUSALS = new Set([401, 403]);

/**
 * Statuts de refus de configuration qui ont déjà leur ligne au journal : un
 * statut déjà noté n'en reprend pas, même en alternance (401, 403, 401…) ; toute
 * autre réponse du site les remet à zéro.
 */
const loggedConfigRefusals = new Set<number>();

/** Remet à zéro la ligne de refus de configuration (tests). */
export function resetGetiConfigRefusalLog(): void {
  loggedConfigRefusals.clear();
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms).unref(); });
}

/** `Retry-After` en secondes (une date HTTP ou une valeur absurde ne vaut rien), borné. */
function retryAfterMs(header: string | null): number {
  const seconds = Number(header);
  if (header === null || header.trim() === "" || !Number.isFinite(seconds) || seconds <= 0) { return 0; }
  return Math.min(seconds * 1000, GETI_RETRY_AFTER_MAX_MS);
}

function requestOf(op: GetiSiteOp): { path: string; body: unknown } {
  if (op.kind === "upsert") { return { path: SITE_GETI_POSTS_PATH, body: { posts: op.posts } }; }
  if (op.kind === "delete") { return { path: SITE_GETI_DELETE_PATH, body: { ids: op.ids } }; }
  return {
    path: SITE_GETI_RECONCILE_PATH,
    body: { channelId: op.channelId, since: op.since, until: op.until, ids: op.ids },
  };
}

/**
 * Pousse une opération au site. Ne lève jamais.
 * @param config Adresse et jeton du site.
 * @param op Lot d'annonces, suppression ou réconciliation.
 * @param fetchImpl `fetch` (remplacé dans les tests).
 * @returns L'issue de l'appel.
 */
export async function sendGetiOp(
  config: SiteConfig,
  op: GetiSiteOp,
  fetchImpl: typeof fetch = fetch,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<GetiSiteOutcome> {
  const { path, body } = requestOf(op);
  try {
    const response = await fetchImpl(`${config.baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-token": config.token },
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(GETI_SITE_TIMEOUT_MS),
    });
    // Le corps de la réponse (des nombres) n'est pas lu : il est libéré.
    await response.body?.cancel().catch(() => undefined);
    if (!CONFIG_REFUSALS.has(response.status)) {
      loggedConfigRefusals.clear();
    } else if (!loggedConfigRefusals.has(response.status)) {
      // Jeton refusé ou appel hors boucle locale : une erreur de configuration, à corriger avant le prochain démarrage.
      // Retentée comme un site muet (reprises de la file, puis un essai par envoi et le rattrapage dû) : une seule ligne
      // au journal par statut, jusqu'à une autre réponse du site, pas une par essai.
      loggedConfigRefusals.add(response.status);
      console.error(`[geti] site : refus ${response.status} — vérifier SITE_INTERNAL_URL (boucle locale) et SITE_INTERNAL_TOKEN`);
    }
    if (response.ok) { return "ok"; }
    // Plafond d'appels atteint : le site dit combien attendre ; réessayer plus tôt ne ferait que brûler les reprises de la file.
    if (response.status === 429) { await sleep(retryAfterMs(response.headers.get("retry-after"))); }
    return BODY_REFUSALS.has(response.status) ? "drop" : "retry";
  } catch {
    return "retry";
  }
}
