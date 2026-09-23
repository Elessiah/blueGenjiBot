import type { Client, Guild, GuildMember } from "discord.js";
import { homeGuildIds } from "@/notifications/notifications.js";

/**
 * Résolution d'un identifiant Discord fourni par l'app web.
 *
 * Extrait de `internalApi.ts` (`POST /internal/auth/resolve`) pour être partagé
 * avec l'envoi de messages privés : les deux ont exactement la même contrainte
 * — l'app connaît un tag, Discord n'accepte qu'un ID — et deux implémentations
 * divergeraient sur les cas fins (legacy `pseudo#1234`, casse, guilde
 * momentanément injoignable).
 *
 * La lecture du tag (`parseDiscordHandle`) et l'ordonnancement de la recherche
 * (`resolutionWaves`, `searchInWaves`) sont **purs** ; seules les fonctions qui
 * interrogent Discord touchent au réseau.
 */

/** Résultat d'une résolution : l'ID trouvé, et par quel biais. */
export interface HandleResolution {
  discordId: string;
  matchedBy: "id" | "tag";
}

/** Identifiant lu : un snowflake, ou un tag à chercher parmi les membres. */
export type ParsedHandle =
  | { kind: "id"; discordId: string }
  | { kind: "tag"; username: string; discriminator: string | null };

type TagHandle = Extract<ParsedHandle, { kind: "tag" }>;

const DISCORD_ID_RE = /^\d{5,32}$/;

/**
 * Délai total accordé à une résolution par tag.
 *
 * Le site abandonne sa demande au bout de 3 s (`BOT_LOGIN_FETCH_TIMEOUT_MS`) :
 * répondre avant lui est la seule façon que la réponse **dise quelque chose**.
 * Au-delà, il n'aurait lu qu'une connexion abandonnée ; à 2,5 s, il reçoit
 * `BOT_RESOLVE_TIMEOUT` avec une demi-seconde pour la traversée du réseau.
 */
export const RESOLVE_BUDGET_MS = 2_500;

/**
 * Recherches de serveur menées de front.
 *
 * Chacune est une requête à la passerelle Discord, plafonnée à 120 envois par
 * minute et par shard : lancer tous les serveurs d'un coup viderait ce budget
 * en quelques connexions. Cinq suffisent à ne plus additionner les latences.
 */
export const RESOLVE_CONCURRENCY = 5;

/**
 * Marge laissée à une recherche de serveur au-delà du délai total.
 *
 * Le délai de `guild.members.fetch` (`time`, deux minutes par défaut) est
 * ramené au temps qui reste, pour qu'une recherche abandonnée ne garde pas son
 * écouteur deux minutes. La marge garantit que c'est le **délai total** qui
 * tombe le premier : une recherche expirée juste avant lui compterait pour un
 * serveur où le joueur n'est pas — donc pour un « introuvable » que personne
 * n'a constaté.
 */
const FETCH_GRACE_MS = 250;

/**
 * La recherche n'a pas abouti dans le délai imparti.
 *
 * Distincte d'une absence : des serveurs n'avaient pas encore répondu, le
 * joueur y est peut-être. La route en fait un `504 BOT_RESOLVE_TIMEOUT`, code
 * que le site connaît déjà — jamais un `404`, qu'il rendrait en « tag
 * introuvable ».
 */
export class HandleResolutionTimeoutError extends Error {
  constructor() {
    super("BOT_RESOLVE_TIMEOUT");
    this.name = "HandleResolutionTimeoutError";
  }
}

/**
 * Lit un identifiant Discord tel que l'app le transmet.
 *
 * Accepte un ID numérique, un `pseudo` (format actuel, unique globalement) et
 * le legacy `pseudo#1234`. Le préfixe `@` est toléré : c'est ce que copie un
 * joueur depuis le client Discord.
 *
 * @param handle Chaîne saisie ou stockée côté site.
 * @returns L'identifiant lu, ou `null` si la chaîne est inexploitable.
 */
