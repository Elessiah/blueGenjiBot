/**
 * Relais des annonces GETI vers le site : chaque annonce des six salons
 * sources (`getiPayload.ts`) — écrite directement par un membre, ou relayée
 * par GETI Bot — est poussée au site à sa création et à sa modification,
 * retirée à sa suppression (seule ou en masse), et la fenêtre de garde de
 * chaque salon (7 jours pour les scrims, 14 pour les autres) est rattrapée au
 * démarrage et à chaque nouvelle session Discord — avec, par salon, la liste
 * des annonces encore présentes (lues dans l'historique ou poussées en direct
 * pendant le rattrapage), pour que le site retire celles supprimées, ou qui ont
 * cessé d'être des annonces, pendant que le bot n'écoutait pas.
 *
 * Sur Discord le relais n'écrit rien. Son journal (pm2) ne porte que des
 * nombres et des identifiants de salon : jamais un pseudo, jamais un texte.
 * Site injoignable : les envois sont réessayés (`getiQueue.ts`), puis
 * abandonnés ; un rattrapage complet est alors relancé plus tard.
 */

import type { Client, Message, PartialMessage } from "discord.js";

import { readBanVerdict } from "../check/checkBan.js";
import { siteConfig } from "../tournament/siteStaffMessage.js";
import {
  batchGetiPosts,
  GETI_CHANNELS,
  GETI_DELETE_MAX_IDS,
  getiRetentionMs,
  isGetiChannel,
  isGetiPost,
  toGetiWirePost,
  type GetiChannel,
  type GetiSourceMessage,
} from "./getiPayload.js";
import { GetiQueue, type GetiDelivery } from "./getiQueue.js";
import { sendGetiOp, type GetiSiteOp } from "./getiSiteClient.js";

/** Messages par page de l'historique (le plus que Discord rende). */
export const GETI_PAGE_SIZE = 100;
/** Pages lues par salon au plus (5 000 messages) : au-delà, la fenêtre réconciliée s'arrête là. */
export const GETI_BACKFILL_MAX_PAGES = 50;
/** Pause entre deux pages d'historique : le rattrapage ne presse pas l'API de Discord. */
export const GETI_PAGE_DELAY_MS = 750;
/** Marge sous l'instant du rattrapage : un message arrivé en direct à cette seconde n'est pas réconcilié. */
export const GETI_RECONCILE_MARGIN_MS = 2_000;
/** Un rattrapage rendu nécessaire par des envois perdus est retenté à ce rythme. */
export const GETI_RESYNC_INTERVAL_MS = 5 * 60_000;
/**
 * Refus de Discord qu'un nouvel essai ne lèvera pas : salon inconnu, accès ou
 * permission manquants (`Voir le salon`, `Voir les anciens messages`). Le
 * salon est laissé de côté sans rattrapage dû : il n'est relu qu'au prochain
 * rattrapage venu d'ailleurs (nouvelle session Discord, envoi perdu ou échec
 * passager d'un autre salon).
 */
const PERMANENT_DISCORD_CODES = new Set(["10003", "50001", "50013", "GETI_CHANNEL_NOT_TEXT"]);

export type GetiRelayDeps = {
  queue: Pick<GetiQueue, "enqueue">;
  /** Une page d'historique d'un salon, avant `before` ; lève si le salon est illisible. */
  fetchPage: (channelId: string, before?: string) => Promise<GetiSourceMessage[]>;
  /**
   * L'auteur d'une annonce directe est-il exclu du relais (`Ban`) ? Ses
   * annonces ne partent pas vers le site. Une base illisible rend `null` :
   * l'annonce part (le site reste fidèle au salon, que la modération tient),
   * et ce verdict n'est pas gardé pour les annonces suivantes du rattrapage.
   */
  isExcluded?: (authorId: string) => Promise<boolean | null>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
};

/** Bilan du rattrapage d'un salon ; `lost` : un lot n'a pas atteint le site (le reste du rattrapage attend). */
type ChannelBackfill = { posts: number; complete: boolean; lost: boolean };

/** Ce qui a été lu de l'historique d'un salon. */
type ChannelHistory = { ids: string[]; posts: number; delivered: boolean; since: number };

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms).unref(); });
}

function errorLabel(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" || typeof code === "number") { return String(code); }
  if (error instanceof Error) { return error.message === "GETI_CHANNEL_NOT_TEXT" ? error.message : error.name; }
  return typeof error;
}

