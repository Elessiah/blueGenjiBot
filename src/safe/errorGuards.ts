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


import { DiscordjsErrorCodes } from "discord.js";
import { constants as osConstants } from "node:os";
import * as dns from "node:dns";

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

/** Plus petit code d'erreur JSON de Discord (`10001`) : en dessous, un statut HTTP, un code de `DOMException` (`20` : délai dépassé) ou rien. */
const MIN_DISCORD_JSON_CODE = 10_000;

/**
 * Code d'erreur JSON de Discord porté par l'erreur (`DiscordAPIError` :
 * `50013`, `10003`…), sinon `null`. Un refus **explicite** de Discord : une
 * erreur sans ce code (réseau, `5xx`, délai dépassé) ne dit pas ce qui s'est
 * passé côté Discord.
 * @param error Valeur capturée.
 * @returns Le code, ou `null`.
 */
function discordJsonCode(error: unknown): number | null {
    const code = errorCode(error);
    return typeof code === "number" && code >= MIN_DISCORD_JSON_CODE ? code : null;
}

/**
 * Extrait le code d'erreur d'une valeur inconnue levée par une API tierce.
 * @param error Valeur capturée (pas nécessairement une `Error`).
 * @returns Le champ `code` s'il est une chaîne ou un nombre, sinon `null`.
 */
