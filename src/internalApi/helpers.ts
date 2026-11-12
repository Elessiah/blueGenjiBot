import { createHash, timingSafeEqual } from "node:crypto";
import type { ErrorRequestHandler, Express, NextFunction, Request, Response } from "express";
import { safeErrorDetail } from "../safe/errorGuards.js";

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

/** Refus de la lecture du corps (`express.json()`), par `type` d'erreur. */
const BODY_PARSER_REFUSALS: Readonly<Record<string, InternalErrorReply>> = {
  "entity.parse.failed": { code: "INVALID_JSON", status: 400 },
  "entity.too.large": { code: "PAYLOAD_TOO_LARGE", status: 413 },
  "encoding.unsupported": { code: "UNSUPPORTED_ENCODING", status: 415 },
  "charset.unsupported": { code: "UNSUPPORTED_ENCODING", status: 415 },
  "request.aborted": { code: "REQUEST_ABORTED", status: 400 },
  "request.size.invalid": { code: "INVALID_CONTENT_LENGTH", status: 400 },
};

/** Réponse à une erreur levée hors d'une route. */
export type InternalErrorReply = { code: string; status: number };

/** Réponse à une erreur que rien n'identifie (dont `stream.*`, défaut du serveur). */
const UNEXPECTED_ERROR: InternalErrorReply = { code: "INTERNAL_ERROR", status: 500 };

/** Code générique d'un corps refusé par body-parser sans `type` connu (gzip corrompu…). */
const INVALID_BODY = "INVALID_BODY";

/**
 * Refus de lecture du corps que body-parser lève sans `type` listé : une erreur
 * `http-errors` marquée `expose` (faute du client) au statut 4xx — un flux gzip
 * ou deflate corrompu, par exemple. Une erreur Discord porte un `status` 4xx
 * mais jamais `expose` : elle reste une erreur du serveur.
 * @param expose Champ `expose` de l'erreur.
 * @param status Champ `status` de l'erreur.
 * @returns La réponse, ou `null`.
 */
function exposedClientRefusal(expose: unknown, status: unknown): InternalErrorReply | null {
  return expose === true && typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 499
    ? { code: INVALID_BODY, status }
    : null;
}

/**
 * Code et statut d'une erreur levée hors d'une route : ceux du refus de lecture
 * du corps, `INVALID_BODY` pour un autre refus 4xx exposé de body-parser, sinon
 * `500 INTERNAL_ERROR` — le `status` d'une autre erreur (une erreur Discord en
 * porte un, sans `expose`) n'est jamais repris.
 *
 * @param error Erreur transmise par Express.
 * @returns Code et statut de la réponse.
 */
export function internalErrorReply(error: unknown): InternalErrorReply {
  try {
    const { type, status, expose } = (error ?? {}) as { type?: unknown; status?: unknown; expose?: unknown };
    if (typeof type !== "string" || !Object.hasOwn(BODY_PARSER_REFUSALS, type)) {
      return exposedClientRefusal(expose, status) ?? UNEXPECTED_ERROR;
    }
    // Le statut que body-parser pose avec son `type` : une autre erreur qui reprendrait
    // ce `type` reste une erreur du serveur.
    const refusal = BODY_PARSER_REFUSALS[type];
    return status === refusal.status ? refusal : UNEXPECTED_ERROR;
  } catch {
    // Accesseur qui lève (Proxy révoqué) : jamais une exception dans le gestionnaire.
    return UNEXPECTED_ERROR;
  }
}

/**
 * Ligne de journal d'une erreur levée hors d'une route : son code de réponse et,
 * pour un défaut du serveur, le type de l'erreur et son code — jamais son
 * message ni sa pile, qui peuvent recopier le corps, un nom ou du SQL.
 *
 * @param error Erreur transmise par Express.
 * @returns Ligne à écrire au journal du processus.
 */
export function internalErrorLogLine(error: unknown): string {
  const reply = internalErrorReply(error);
  if (reply !== UNEXPECTED_ERROR) { return `[internalApi] ${reply.code}`; }
  // Type, code et statut filtrés (`safe/errorGuards.ts`), lus sans jamais lever : même
  // forme que les lignes des `catch` des routes.
  return `[internalApi] ${reply.code} (${safeErrorDetail(error)})`;
}

/** Destinations des lignes du gestionnaire d'erreur. */
export type InternalErrorSinks = {
  /** Défaut du serveur (500) : journal d'erreurs du processus. */
  error?: (line: string) => void;
  /** Refus du client (4xx : corps illisible, requête annulée) : niveau avertissement. */
  warn?: (line: string) => void;
  /** Défaut du serveur (500), aussi au salon de logs (`sendLog`) : même ligne, code et type seuls. */
  report?: (line: string) => void;
};

/**
 * Gestionnaire d'erreur Express de l'API interne : un code, jamais la page
 * d'Express ; si la réponse est déjà partie (flux), sa connexion est coupée sans repasser
 * par le gestionnaire d'Express, qui écrirait la pile au journal. Un refus du client
 * (4xx) va au niveau avertissement — un appel annulé par le site n'encombre pas le
 * journal d'erreurs relu après déploiement ; un défaut du serveur (500) va au journal
 * d'erreurs **et** au salon de logs.
 *
 * @param sinks Destinations des lignes (console par défaut, aucun salon de logs).
 * @returns Gestionnaire à monter après toutes les routes.
 */