export class GetiRelay {
  private readonly deps: GetiRelayDeps;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly log: (line: string) => void;
  private readonly isExcluded: (authorId: string) => Promise<boolean | null>;
  /** Rattrapage en cours, partagé par ceux qui le demandent pendant qu'il tourne. */
  private running: Promise<void> | null = null;
  /** Un rattrapage a été demandé pendant celui qui tourne : il sera rejoué à sa suite. */
  private rerun = false;
  /** Des envois ont été perdus : un rattrapage complet est dû. */
  private resyncNeeded = false;
  /** Salons dont la lecture a échoué passagèrement : seuls eux sont relus au rattrapage dû (les autres ont été remis). */
  private readonly resyncChannels = new Set<string>();
  /**
   * Messages supprimés de Discord pendant le rattrapage : ni repoussés, ni
   * comptés présents. Discord ne rend jamais un message supprimé : la marque
   * tient jusqu'à la fin du rattrapage, même si une relecture tardive du
   * message arrive après sa suppression.
   */
  private deletedDuringBackfill: Set<string> | null = null;
  /**
   * Messages modifiés en direct, pendant le rattrapage, en autre chose qu'une
   * annonce (relais changé en avis) : ni repoussés, ni comptés présents, sauf
   * s'ils redeviennent une annonce.
   */
  private retractedDuringBackfill: Set<string> | null = null;
  /** Relectures de messages partiels en cours, par identifiant : une suppression arrivée entre-temps les annule. */
  private readonly loading = new Map<string, Set<{ deleted: boolean }>>();
  /**
   * Messages créés ou modifiés en direct pendant le rattrapage : leur version
   * en direct est la plus récente, la page d'historique lue avant ne la
   * repousse pas (une modification qui vide l'annonce la retire du site, que
   * l'ancienne version relue rétablirait sinon). Chacun, avec son salon, compte
   * présent à la réconciliation, même si sa page d'historique a été lue quand il
   * n'était pas encore (ou plus) une annonce.
   */
  private updatedDuringBackfill: Map<string, string> | null = null;

  constructor(deps: GetiRelayDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? defaultSleep;
    this.log = deps.log ?? ((line) => { console.log(line); });
    this.isExcluded = deps.isExcluded ?? (async () => false);
  }

  /**
   * Verdicts d'exclusion lus dans l'historique pendant le rattrapage en cours,
   * par auteur : un auteur de plusieurs annonces n'est lu qu'une fois par
   * rattrapage. Un verdict illisible n'y reste pas ; les messages en direct ne
   * le lisent pas (une exclusion ou une levée prononcée entre-temps vaut pour eux).
   */
  private backfillExclusions: Map<string, Promise<boolean | null>> | null = null;

  /**
   * Une annonce à pousser : `isGetiPost`, et pas l'annonce directe d'un exclu du relais.
   * @param message Message lu.
   * @param fromHistory Vrai pour une page d'historique du rattrapage (verdicts gardés le temps du rattrapage).
   */
  private async isRelayed(message: GetiSourceMessage, fromHistory: boolean): Promise<boolean> {
    if (!isGetiPost(message)) { return false; }
    const author = message.author;
    if (author?.bot === true) { return true; }
    const authorId = author?.id ?? "";
    const cache = fromHistory ? this.backfillExclusions : null;
    if (cache === null) { return (await this.isExcluded(authorId)) !== true; }
    let verdict = cache.get(authorId);
    if (verdict === undefined) {
      verdict = this.isExcluded(authorId);
      cache.set(authorId, verdict);
    }
    const read = verdict;
    const excluded = await read;
    // Base illisible : l'annonce part, mais la suivante du même auteur relit la base.
    if (excluded === null && cache.get(authorId) === read) { cache.delete(authorId); }
    return excluded !== true;
  }

  /** Une exclusion vient d'être prononcée ou levée : les verdicts du rattrapage en cours sont relus. */
  forgetExclusions(): void {
    this.backfillExclusions?.clear();
  }

  /** Marque une lecture en cours du message : une suppression arrivée pendant qu'elle attend l'annule. */
  private track(id: string): { deleted: boolean } {
    const pending = { deleted: false };
    const waiting = this.loading.get(id) ?? new Set<{ deleted: boolean }>();
    waiting.add(pending);
    this.loading.set(id, waiting);
    return pending;
  }

  private untrack(id: string, pending: { deleted: boolean }): void {
    const waiting = this.loading.get(id);
    if (waiting === undefined) { return; }
    waiting.delete(pending);
    if (waiting.size === 0) { this.loading.delete(id); }
  }

