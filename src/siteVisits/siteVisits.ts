/**
 * Fréquentation du site BlueGenji, telle que reçue de l'app web.
 *
 * Le bot ne mesure rien lui-même : l'app pousse un instantané sur l'API interne
 * (`POST /internal/site-visits`, canal déjà utilisé pour l'auth et les logs),
 * le bot le conserve dans une ligne unique de `SiteVisit` et la commande
 * `/stats-site` la relit localement — sans jamais appeler le site en retour.
 */
import { getBddInstance } from "@/bdd/Bdd.js";

/** Instantané de fréquentation. Miroir de `SiteVisitStats` côté app web. */
export interface SiteVisitStats {
  totalVisits: number;
  uniqueVisitors: number;
  visitsLast24h: number;
  uniqueVisitorsLast24h: number;
  visitsLast7Days: number;
  uniqueVisitorsLast7Days: number;
  visitsLast30Days: number;
  uniqueVisitorsLast30Days: number;
  identifiedVisitors: number;
  firstVisitAt: string | null;
  lastVisitAt: string | null;
}

/** Instantané enregistré, accompagné de sa date de réception. */
export interface StoredSiteVisitStats extends SiteVisitStats {
  updatedAt: string | null;
}

function toCount(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) { return 0; }
  return Math.floor(parsed);
}

function toDate(value: unknown): string | null {
  if (typeof value !== "string") { return null; }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Valide et normalise un corps reçu de l'app web.
 *
 * Tolérant par construction : un champ manquant ou aberrant vaut 0 plutôt que de
 * rejeter tout l'instantané, car une version antérieure de l'app doit pouvoir
 * continuer à alimenter le bot. Seul un corps qui n'est pas un objet, ou qui ne
 * porte aucun compteur exploitable, est refusé.
 *
 * @param payload Corps JSON reçu.
 * @returns L'instantané normalisé, ou `null` si le corps est inexploitable.
 */
export function parseSiteVisitStats(payload: unknown): SiteVisitStats | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) { return null; }

  const raw = payload as Record<string, unknown>;
  if (raw.totalVisits === undefined && raw.uniqueVisitors === undefined) { return null; }

  return {
    totalVisits: toCount(raw.totalVisits),
    uniqueVisitors: toCount(raw.uniqueVisitors),
    visitsLast24h: toCount(raw.visitsLast24h),
    uniqueVisitorsLast24h: toCount(raw.uniqueVisitorsLast24h),
    visitsLast7Days: toCount(raw.visitsLast7Days),
    uniqueVisitorsLast7Days: toCount(raw.uniqueVisitorsLast7Days),
    visitsLast30Days: toCount(raw.visitsLast30Days),
    uniqueVisitorsLast30Days: toCount(raw.uniqueVisitorsLast30Days),
    identifiedVisitors: toCount(raw.identifiedVisitors),
    firstVisitAt: toDate(raw.firstVisitAt),
    lastVisitAt: toDate(raw.lastVisitAt),
  };
}

/**
 * Ancienneté d'un instantané en français (`il y a 5 minutes`).
 * @param updatedAt Date de réception (SQLite, UTC) ou `null`.
 * @param now Instant de référence, injectable pour les tests.
 */
export function formatSnapshotAge(updatedAt: string | null, now: Date = new Date()): string {
  if (!updatedAt) { return "date inconnue"; }

  // SQLite renvoie 'YYYY-MM-DD HH:MM:SS' en UTC, sans suffixe de fuseau.
  const normalized = updatedAt.includes("T") ? updatedAt : updatedAt.replace(" ", "T") + "Z";
  const ts = Date.parse(normalized);
  if (Number.isNaN(ts)) { return "date inconnue"; }

  const seconds = Math.max(0, Math.round((now.getTime() - ts) / 1000));
  if (seconds < 60) { return "il y a moins d'une minute"; }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) { return `il y a ${minutes} minute${minutes > 1 ? "s" : ""}`; }
  const hours = Math.round(minutes / 60);
  if (hours < 24) { return `il y a ${hours} heure${hours > 1 ? "s" : ""}`; }
  const days = Math.round(hours / 24);
  return `il y a ${days} jour${days > 1 ? "s" : ""}`;
}