function errorCode(error: unknown): string | number | null {
    // Lire un objet inconnu peut lever (accesseur, Proxy révoqué) : un code
    // illisible vaut « pas de code », jamais une exception dans un gardien.
    try {
        if (typeof error !== "object" || error === null) return null;
        const code = (error as { code?: unknown }).code;
        if (typeof code === "string" || typeof code === "number") return code;
    } catch { /* illisible */ }
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

/** `Error.isError` (Node 24 et plus), absent des versions antérieures. */
const errorIsError = (Error as unknown as {isError?: (value: unknown) => boolean}).isError;

/**
 * Reconnaît une `Error`, y compris venue d'un autre contexte (vm, worker), où
 * `instanceof` échoue. Remplace `util.types.isNativeError`, déprécié, par sa
 * relève `Error.isError`. Celle-ci absente, une `Error` d'un autre contexte
 * est traitée comme un objet quelconque : décrite par son seul type, jamais
 * par un `message` qu'un objet déguisé (`Symbol.toStringTag`) pourrait porter.
 * @param value Valeur capturée.
 * @returns `true` pour une `Error` native.
 */
function isNativeError(value: unknown): value is Error {
    return value instanceof Error || errorIsError?.(value) === true;
}

/**
 * Produit une description lisible d'une valeur levée, quelle que soit sa forme.
 *
 * Un objet qui n'est pas une `Error` n'est **jamais sérialisé** : levé sur le
 * chemin d'une annonce, il peut porter son texte et le pseudo de son auteur,
 * et cette description part au journal Discord et dans les messages privés
 * du titulaire (`reportError`, `sendLog`). Seul son type est dit. Le message
 * d'une `Error`, lui, est rendu tel quel.
 * @param error Valeur capturée.
 * @returns Message d'erreur (suffixé du code), la chaîne levée, ou le type de la valeur.
 */
function describeError(error: unknown): string {
    try {
        // `isNativeError` reconnaît aussi une `Error` venue d'un autre contexte (vm, worker).
        if (isNativeError(error)) {
            const message = typeof error.message === "string" ? error.message : "(message non textuel)";
            // Une vraie `Error` garde son code (« auth/invalid-token »…) : son
            // message est déjà rendu, filtrer le code ne protégerait rien.
            const code = errorCode(error);
            const shown = typeof code === "number" || (typeof code === "string" && /^\S{1,80}$/.test(code)) ? code : null;
            return shown === null ? message : `${message} [${shown}]`;
        }
        // Une chaîne levée est rendue telle quelle : aucun code du bot ne lève
        // le texte d'une annonce (règle à garder : lever une `Error`).
        if (typeof error === "string") return error;
        // Un scalaire (null, undefined, nombre, booléen, bigint, symbole) ne porte
        // rien d'autre que lui-même : il est rendu tel quel.
        if (error === null || (typeof error !== "object" && typeof error !== "function")) {
            return `valeur levée non standard (${String(error)})`;
        }
        // Un objet : son seul code, et seulement s'il en a la forme (nombre, ou
        // jeton court) — un champ « code » en texte libre pourrait porter n'importe quoi.
        const code = errorCode(error);
        const shown = typeof code === "number" || (typeof code === "string" && /^\w{1,40}$/.test(code)) ? `, code ${code}` : "";
        return `valeur levée non standard (${typeof error}${shown})`;
    } catch {
        // Proxy révoqué, accesseur `message` hostile… : la description ne lève jamais.
        return "valeur levée illisible";
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

/** Code Discord d'un message inconnu : déjà effacé. */
const DISCORD_UNKNOWN_MESSAGE = 10008;

/** Code Discord d'un compte inconnu (supprimé). */
const DISCORD_UNKNOWN_USER = 10013;

/** Code Discord d'un salon inconnu : la conversation n'existe plus. */
const DISCORD_UNKNOWN_CHANNEL = 10003;

/**
 * Codes d'erreur journalisables, par famille connue — jamais par la seule forme :
 * un mot isolé recopié d'une valeur reçue (« EquipeBleue », un sigle « EVIL ») a la
 * forme d'un identifiant. Numérique (Discord `50035`, statut), SQLite (`SQLITE_BUSY`),
 * Node (`ERR_HTTP_HEADERS_SENT`), undici (`UND_ERR_SOCKET`), abandon (`ABORT_ERR`) ;
 * les codes système (`ECONNRESET`, `EAI_AGAIN`) sont, eux, lus dans une liste fermée
 * ({@link SYSTEM_ERROR_CODES}).
 */
const SAFE_ERROR_CODES: readonly RegExp[] = [
    /^\d{1,10}$/,
    /^SQLITE_[A-Z_]{1,40}$/,
    /^ERR_[A-Z0-9_]{3,60}$/,
    /^UND_ERR_[A-Z_]{1,40}$/,
    /^ABORT_ERR$/,
];

/**
 * Codes système journalisables : ceux du système (`os.constants.errno` :
 * `ECONNRESET`, `ETIMEDOUT`…), ceux de la résolution DNS (`EAI_*` de getaddrinfo,
 * `dns` : `ENOTFOUND`, `ECONNREFUSED`…) — une liste fermée, jamais toute
 * majuscule commençant par `E`.
 */
const SYSTEM_ERROR_CODES: ReadonlySet<string> = new Set([
    ...Object.keys(osConstants.errno),
    ...(Object.values(dns) as unknown[]).filter((value): value is string => typeof value === "string" && /^E[A-Z]+$/.test(value)),
    "EAI_ADDRFAMILY", "EAI_AGAIN", "EAI_BADFLAGS", "EAI_BADHINTS", "EAI_CANCELED", "EAI_FAIL",
    "EAI_FAMILY", "EAI_MEMORY", "EAI_NODATA", "EAI_NONAME", "EAI_OVERFLOW", "EAI_PROTOCOL",
    "EAI_SERVICE", "EAI_SOCKTYPE", "EAI_SYSTEM",
    "ENOTFOUND", "ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EPIPE", "ECONNABORTED", "EHOSTUNREACH", "ENETUNREACH",
]);

/**
 * Codes de discord.js (`TokenInvalid`, `GuildMembersTimeout`…) : valeurs fixes de
 * son énumération, jamais recopiées d'une valeur reçue.
 */
const DISCORDJS_ERROR_CODES: ReadonlySet<string> = new Set(Object.values(DiscordjsErrorCodes) as string[]);

/**
 * Type d'une `Error` journalisable : un nom de classe d'erreur (`TypeError`,
 * `DiscordAPIError`, `DOMException`), jamais un mot quelconque.
 */
const SAFE_ERROR_NAME = /^[A-Z][A-Za-z]{0,38}(Error|Exception)$/;

/**
 * Code d'une erreur sûr à journaliser : son `code` s'il appartient à une famille
 * connue ({@link SAFE_ERROR_CODES}) — jamais une phrase ni un mot qui recopierait
 * une valeur reçue.
 * @param error Valeur capturée.
 * @returns Le code, ou `null`.
 */
function safeErrorCode(error: unknown): string | number | null {
    const code = errorCode(error);
    if (code === null) return null;
    if (typeof code === "number") return Number.isFinite(code) ? code : null;
    if (DISCORDJS_ERROR_CODES.has(code) || SYSTEM_ERROR_CODES.has(code)) return code;
    return SAFE_ERROR_CODES.some((pattern) => pattern.test(code)) ? code : null;
}

/**
 * Type d'une erreur sûr à journaliser : le `name` d'une `Error` s'il a la forme d'un
 * identifiant (il se règle à l'exécution), sinon `Error` ; le `typeof` d'une autre valeur.
 * @param error Valeur capturée.
 * @returns Le type de l'erreur.
 */
function safeErrorKind(error: unknown): string {
    try {
        if (!isNativeError(error)) return typeof error;
        // discord.js suffixe le code au nom (`DiscordAPIError[50035]`) : le code se journalise à part.
        const name = String(error.name).replace(/\[\d{1,10}\]$/, "");
        return SAFE_ERROR_NAME.test(name) ? name : "Error";
    } catch {
        return "Error";
    }
}

/**
 * Statut HTTP porté par une erreur (Discord, HTTP), lu sans jamais lever.
 * @param error Valeur capturée.
 * @returns Le statut (100–599), ou `null`.
 */
function safeErrorStatus(error: unknown): number | null {
    try {
        if (typeof error !== "object" || error === null) return null;
        const status = (error as { status?: unknown }).status;
        return typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
    } catch {
        return null;
    }
}

/**
 * Désigne une erreur pour un journal (salon de logs, alerte, pm2) par son type,
 * son code et son statut HTTP filtrés — jamais par son message, qui peut recopier
 * un pseudo cherché, un nom d'équipe ou du SQL. Ne lève jamais (un rejet `null`
 * compris) : forme commune des `catch` des routes de l'API interne.
 * @param error Valeur capturée.
 * @returns `<type>, code <code>[, statut <n>]`.
 */
function safeErrorDetail(error: unknown): string {
    const code = safeErrorCode(error);
    const status = safeErrorStatus(error);
    const shownStatus = status === null ? "" : `, statut ${status}`;
    return `${safeErrorKind(error)}, code ${code ?? "inconnu"}${shownStatus}`;
}

/** Codes Discord d'un accès refusé : une nouvelle tentative n'y changera rien. */
const DISCORD_MISSING_ACCESS = 50001;
const DISCORD_MISSING_PERMISSIONS = 50013;

export {
    DISCORD_UNKNOWN_MESSAGE,
    DISCORD_UNKNOWN_USER,
    DISCORD_UNKNOWN_CHANNEL,
    DISCORD_MISSING_ACCESS,
    DISCORD_MISSING_PERMISSIONS,
    discordJsonCode,
    classifyError,
    MAX_CAUSE_DEPTH,
    describeError,
    errorCode,
    safeErrorCode,
    safeErrorDetail,
    safeErrorKind,
    safeErrorStatus,
    isIgnorableDiscordError,
    isTransientNetworkError,
    IGNORABLE_DISCORD_CODES,
    TRANSIENT_NETWORK_CODES,
    type ErrorSeverity,
};