  /** Les annonces à pousser d'une page, dans son ordre. */
  private async relayedOf(messages: readonly GetiSourceMessage[]): Promise<GetiSourceMessage[]> {
    const wanted: GetiSourceMessage[] = [];
    for (const message of messages) {
      if (await this.isRelayed(message, true)) { wanted.push(message); }
    }
    return wanted;
  }

  /**
   * La relecture d'un message a échoué autrement que parce qu'il a disparu
   * (panne passagère de Discord) : son salon est relu au passage des cinq
   * minutes, pour qu'une modification manquée ne laisse pas l'ancienne version
   * sur le site.
   * @param channelId Salon du message.
   */
  noteChannelLost(channelId: string): void {
    if (!isGetiChannel(channelId)) { return; }
    if (!this.resyncChannels.has(channelId)) { this.log(`[geti] message du salon ${channelId} non relu : salon relu plus tard`); }
    this.resyncChannels.add(channelId);
  }

  /** Un envoi a été perdu (site muet, file pleine) : un rattrapage est dû. */
  noteLost(): void {
    if (!this.resyncNeeded) { this.log("[geti] envoi au site abandonné : rattrapage différé"); }
    this.resyncNeeded = true;
  }

  /** Vrai tant qu'un rattrapage est dû. */
  get needsResync(): boolean {
    return this.resyncNeeded || this.resyncChannels.size > 0;
  }

  /**
   * Passage périodique : relance le rattrapage dû, s'il ne tourne pas déjà. Un
   * envoi perdu relit les six salons ; une lecture passagèrement échouée ne
   * relit que son salon (les cinq autres ne sont pas renvoyés au site toutes
   * les cinq minutes pour rien).
   */
  async tick(): Promise<void> {
    if (this.needsResync && this.running === null) { await this.launch("due"); }
  }

  /**
   * Message créé ou modifié dans un salon source : poussé au site s'il est une
   * annonce (membre ou GETI Bot). Une modification qui en fait autre chose
   * qu'une annonce (un relais de GETI Bot changé en avis) la retire du site,
   * qui ignore l'identifiant s'il ne le gardait pas.
   * @param message Message complet (un message partiel est d'abord relu par l'appelant).
   * @param edited Vrai pour une modification.
   */
  async onMessage(message: GetiSourceMessage, edited = false): Promise<void> {
    // Supprimé de Discord pendant le rattrapage : une version reçue après coup est périmée.
    if (this.deletedDuringBackfill?.has(message.id)) { return; }
    // La lecture de l'exclusion attend la base : une suppression arrivée pendant ce temps l'emporte
    // (sinon l'annonce, déjà retirée du site, y serait repoussée après coup).
    const pending = this.track(message.id);
    let relayed: boolean;
    try {
      relayed = await this.isRelayed(message, false);
    } finally {
      this.untrack(message.id, pending);
    }
    if (pending.deleted) { return; }
    if (!relayed) {
      if (edited) { await this.retract(message.channelId, message.id); }
      return;
    }
    // Redevenu une annonce (relais changé en avis, puis rétabli) : il n'est plus retiré.
    this.retractedDuringBackfill?.delete(message.id);
    this.updatedDuringBackfill?.set(message.id, message.channelId);
    await this.deps.queue.enqueue({ kind: "upsert", posts: [toGetiWirePost(message)] });
  }

  /**
   * Message reçu de Discord, à relire d'abord s'il est partiel : une
   * suppression arrivée pendant la relecture l'emporte (la réponse de Discord,
   * partie avant la suppression, ne repousse pas une annonce disparue).
   * @param id Identifiant du message.
   * @param load Relecture du message ; `null` s'il a disparu.
   * @param edited Vrai pour une modification.
   */
  async onLoadedMessage(id: string, load: () => Promise<GetiSourceMessage | null>, edited: boolean): Promise<void> {
    const pending = this.track(id);
    let message: GetiSourceMessage | null;
    try {
      message = await load();
    } finally {
      this.untrack(id, pending);
    }
    if (message !== null && !pending.deleted) { await this.onMessage(message, edited); }
  }

  /** Message changé en autre chose qu'une annonce : retiré du site, et réconcilié comme absent. */
  private async retract(channelId: string, id: string): Promise<void> {
    if (!isGetiChannel(channelId)) { return; }
    this.retractedDuringBackfill?.add(id);
    this.updatedDuringBackfill?.delete(id);
    await this.deps.queue.enqueue({ kind: "delete", ids: [id] });
  }

