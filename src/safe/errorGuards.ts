/**
 * Classification des erreurs runtime et garde-fous process.
 *
 * Le bot tombait sur des erreurs *transitoires* : une coupure DNS/réseau
 * (`EAI_AGAIN`, `UND_ERR_CONNECT_TIMEOUT`) remontait depuis les appels internes
 * de discord.js sous forme de rejet non capturé, et Node — qui termine le
 * process sur un `unhandledRejection` depuis la v15 — tuait le bot. Une
 * coupure de trente secondes ne doit pas coûter un redémarrage.
 *
 * Deux familles d'erreurs sont donc reconnues ici :
 * - **transitoires** : réseau injoignable. On journalise en console uniquement,
 *   car un `sendLog()` passe justement par le réseau qui est tombé — l'envoyer
 *   déclencherait une cascade d'échecs pendant toute la panne.
 * - **bénignes** : l'objet Discord visé n'existe plus ou est hors de portée
 *   (message supprimé, interaction expirée, permission manquante). Rien à
 *   corriger, on ne réveille pas le canal de supervision pour ça.
 *
 * Tout le reste est un vrai défaut : console **et** canal de logs Discord.
 */

/** Codes système/undici signalant une indisponibilité réseau passagère. */
const TRANSIENT_NETWORK_CODES: ReadonlySet<string> = new Set([
    "EAI_AGAIN",
    "ENOTFOUND",
    "ECONNRESET",
    "ECONNREFUSED",
    "ECONNABORTED",
    "EPIPE",
    "ETIMEDOUT",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "ENETDOWN",
    "EAI_FAIL",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_HEADERS_TIMEOUT",
    "UND_ERR_BODY_TIMEOUT",
    "UND_ERR_SOCKET",
    // `UND_ERR_RESPONSE_STATUS_CODE` est volontairement absent : il signale une
    // réponse HTTP non-2xx, pas une panne réseau. Le classer transitoire
    // masquerait un 500 permanent au canal de supervision.
]);

/**
 * Codes d'API Discord sans action corrective possible côté bot.
 * 10003 salon inconnu, 10004 serveur inconnu, 10008 message inconnu,
 * 10013 utilisateur inconnu, 10062 interaction inconnue (expirée),
 * 40060 interaction déjà acquittée, 50001 accès manquant,
 * 50007 MP fermés, 50013 permissions manquantes.
 */
const IGNORABLE_DISCORD_CODES: ReadonlySet<number> = new Set([
    10003, 10004, 10008, 10013, 10062, 40060, 50001, 50007, 50013,
]);

/**
 * Extrait le code d'erreur d'une valeur inconnue levée par une API tierce.
 * @param error Valeur capturée (pas nécessairement une `Error`).
 * @returns Le champ `code` s'il est une chaîne ou un nombre, sinon `null`.
 */
function errorCode(error: unknown): string | number | null {
    if (typeof error !== "object" || error === null) return null;
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" || typeof code === "number") return code;
    return null;
}

/** Profondeur maximale explorée dans la chaîne `cause`. */
const MAX_CAUSE_DEPTH = 8;

/**
 * Indique si l'erreur traduit une indisponibilité réseau passagère.
 *
 * La chaîne `cause` est suivie sur une profondeur bornée : deux erreurs qui se
 * citent mutuellement — ce que produisent certaines couches de retry —
 * feraient sinon déborder la pile, et ce depuis l'intérieur même du
 * gestionnaire d'`unhandledRejection`.
 *
 * @param error Valeur capturée.
 * @param depth Profondeur courante dans la chaîne de causes.
 * @returns `true` pour une coupure DNS/TCP transitoire.
 */
function isTransientNetworkError(error: unknown, depth: number = 0): boolean {
    const code = errorCode(error);
    if (typeof code === "string" && TRANSIENT_NETWORK_CODES.has(code)) return true;
    if (depth >= MAX_CAUSE_DEPTH) return false;

    // Certaines couches (undici, node-fetch) enveloppent l'erreur d'origine
    // sans recopier son `code` : on suit la chaîne de causes.
    if (typeof error === "object" && error !== null && "cause" in error) {
        const cause = (error as { cause?: unknown }).cause;
        if (cause && cause !== error) return isTransientNetworkError(cause, depth + 1);
    }
    return false;
}

/**
 * Indique si l'erreur Discord est sans conséquence (cible disparue ou hors de portée).
 * @param error Valeur capturée.
 * @returns `true` pour un code d'API Discord connu comme non actionnable.
 */
function isIgnorableDiscordError(error: unknown): boolean {
    const code = errorCode(error);
    return typeof code === "number" && IGNORABLE_DISCORD_CODES.has(code);
}

/**
 * Produit une description lisible d'une valeur levée, quelle que soit sa forme.
 * @param error Valeur capturée.
 * @returns Message d'erreur, éventuellement suffixé du code.
 */
function describeError(error: unknown): string {
    if (error instanceof Error) {
        const code = errorCode(error);
        return code === null ? error.message : `${error.message} [${code}]`;
    }
    if (typeof error === "string") return error;
    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
}

/** Gravité retenue pour une erreur, qui décide de sa destination. */
type ErrorSeverity = "transient" | "ignorable" | "fatal";

/**
 * Classe une erreur pour décider où la journaliser.
 * @param error Valeur capturée.
 * @returns `transient` (réseau), `ignorable` (objet Discord disparu) ou `fatal`.
 */
function classifyError(error: unknown): ErrorSeverity {
    if (isTransientNetworkError(error)) return "transient";
    if (isIgnorableDiscordError(error)) return "ignorable";
    return "fatal";
}

export {
    classifyError,
    MAX_CAUSE_DEPTH,
    describeError,
    errorCode,
    isIgnorableDiscordError,
    isTransientNetworkError,
    IGNORABLE_DISCORD_CODES,
    TRANSIENT_NETWORK_CODES,
    type ErrorSeverity,
};