/**
 * Message Discord de la commande `/stats-site`.
 * @param stats Instantané enregistré, ou `null` si l'app n'a encore rien poussé.
 * @param now Instant de référence, injectable pour les tests.
 */
export function formatSiteVisitStats(stats: StoredSiteVisitStats | null, now: Date = new Date()): string {
  if (!stats) {
    return "Aucune donnee de frequentation recue du site pour le moment. Reessayez plus tard.";
  }

  const lines = [
    "**Frequentation du site BlueGenji**",
    `- Visites totales : ${stats.totalVisits}`,
    `- Visiteurs uniques : ${stats.uniqueVisitors}`,
    `- Dont comptes connectes : ${stats.identifiedVisitors}`,
    `- 24 h : ${stats.visitsLast24h} visites / ${stats.uniqueVisitorsLast24h} uniques`,
    `- 7 jours : ${stats.visitsLast7Days} visites / ${stats.uniqueVisitorsLast7Days} uniques`,
    `- 30 jours : ${stats.visitsLast30Days} visites / ${stats.uniqueVisitorsLast30Days} uniques`,
    `_Mesure mise a jour ${formatSnapshotAge(stats.updatedAt, now)}._`,
  ];
  return lines.join("\n");
}

/**
 * Écrase l'instantané conservé (une seule ligne, `id = 1`).
 * @param stats Instantané normalisé.
 */
export async function saveSiteVisitStats(stats: SiteVisitStats): Promise<void> {
  const bdd = await getBddInstance();
  await bdd.raw(
    `INSERT INTO SiteVisit (id, total_visits, unique_visitors, visits_24h, unique_24h, visits_7d, unique_7d, visits_30d, unique_30d, identified_visitors, first_visit_at, last_visit_at, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(id) DO UPDATE SET
       total_visits = excluded.total_visits,
       unique_visitors = excluded.unique_visitors,
       visits_24h = excluded.visits_24h,
       unique_24h = excluded.unique_24h,
       visits_7d = excluded.visits_7d,
       unique_7d = excluded.unique_7d,
       visits_30d = excluded.visits_30d,
       unique_30d = excluded.unique_30d,
       identified_visitors = excluded.identified_visitors,
       first_visit_at = excluded.first_visit_at,
       last_visit_at = excluded.last_visit_at,
       updated_at = CURRENT_TIMESTAMP`,
    [
      stats.totalVisits,
      stats.uniqueVisitors,
      stats.visitsLast24h,
      stats.uniqueVisitorsLast24h,
      stats.visitsLast7Days,
      stats.uniqueVisitorsLast7Days,
      stats.visitsLast30Days,
      stats.uniqueVisitorsLast30Days,
      stats.identifiedVisitors,
      stats.firstVisitAt,
      stats.lastVisitAt,
    ],
  );
}

/**
 * Relit l'instantané conservé.
 * @returns L'instantané, ou `null` si l'app n'a encore rien poussé.
 */
export async function readSiteVisitStats(): Promise<StoredSiteVisitStats | null> {
  const bdd = await getBddInstance();
  const rows = await bdd.raw<Record<string, unknown>>("SELECT * FROM SiteVisit WHERE id = 1");
  const row = rows[0];
  if (!row) { return null; }

  return {
    totalVisits: toCount(row.total_visits),
    uniqueVisitors: toCount(row.unique_visitors),
    visitsLast24h: toCount(row.visits_24h),
    uniqueVisitorsLast24h: toCount(row.unique_24h),
    visitsLast7Days: toCount(row.visits_7d),
    uniqueVisitorsLast7Days: toCount(row.unique_7d),
    visitsLast30Days: toCount(row.visits_30d),
    uniqueVisitorsLast30Days: toCount(row.unique_30d),
    identifiedVisitors: toCount(row.identified_visitors),
    firstVisitAt: toDate(row.first_visit_at),
    lastVisitAt: toDate(row.last_visit_at),
    updatedAt: toDate(row.updated_at),
  };
}