  /**
   * Messages supprimés (un seul, ou en masse) : retirés du site. L'auteur d'un
   * message supprimé hors cache n'est pas connu : tout identifiant du salon est
   * transmis, le site ignore ceux qu'il ne garde pas.
   * @param channelId Salon des messages.
   * @param ids Identifiants des messages supprimés.
   */
  async onDelete(channelId: string, ids: readonly string[]): Promise<void> {
    if (!isGetiChannel(channelId) || ids.length === 0) { return; }
    for (const id of ids) {
      this.deletedDuringBackfill?.add(id);
      this.retractedDuringBackfill?.delete(id);
      this.updatedDuringBackfill?.delete(id);
      for (const pending of this.loading.get(id) ?? []) { pending.deleted = true; }
    }
    const sends: Promise<GetiDelivery>[] = [];
    for (let start = 0; start < ids.length; start += GETI_DELETE_MAX_IDS) {
      sends.push(this.deps.queue.enqueue({ kind: "delete", ids: ids.slice(start, start + GETI_DELETE_MAX_IDS) }));
    }
    await Promise.all(sends);
  }

  /**
   * Rattrape la fenêtre de garde des six salons. Un seul parcours à la fois :
   * une demande faite pendant qu'il tourne le fait rejouer à sa suite (une
   * nouvelle session Discord a pu manquer des événements entre-temps).
   */
  backfill(): Promise<void> {
    return this.launch("all");
  }

  private launch(scope: "all" | "due"): Promise<void> {
    if (this.running !== null) {
      if (scope === "all") { this.rerun = true; }
      return this.running;
    }
    const run = this.backfillLoop(scope).finally(() => { this.running = null; });
    this.running = run;
    return run;
  }

  private async backfillLoop(scope: "all" | "due"): Promise<void> {
    let next = scope;
    do {
      this.rerun = false;
      await this.backfillOnce(next);
      next = "all";
    } while (this.rerun);
  }

  private async backfillOnce(scope: "all" | "due"): Promise<void> {
    // Rattrapage dû par la seule lecture manquée de quelques salons : eux seuls sont relus.
    const only = scope === "due" && !this.resyncNeeded ? new Set(this.resyncChannels) : null;
    const wanted = GETI_CHANNELS.filter((channel) => only === null || only.has(channel.id));
    this.resyncNeeded = false;
    this.resyncChannels.clear();
    this.deletedDuringBackfill = new Set();
    this.retractedDuringBackfill = new Set();
    this.updatedDuringBackfill = new Map();
    this.backfillExclusions = new Map();
    let posts = 0;
    let channels = 0;
    try {
      for (const channel of wanted) {
        const result = await this.backfillChannel(channel);
        posts += result.posts;
        if (result.complete) { channels += 1; }
        // Site injoignable : lire le reste de l'historique ne ferait que perdre ses lots ; le rattrapage dû reprendra tout.
        if (result.lost) { break; }
      }
    } finally {
      this.deletedDuringBackfill = null;
      this.retractedDuringBackfill = null;
      this.updatedDuringBackfill = null;
      this.backfillExclusions = null;
    }
    this.log(`[geti] rattrapage : ${posts} message(s) poussé(s), ${channels}/${wanted.length} salon(s) réconcilié(s)`);
  }

  /** Lit l'historique d'un salon sur sa fenêtre de garde, pousse ses annonces, puis réconcilie. */
  private async backfillChannel(channel: GetiChannel): Promise<ChannelBackfill> {
    const started = this.now();
    const history = await this.readHistory(channel, started - getiRetentionMs(channel));
    if (history === null) { return { posts: 0, complete: false, lost: false }; }
    if (!history.delivered) { return { posts: history.posts, complete: false, lost: true }; }
    const gone = new Set([...(this.deletedDuringBackfill ?? []), ...(this.retractedDuringBackfill ?? [])]);
    const present = new Set(history.ids);
    for (const [id, channelId] of this.updatedDuringBackfill ?? []) {
      if (channelId === channel.id) { present.add(id); }
    }
    const reconciled = await this.deps.queue.enqueue({
      kind: "reconcile",
      channelId: channel.id,
      since: new Date(history.since).toISOString(),
      until: new Date(started - GETI_RECONCILE_MARGIN_MS).toISOString(),
      ids: [...present].filter((id) => !gone.has(id)),
    });
    return { posts: history.posts, complete: reconciled === "ok", lost: reconciled === "lost" };
  }