export function parseDiscordHandle(handle: string): ParsedHandle | null {
  const trimmed = handle.trim();
  if (trimmed.length === 0) { return null; }
  if (DISCORD_ID_RE.test(trimmed)) { return { kind: "id", discordId: trimmed }; }

  let username = trimmed.replace(/^@/, "");
  let discriminator: string | null = null;
  const hashIdx = username.lastIndexOf("#");
  if (hashIdx > 0 && /^\d{4}$/.test(username.slice(hashIdx + 1))) {
    discriminator = username.slice(hashIdx + 1);
    username = username.slice(0, hashIdx);
  }
  if (username.length === 0) { return null; }

  return { kind: "tag", username, discriminator };
}

/**
 * Dit si un membre porte le tag cherché.
 *
 * Seul le `username` est comparé : `globalName` et le surnom de serveur ne sont
 * **pas** uniques et résoudraient vers le mauvais compte.
 */
function memberMatchesHandle(member: GuildMember, parsed: TagHandle): boolean {
  const uname = member.user.username?.toLowerCase() ?? "";
  if (uname !== parsed.username.toLowerCase()) { return false; }
  return parsed.discriminator === null || member.user.discriminator === parsed.discriminator;
}

/**
 * Cherche un membre d'une guilde par son tag.
 *
 * @param guild Guilde à interroger.
 * @param parsed Tag déjà lu par `parseDiscordHandle`.
 * @param timeMs Délai de la requête à la passerelle ; celui de discord.js
 *   (deux minutes) si absent.
 * @returns Le membre trouvé, ou `null` (guilde injoignable comprise).
 */
export async function findGuildMemberByHandle(
  guild: Guild,
  parsed: TagHandle,
  timeMs?: number,
): Promise<GuildMember | null> {
  let members;
  try {
    members = await guild.members.fetch({
      query: parsed.username,
      limit: 100,
      ...(timeMs === undefined ? {} : { time: timeMs }),
    });
  } catch {
    return null;
  }

  return members.find((m) => memberMatchesHandle(m, parsed)) ?? null;
}

/**
 * Range les serveurs dans l'ordre où les interroger : les serveurs BlueGenji
 * d'abord, puis tous les autres.
 *
 * Presque tous les joueurs du site sont membres d'un serveur BlueGenji : les
 * interroger seuls d'abord les retrouve sans solliciter un seul serveur
 * partenaire. Pur.
 *
 * @param guilds Serveurs du bot.
 * @param homeIds Identifiants des serveurs BlueGenji (`homeGuildIds`).
 * @returns Deux vagues : serveurs BlueGenji, puis les autres (chacune peut être vide).
 */
export function resolutionWaves<G extends { id: string }>(guilds: G[], homeIds: string[]): [G[], G[]] {
  const homes = new Set(homeIds);
  return [
    guilds.filter((guild) => homes.has(guild.id)),
    guilds.filter((guild) => !homes.has(guild.id)),
  ];
}

/** Issue d'une recherche bornée dans le temps. */
export type SearchOutcome<R> =
  | { status: "found"; value: R }
  | { status: "not-found" }
  | { status: "timeout" };

/** Réglages de {@link searchInWaves}. */
export interface SearchOptions {
  /** Délai total, toutes vagues comprises (ms). */
  budgetMs: number;
  /** Recherches menées de front dans une vague. */
  concurrency: number;
  /** Horloge, remplaçable en test. */
  now?: () => number;
}

/**
 * Interroge des éléments vague par vague, quelques-uns de front, jusqu'au
 * premier résultat ou jusqu'à l'échéance.
 *
 * Une vague n'est entamée que si la précédente n'a rien trouvé. Un résultat
 * arrête tout : un tag désigne un seul compte, peu importe quel serveur le
 * rend. Une recherche qui **lève** compte pour « rien ici » — un serveur
 * injoignable ne doit pas faire échouer la résolution.
 *
 * `timeout` n'est rendu que si des recherches étaient encore en cours ou à
 * lancer : une absence constatée partout reste une absence.
 *
 * @param waves Éléments à interroger, par ordre de priorité.
 * @param search Recherche d'un élément ; reçoit le temps qui reste (ms).
 * @param options Délai total et parallélisme.
 * @returns Le premier résultat, l'absence, ou l'échéance.
 */
