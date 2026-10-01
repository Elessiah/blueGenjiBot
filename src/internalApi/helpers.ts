import { createHash, timingSafeEqual } from "node:crypto";

/** Adresses d'ecoute sur lesquelles seul un process de la machine peut se connecter. */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
/** Adresse d'ecoute par defaut de `startInternalApi`. */
const DEFAULT_INTERNAL_HOST = "127.0.0.1";
/** Prefixe d'une adresse IPv4 ecrite en IPv6 (`::ffff:127.0.0.1`). */
const IPV4_MAPPED_PREFIX = "::ffff:";

/**
 * Dit si l'API interne n'est joignable que depuis la machine elle-meme.
 *
 * La valeur par defaut reprend celle de `startInternalApi` (`127.0.0.1`) :
 * les deux doivent repondre la meme chose, sinon la garde d'`authorize`
 * raisonnerait sur une interface que le serveur n'ecoute pas. `startInternalApi`
 * replie avec `||`, qui traite aussi une chaine vide comme absente : `??` ne
 * le ferait pas, et une variable presente mais vide romprait l'accord entre
 * les deux — l'API resterait bien en ecoute locale, mais la garde la
 * croirait ouverte et rejetterait tout en 503.
 *
 * @param host Valeur de `INTERNAL_API_HOST`, absente ou vide comprise.
 * @returns `true` si l'ecoute est confinee a la boucle locale.
 */
export function isLoopbackHost(host: string = DEFAULT_INTERNAL_HOST): boolean {
  // Vide vaut absente, comme le `||` de `startInternalApi`.
  const address = host === "" ? DEFAULT_INTERNAL_HOST : host;
  const ipv4 = address.toLowerCase().startsWith(IPV4_MAPPED_PREFIX) ? address.slice(IPV4_MAPPED_PREFIX.length) : null;
  return LOOPBACK_HOSTS.has(address) || ipv4 === "127.0.0.1";
}

/**
 * Compare le jeton recu au jeton attendu sans laisser fuiter leur ressemblance.
 *
 * `!==` s'arrete au premier octet different : la duree de la reponse dit
 * alors combien de caracteres de tete sont justes, et le jeton se devine
 * position par position. Les deux valeurs sont d'abord hachees, ce qui leur
 * donne la meme longueur — `timingSafeEqual` leve sur deux tampons de
 * tailles differentes, et cette levee serait elle-meme un canal.
 *
 * @param provided Valeur du header `x-internal-token`, absente comprise.
 * @param expected Jeton attendu, non vide.
 * @returns `true` si les deux jetons sont identiques.
 */
export function matchesToken(provided: string | undefined, expected: string): boolean {
  if (provided === undefined) {
    return false;
  }
  const providedDigest = createHash("sha256").update(provided).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}

/** Difference absolue formatee '+3' / '-2'. */
export function absDelta(curr: number, prev: number): string {
  const d = curr - prev;
  return (d >= 0 ? "+" : "") + d;
}

/** Couleur HSL deterministe derivee de l'id (hash simple). */
export function deterministicColor(id: string): string {
  // Arithmetique entiere 32 bits signee (a la `hashCode` de Java) : la case
  // d'un `Int32Array` replie chaque somme comme le faisait `| 0`.
  const hash = new Int32Array(1);
  for (let i = 0; i < id.length; i++) {
    hash[0] = Math.imul(hash[0], 31) + (id.codePointAt(i) ?? 0);
  }
  const hue = Math.abs(hash[0]) % 360;
  return `hsl(${hue}, 65%, 50%)`;
}

/** Etat de relais d'un serveur, pour `/internal/servers`. */
export type RelayStatus = "ok" | "lag" | "off";

/**
 * Etat de relais d'un serveur d'apres l'age de son dernier relais : `ok` sous
 * 24 h, `lag` sous 7 jours, `off` au-dela ou sans aucun relais.
 *
 * @param hoursAgo Heures ecoulees depuis le dernier relais, `null`/absent sans relais.
 * @returns L'etat du serveur.
 */
export function relayStatus(hoursAgo: number | null | undefined): RelayStatus {
  if (hoursAgo === null || hoursAgo === undefined) {
    return "off";
  }
  if (hoursAgo < 24) {
    return "ok";
  }
  return hoursAgo < 24 * 7 ? "lag" : "off";
}

/** Nombre de points d'une courbe de relais. */
export const SPARKLINE_POINTS = 10;

/**
 * Courbe de relais d'un serveur, de la plus ancienne tranche a la plus
 * recente : la tranche `0` (la plus recente) va au dernier point. Une tranche
 * hors de la courbe est ignoree.
 *
 * @param rows Comptes par tranche, tranche `0` = la plus recente.
 * @returns `SPARKLINE_POINTS` comptes, zero pour une tranche sans relais.
 */
export function sparklineFromBuckets(rows: ReadonlyArray<{ bucket: number; count: number }>): number[] {
  const sparkline = new Array(SPARKLINE_POINTS).fill(0);
  for (const r of rows) {
    if (r.bucket >= 0 && r.bucket < SPARKLINE_POINTS) {
      sparkline[SPARKLINE_POINTS - 1 - r.bucket] = Number(r.count);
    }
  }
  return sparkline;
}