  /**
   * Parcourt l'historique d'un salon, du plus récent jusqu'à `windowStart`, en
   * poussant chaque page ; `null` si le salon est illisible.
   */
  private async readHistory(channel: GetiChannel, windowStart: number): Promise<ChannelHistory | null> {
    const history: ChannelHistory = { ids: [], posts: 0, delivered: true, since: windowStart };
    let before: string | undefined;
    for (let page = 0; ; page += 1) {
      const messages = await this.readPage(channel, before, page === 0);
      if (messages === null) { return null; }
      const inWindow = messages.filter((message) => message.createdTimestamp >= windowStart);
      const wanted = await this.relayedOf(inWindow);
      // Seules les annonces comptent présentes : un message qui n'en est plus une (relais changé en avis) est retiré du site.
      for (const message of wanted) { history.ids.push(message.id); }
      const pushed = await this.pushBackfillPage(wanted);
      history.delivered = pushed.delivered;
      history.posts += pushed.posts;
      // Un lot perdu : le site ne répond plus, la suite de l'historique attend le rattrapage dû.
      if (!history.delivered) { return history; }
      if (messages.length < GETI_PAGE_SIZE || inWindow.length < messages.length) { return history; }
      const oldest = messages.reduce((a, b) => (a.createdTimestamp <= b.createdTimestamp ? a : b));
      if (page + 1 >= GETI_BACKFILL_MAX_PAGES) {
        // Plafond atteint : seule la partie lue est réconciliée (une seconde de marge au bord).
        history.since = oldest.createdTimestamp + 1_000;
        return history;
      }
      before = oldest.id;
      await this.sleep(GETI_PAGE_DELAY_MS);
    }
  }

  /** Une page d'historique ; `null` si le salon est illisible (échec noté pour le rattrapage dû), ou rendu vide dès la première page. */
  private async readPage(channel: GetiChannel, before: string | undefined, first: boolean): Promise<GetiSourceMessage[] | null> {
    let messages: GetiSourceMessage[];
    try {
      messages = await this.deps.fetchPage(channel.id, before);
    } catch (error) {
      const label = errorLabel(error);
      this.log(`[geti] salon ${channel.id} illisible (${label}) : rattrapage du salon abandonné`);
      if (!PERMANENT_DISCORD_CODES.has(label)) { this.resyncChannels.add(channel.id); }
      return null;
    }
    // Une première page vide n'est pas une preuve : un salon que Discord rend vide un instant ferait
    // retirer du site toutes ses annonces par la réconciliation. Rien n'est réconcilié ; le prochain rattrapage tranche.
    if (first && messages.length === 0) {
      this.log(`[geti] salon ${channel.id} rendu vide : rattrapage du salon laissé de côté`);
      return null;
    }
    return messages;
  }

  /**
   * Pousse une page d'historique par lots ; `delivered` faux si un lot a été
   * perdu, `posts` ne compte que les annonces des lots remis.
   */
  private async pushBackfillPage(messages: readonly GetiSourceMessage[]): Promise<{ delivered: boolean; posts: number }> {
    let posts = 0;
    for (const batch of batchGetiPosts(messages.map((message) => toGetiWirePost(message)))) {
      const gone = this.deletedDuringBackfill;
      const retracted = this.retractedDuringBackfill;
      const live = this.updatedDuringBackfill;
      const kept = batch.filter((post) => !gone?.has(post.id) && !retracted?.has(post.id) && !live?.has(post.id));
      // Tout le lot a changé en direct : rien à renvoyer, ni d'appel au site qui pourrait se perdre.
      if (kept.length === 0) { continue; }
      if ((await this.deps.queue.enqueue({ kind: "upsert", posts: kept })) === "lost") {
        return { delivered: false, posts };
      }
      posts += kept.length;
    }
    return { delivered: true, posts };
  }
}

/** Lit une page d'historique d'un salon ; lève si le salon n'est pas un salon de texte lisible. */
async function fetchChannelPage(client: Client, channelId: string, before?: string): Promise<GetiSourceMessage[]> {
  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased()) { throw new Error("GETI_CHANNEL_NOT_TEXT"); }
  const page = await channel.messages.fetch({ limit: GETI_PAGE_SIZE, before, cache: false });
  return [...page.values()];
}

/** Discord : message inconnu (supprimé entre l'événement et sa relecture). */
const UNKNOWN_MESSAGE_CODE = 10008;

/**
 * Message complet : un message partiel (hors cache) est relu ; `null` s'il a
 * disparu entre-temps. Tout autre échec (panne passagère) lève : l'appelant
 * fait relire le salon plus tard.
 */