export async function searchInWaves<T, R>(
  waves: T[][],
  search: (item: T, remainingMs: number) => Promise<R | null>,
  options: SearchOptions,
): Promise<SearchOutcome<R>> {
  const now = options.now ?? Date.now;
  const deadline = now() + options.budgetMs;
  const concurrency = Math.max(1, Math.floor(options.concurrency));

  for (const wave of waves) {
    if (wave.length === 0) { continue; }
    const outcome = await searchWave(wave, search, concurrency, deadline, now);
    if (outcome.status !== "not-found") { return outcome; }
  }
  return { status: "not-found" };
}

/** Une vague de {@link searchInWaves} : un bassin de recherches borné par l'échéance. */
function searchWave<T, R>(
  items: T[],
  search: (item: T, remainingMs: number) => Promise<R | null>,
  concurrency: number,
  deadline: number,
  now: () => number,
): Promise<SearchOutcome<R>> {
  return new Promise((resolve) => {
    const remaining = deadline - now();
    if (remaining <= 0) {
      resolve({ status: "timeout" });
      return;
    }

    let next = 0;
    let active = 0;
    let settled = false;

    const finish = (outcome: SearchOutcome<R>) => {
      if (settled) { return; }
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };

    const launch = () => {
      while (!settled && active < concurrency && next < items.length) {
        const item = items[next++];
        active++;
        Promise.resolve()
          .then(() => search(item, Math.max(0, deadline - now())))
          .then(
            (value) => {
              active--;
              if (value !== null && value !== undefined) {
                finish({ status: "found", value });
              } else {
                launch();
              }
            },
            () => {
              active--;
              launch();
            },
          );
      }
      if (!settled && active === 0 && next >= items.length) {
        finish({ status: "not-found" });
      }
    };

    const timer = setTimeout(() => finish({ status: "timeout" }), remaining);
    launch();
  });
}

/**
 * Résout un identifiant Discord parmi **tous** les serveurs du bot.
 *
 * Sert à la connexion au site (`/internal/auth/resolve`) : un membre d'un
 * serveur partenaire doit pouvoir se connecter sans être sur le serveur
 * BlueGenji. L'envoi de messages privés, lui, se restreint à ce dernier
 * (`deliver.ts`).
 *
 * Les serveurs BlueGenji d'abord, puis les autres, {@link RESOLVE_CONCURRENCY}
 * à la fois, sous un délai total de {@link RESOLVE_BUDGET_MS}. Les serveurs
 * étaient autrefois parcourus **un par un**, sans délai : un tag absent de tous
 * additionnait leurs latences et dépassait le délai du site, qui annonçait
 * alors une panne.
 *
 * Le cache des membres n'est **pas** consulté, bien qu'il soit gratuit : un
 * pseudo peut changer de titulaire pendant une reconnexion où le bot manque la
 * mise à jour, et le cache désignerait alors l'ancien — le code de connexion
 * partirait chez quelqu'un d'autre. Chaque résolution est une recherche fraîche.
 *
 * Un identifiant numérique est rendu tel quel, sans aucune requête.
 *
 * @param client Client Discord.
 * @param handle ID, `pseudo`, ou legacy `pseudo#1234` (préfixe `@` toléré).
 * @param options Délai total et parallélisme (défauts de production).
 * @returns L'ID résolu, ou `null` si aucun membre ne correspond.
 * @throws {HandleResolutionTimeoutError} Des serveurs n'avaient pas répondu à l'échéance.
 */
export async function resolveDiscordHandle(
  client: Client,
  handle: string,
  options: SearchOptions = { budgetMs: RESOLVE_BUDGET_MS, concurrency: RESOLVE_CONCURRENCY },
): Promise<HandleResolution | null> {
  const parsed = parseDiscordHandle(handle);
  if (!parsed) { return null; }
  if (parsed.kind === "id") { return { discordId: parsed.discordId, matchedBy: "id" }; }

  const guilds = [...client.guilds.cache.values()];
  const outcome = await searchInWaves(
    resolutionWaves(guilds, homeGuildIds(process.env)),
    (guild, remainingMs) => findGuildMemberByHandle(guild, parsed, remainingMs + FETCH_GRACE_MS),
    options,
  );

  if (outcome.status === "found") { return { discordId: outcome.value.id, matchedBy: "tag" }; }
  if (outcome.status === "timeout") { throw new HandleResolutionTimeoutError(); }
  return null;
}
