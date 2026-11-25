/**
 * Adresse d'un service voisin **sur la même machine** (SancturAI, le site
 * BlueGenji) : le bot ne lui envoie un jeton que par cette porte.
 */

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * L'adresse est-elle du http en boucle locale (127.0.0.1, localhost, [::1]),
 * sans identifiants ? Le jeton qui l'accompagne ne quitte alors jamais la
 * machine, et aucun relais (nginx, TLS) n'est traversé.
 * @param baseUrl Adresse de base lue dans l'environnement.
 * @returns `true` pour une adresse http en boucle locale.
 */
export function isLoopbackHttp(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}