async function fullMessage(message: Message | PartialMessage): Promise<Message | null> {
  if (!message.partial) { return message; }
  try {
    return await message.fetch();
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === UNKNOWN_MESSAGE_CODE) { return null; }
    throw error;
  }
}

function logFailure(scope: string, error: unknown): void {
  console.error(`[geti] ${scope} : ${errorLabel(error)}`);
}

/** Ce que `/ban` et `/unban` demandent au relais branché. */
export type GetiResyncTarget = Pick<GetiRelay, "backfill" | "forgetExclusions">;

/** Relais branché par {@link registerGetiRelay} (aucun sans configuration du site). */
let activeRelay: GetiResyncTarget | null = null;

/**
 * Désigne le relais que {@link requestGetiResync} relance ({@link registerGetiRelay}
 * le fait ; les tests y branchent un double).
 * @param relay Relais branché, ou `null` pour n'en garder aucun.
 */
export function bindGetiRelay(relay: GetiResyncTarget | null): void {
  activeRelay = relay;
}

/**
 * Un membre vient d'être exclu du relais (`/ban`) ou réadmis (`/unban`) : les
 * verdicts d'exclusion du rattrapage en cours sont oubliés, et un rattrapage
 * complet retire du site ses annonces directes, ou les y remet. Sans relais
 * branché, rien n'est fait ; un échec n'est que journalisé (pm2).
 */
export function requestGetiResync(): void {
  if (activeRelay === null) { return; }
  activeRelay.forgetExclusions();
  activeRelay.backfill().catch((error: unknown) => { logFailure("rattrapage après exclusion", error); });
}

/**
 * Branche le relais sur le client : écoute des quatre événements de message,
 * et passage périodique pour le rattrapage dû. Sans `SITE_INTERNAL_URL` ni
 * `SITE_INTERNAL_TOKEN`, rien n'est branché.
 *
 * Chaque écouteur a sa propre garde et ne journalise que dans pm2 — le relais
 * n'écrit rien sur Discord, pas même une erreur.
 * @param client Client Discord (avant ou après connexion).
 * @param env Environnement du processus.
 * @returns Le relais, à lancer par `backfill()` une fois le client prêt ; `null` s'il n'est pas configuré.
 */
export function registerGetiRelay(client: Client, env: NodeJS.ProcessEnv = process.env): GetiRelay | null {
  const config = siteConfig(env);
  if (!config) {
    console.log("[geti] relais des annonces inactif : SITE_INTERNAL_URL ou SITE_INTERNAL_TOKEN absent");
    return null;
  }
  const holder: { relay: GetiRelay | null } = { relay: null };
  const queue = new GetiQueue({
    send: (op: GetiSiteOp) => sendGetiOp(config, op),
    onLost: () => { holder.relay?.noteLost(); },
  });
  const relay = new GetiRelay({
    queue,
    fetchPage: (channelId, before) => fetchChannelPage(client, channelId, before),
    isExcluded: async (authorId) => {
      const verdict = await readBanVerdict(authorId);
      return verdict === "UNKNOWN" ? null : verdict === "BANNED";
    },
  });
  holder.relay = relay;
  bindGetiRelay(relay);

  const push = async (message: Message | PartialMessage, edited: boolean): Promise<void> => {
    try {
      if (!isGetiChannel(message.channelId)) { return; }
      await relay.onLoadedMessage(message.id, () => fullMessage(message), edited);
    } catch (error) {
      relay.noteChannelLost(message.channelId);
      logFailure("message non poussé", error);
    }
  };
  client.on("messageCreate", (message) => { void push(message, false); });
  client.on("messageUpdate", (_old, message) => { void push(message, true); });
  client.on("messageDelete", (message) => {
    relay.onDelete(message.channelId, [message.id]).catch((error: unknown) => { logFailure("suppression non poussée", error); });
  });
  client.on("messageDeleteBulk", (messages, channel) => {
    relay.onDelete(channel.id, [...messages.keys()]).catch((error: unknown) => { logFailure("suppression en masse non poussée", error); });
  });
  // Nouvelle session Discord (et non simple reprise) : des événements ont pu manquer.
  client.on("shardReady", () => {
    if (client.isReady()) { relay.backfill().catch((error: unknown) => { logFailure("rattrapage", error); }); }
  });
  setInterval(() => {
    relay.tick().catch((error: unknown) => { logFailure("rattrapage différé", error); });
  }, GETI_RESYNC_INTERVAL_MS).unref();
  return relay;
}