export function internalErrorHandler(sinks: InternalErrorSinks = {}): ErrorRequestHandler {
  const { error: logError = (line) => console.error(line), warn = (line) => console.warn(line), report } = sinks;
  return (error, _req, res, _next) => {
    const reply = internalErrorReply(error);
    const line = internalErrorLogLine(error);
    if (reply.status >= 500) {
      logError(line);
      // Au mieux : un salon de logs injoignable ne doit pas faire lever le gestionnaire.
      try { report?.(line); } catch { /* journal Discord indisponible */ }
    } else {
      warn(line);
    }
    if (res.writableEnded) {
      // Réponse déjà envoyée en entier (un geste après `res.json` a levé) : le site a
      // sa réponse ; couper la connexion la perdrait si elle attend encore dans le
      // tampon de la socket.
      return;
    }
    if (res.headersSent) {
      // Réponse commencée (flux) : la connexion est coupée, pour que le lecteur voie
      // une réponse tronquée et non une fin normale ; rien ne repart vers Express.
      try { res.destroy(); } catch { /* connexion déjà close */ }
      return;
    }
    res.status(reply.status).json({ error: reply.code });
  };
}

/** Gestionnaire de route, synchrone ou asynchrone. */
type RouteHandler = (req: Request, res: Response) => unknown;

/** Gestionnaire Express quelconque (route ou intergiciel), synchrone ou asynchrone. */
type AnyHandler = (req: Request, res: Response, next: NextFunction) => unknown;

/** Gestionnaires rendus par {@link asyncRoute}, relus par {@link unwrappedRoutes}. */
const WRAPPED_ROUTES = new WeakSet<object>();

/**
 * Enveloppe de {@link asyncRoute}, `next` transmis (un intergiciel l'appelle). Un
 * rejet **après** que le gestionnaire a passé la main (`next()` déjà appelé) ne
 * repasse pas par `next` : la suite de la chaîne répond, un second `next(err)`
 * enverrait un 500 par-dessus sa réponse. Il est seulement journalisé (code et type).
 */
function forwardRejections(handler: AnyHandler): (req: Request, res: Response, next: NextFunction) => void {
  const wrapped = (req: Request, res: Response, next: NextFunction): void => {
    let passed = false;
    const guardedNext: NextFunction = (...args: Parameters<NextFunction>) => {
      passed = true;
      next(...args);
    };
    const forward = (error: unknown): void => {
      if (passed) {
        console.error(internalErrorLogLine(error));
        return;
      }
      passed = true;
      // `next()` sans valeur passe à la route suivante, `next("route")` / `next("router")`
      // aussi : un rejet falsy ou l'une de ces chaînes devient une vraie erreur.
      const usable = Boolean(error) && error !== "route" && error !== "router";
      next(usable ? error : new Error("rejet sans valeur exploitable"));
    };
    try {
      Promise.resolve(handler(req, res, guardedNext)).catch(forward);
    } catch (error) {
      forward(error);
    }
  };
  WRAPPED_ROUTES.add(wrapped);
  return wrapped;
}

/**
 * Enveloppe une route asynchrone pour Express 4, qui ignore la promesse rejetée
 * d'un gestionnaire : le rejet part à `next(err)`, et `internalErrorHandler`
 * répond toujours un code au lieu de laisser la requête du site sans réponse
 * jusqu'à son délai. Un rejet falsy (`null`, `undefined`, `0`, `""`, `false`) ou
 * `"route"` / `"router"` devient une `Error` : `next()` les prendrait pour « route
 * suivante » (404).
 *
 * @param handler Gestionnaire de la route.
 * @returns Gestionnaire Express.
 */
export function asyncRoute(handler: RouteHandler): (req: Request, res: Response, next: NextFunction) => void {
  return forwardRejections(handler);
}

/** Entrée de la pile d'une route d'Express 4. */
type RouteEntry = { handle?: unknown };

/** Couche de la pile interne d'Express 4 (`app._router.stack`), lue sans dépendre de ses types. */
type RouterLayer = {
  route?: { path?: unknown; methods?: Record<string, boolean>; stack?: RouteEntry[] };
  handle?: unknown;
  regexp?: unknown;
};

/** Signalé quand la pile des routes n'est pas où Express 4 la range (autre version). */
export const ROUTER_STACK_NOT_FOUND = "(pile des routes d'Express introuvable)";

/** Pile d'un routeur (application ou `express.Router` monté), `null` si absente. */
function routerStack(router: unknown): RouterLayer[] | null {
  if (router === null || (typeof router !== "object" && typeof router !== "function")) { return null; }
  const stack = (router as { stack?: unknown }).stack;
  return Array.isArray(stack) ? (stack as RouterLayer[]) : null;
}

