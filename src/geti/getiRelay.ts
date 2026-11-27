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
 * salon est laissé de côté jusqu'au prochain démarrage, sans rattrapage en boucle.
 */
const PERMANENT_DISCORD_CODES = new Set(["10003", "50001", "50013", "GETI_CHANNEL_NOT_TEXT"]);

export type GetiRelayDeps = {
  queue: Pick<GetiQueue, "enqueue">;
  /** Une page d'historique d'un salon, avant `before` ; lève si le salon est illisible. */
  fetchPage: (channelId: string, before?: string) => Promise<GetiSourceMessage[]>;
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
  /** Rattrapage en cours, partagé par ceux qui le demandent pendant qu'il tourne. */
  private running: Promise<void> | null = null;
  /** Un rattrapage a été demandé pendant celui qui tourne : il sera rejoué à sa suite. */
  private rerun = false;
  /** Des envois ont été perdus : un rattrapage complet est dû. */
  private resyncNeeded = false;
  /** Messages supprimés pendant le rattrapage : ni repoussés, ni comptés présents. */
  private deletedDuringBackfill: Set<string> | null = null;
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
  }

  /** Un envoi a été perdu (site muet, file pleine) : un rattrapage est dû. */
  noteLost(): void {
    if (!this.resyncNeeded) { this.log("[geti] envoi au site abandonné : rattrapage différé"); }
    this.resyncNeeded = true;
  }

  /** Vrai tant qu'un rattrapage est dû. */
  get needsResync(): boolean {
    return this.resyncNeeded;
  }

  /** Passage périodique : relance le rattrapage dû, s'il ne tourne pas déjà. */
  async tick(): Promise<void> {
    if (this.resyncNeeded && this.running === null) { await this.backfill(); }
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
    if (!isGetiPost(message)) {
      if (edited) { await this.onDelete(message.channelId, [message.id]); }
      return;
    }
    // Redevenu une annonce (relais changé en avis, puis rétabli) : il n'est plus « supprimé ».
    this.deletedDuringBackfill?.delete(message.id);
    this.updatedDuringBackfill?.set(message.id, message.channelId);
    await this.deps.queue.enqueue({ kind: "upsert", posts: [toGetiWirePost(message)] });
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
      this.updatedDuringBackfill?.delete(id);
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
    if (this.running !== null) {
      this.rerun = true;
      return this.running;
    }
    const run = this.backfillLoop().finally(() => { this.running = null; });
    this.running = run;
    return run;
  }

  private async backfillLoop(): Promise<void> {
    do {
      this.rerun = false;
      await this.backfillOnce();
    } while (this.rerun);
  }

  private async backfillOnce(): Promise<void> {
    this.resyncNeeded = false;
    this.deletedDuringBackfill = new Set();
    this.updatedDuringBackfill = new Map();
    let posts = 0;
    let channels = 0;
    try {
      for (const channel of GETI_CHANNELS) {
        const result = await this.backfillChannel(channel);
        posts += result.posts;
        if (result.complete) { channels += 1; }
        // Site injoignable : lire le reste de l'historique ne ferait que perdre ses lots ; le rattrapage dû reprendra tout.
        if (result.lost) { break; }
      }
    } finally {
      this.deletedDuringBackfill = null;
      this.updatedDuringBackfill = null;
    }
    this.log(`[geti] rattrapage : ${posts} message(s) poussé(s), ${channels}/${GETI_CHANNELS.length} salon(s) réconcilié(s)`);
  }

  /** Lit l'historique d'un salon sur sa fenêtre de garde, pousse ses annonces, puis réconcilie. */
  private async backfillChannel(channel: GetiChannel): Promise<ChannelBackfill> {
    const started = this.now();
    const history = await this.readHistory(channel, started - getiRetentionMs(channel));
    if (history === null) { return { posts: 0, complete: false, lost: false }; }
    if (!history.delivered) { return { posts: history.posts, complete: false, lost: true }; }
    const gone = this.deletedDuringBackfill ?? new Set<string>();
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
      let messages: GetiSourceMessage[];
      try {
        messages = await this.deps.fetchPage(channel.id, before);
      } catch (error) {
        const label = errorLabel(error);
        this.log(`[geti] salon ${channel.id} illisible (${label}) : rattrapage du salon abandonné`);
        if (!PERMANENT_DISCORD_CODES.has(label)) { this.resyncNeeded = true; }
        return null;
      }
      const inWindow = messages.filter((message) => message.createdTimestamp >= windowStart);
      const wanted = inWindow.filter((message) => isGetiPost(message));
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

  /**
   * Pousse une page d'historique par lots ; `delivered` faux si un lot a été
   * perdu, `posts` ne compte que les annonces des lots remis.
   */
  private async pushBackfillPage(messages: readonly GetiSourceMessage[]): Promise<{ delivered: boolean; posts: number }> {
    let posts = 0;
    for (const batch of batchGetiPosts(messages.map((message) => toGetiWirePost(message)))) {
      const gone = this.deletedDuringBackfill;
      const live = this.updatedDuringBackfill;
      const kept = batch.filter((post) => !gone?.has(post.id) && !live?.has(post.id));
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

/** Message complet : un message partiel (hors cache) est relu ; `null` s'il a disparu entre-temps. */
async function fullMessage(message: Message | PartialMessage): Promise<Message | null> {
  if (!message.partial) { return message; }
  try {
    return await message.fetch();
  } catch {
    return null;
  }
}

function logFailure(scope: string, error: unknown): void {
  console.error(`[geti] ${scope} : ${errorLabel(error)}`);
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
  });
  holder.relay = relay;

  const push = async (message: Message | PartialMessage, edited: boolean): Promise<void> => {
    try {
      if (!isGetiChannel(message.channelId)) { return; }
      const full = await fullMessage(message);
      if (full) { await relay.onMessage(full, edited); }
    } catch (error) {
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