/** Gestionnaire d'Express qui peut être enveloppé : ni déjà enveloppé, ni gestionnaire d'erreur. */
function isWrappable(handle: unknown): handle is AnyHandler {
  return typeof handle === "function" && !WRAPPED_ROUTES.has(handle) && handle.length <= 3;
}

/** Fonction déclarée `async` (seule promesse repérable sans l'appeler). */
function isAsyncFunction(handle: AnyHandler): boolean {
  return handle.constructor?.name === "AsyncFunction";
}

/**
 * Préfixe de montage d'un `express.Router` (`app.use("/x", router)`), relu dans
 * l'expression qu'Express 4 en tire : `""` à la racine, `"/…"` sinon, ou `"/(?)"`
 * quand le chemin a des paramètres (illisible tel quel).
 */
function mountPrefix(layer: RouterLayer): string {
  const regexp = layer.regexp as { fast_slash?: boolean; source?: unknown } | undefined;
  if (!regexp || regexp.fast_slash || typeof regexp.source !== "string") { return ""; }
  const body = regexp.source.replace(/^\^/, "").replace(/\\\/\?\(\?=\\\/\|\$\)$/, "");
  const path = body.replace(/\\\//g, "/");
  return /^\/[\w\-./]*$/.test(path) ? path : "/(?)";
}

/**
 * Parcourt une pile, routeurs montés compris, et rend `MÉTHODE chemin` de chaque
 * route fautive — gestionnaire final qui n'est pas passé par {@link asyncRoute}, ou
 * intergiciel déclaré `async` nu — et `USE chemin` de chaque intergiciel `async` nu
 * monté par `app.use`. Avec `fix`, **tout** gestionnaire non enveloppé l'est en
 * place, signalé ou non : un intergiciel qui rend une promesse sans être déclaré
 * `async` ne se repère pas sans l'appeler, l'enveloppe le couvre quand même (sans
 * effet sur un intergiciel synchrone : Express rattrapait déjà ce qu'il lève). Un
 * gestionnaire d'erreur (quatre paramètres) n'est jamais touché.
 */
function scanRoutes(stack: RouterLayer[], prefix: string, fix: boolean, found: string[]): void {
  for (const layer of stack) {
    if (layer.route) {
      scanRoute(layer.route, prefix, fix, found);
      continue;
    }
    const nested = routerStack(layer.handle);
    if (nested) {
      scanRoutes(nested, prefix + mountPrefix(layer), fix, found);
      continue;
    }
    const handle = layer.handle;
    if (!isWrappable(handle)) { continue; }
    if (isAsyncFunction(handle)) { found.push(`USE ${prefix + mountPrefix(layer) || "/"}`); }
    if (fix) { layer.handle = forwardRejections(handle); }
  }
}

/** Une route de {@link scanRoutes} : ses entrées enveloppées avec `fix`, elle notée si fautive. */
function scanRoute(route: NonNullable<RouterLayer["route"]>, prefix: string, fix: boolean, found: string[]): void {
  const entries = route.stack ?? [];
  let faulty = false;
  entries.forEach((entry, index) => {
    const handle = entry.handle;
    if (!isWrappable(handle)) { return; }
    if (index === entries.length - 1 || isAsyncFunction(handle)) { faulty = true; }
    if (fix) { entry.handle = forwardRejections(handle); }
  });
  if (!faulty) { return; }
  const methods = Object.keys(route.methods ?? {}).map((method) => method.toUpperCase()).join(",");
  found.push(`${methods} ${prefix}${String(route.path)}`);
}

/** Pile de l'application (Express 4 : `app._router.stack`). */
function appStack(app: Express): RouterLayer[] | null {
  return routerStack((app as unknown as { _router?: unknown })._router);
}

/**
 * Routes dont un gestionnaire n'est pas passé par {@link asyncRoute} : Express 4 y
 * laisserait un rejet sans réponse jusqu'au délai du site. Les tests des routes
 * exigent une liste vide. Une pile introuvable (autre version d'Express) rend
 * {@link ROUTER_STACK_NOT_FOUND} plutôt qu'une liste vide trompeuse.
 *
 * @param app Application Express, routes montées.
 * @returns `MÉTHODE chemin` de chaque route fautive.
 */
export function unwrappedRoutes(app: Express): string[] {
  const stack = appStack(app);
  if (!stack) { return [ROUTER_STACK_NOT_FOUND]; }
  const found: string[] = [];
  scanRoutes(stack, "", false, found);
  return found;
}

/**
 * Enveloppe d'office les routes oubliées ({@link unwrappedRoutes}) : un rejet y
 * reçoit tout de même une réponse au lieu de laisser le site attendre. Appelé par
 * `startInternalApi` une fois les routes montées, qui journalise la liste rendue.
 *
 * @param app Application Express, routes montées.
 * @returns `MÉTHODE chemin` de chaque route enveloppée (ou {@link ROUTER_STACK_NOT_FOUND}).
 */
export function wrapUnwrappedRoutes(app: Express): string[] {
  const stack = appStack(app);
  if (!stack) { return [ROUTER_STACK_NOT_FOUND]; }
  const found: string[] = [];
  scanRoutes(stack, "", true, found);
  return found;
}
