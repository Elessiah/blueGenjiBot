/**
 * File des envois GETI vers le site : un appel à la fois, dans l'ordre des
 * événements Discord (une suppression ne double jamais la création qu'elle
 * suit), avec reprises bornées quand le site ne répond pas.
 *
 * Rien n'est gardé sur disque : ce qui est abandonné (site muet trop
 * longtemps, file pleine) est signalé par `onLost`, et le relais rattrape par
 * un nouveau parcours des salons (`getiRelay.ts`).
 */

import type { GetiSiteOp, GetiSiteOutcome } from "./getiSiteClient.js";

/** Opérations en attente au plus : au-delà, les nouvelles sont abandonnées (le rattrapage les reprendra). */
export const GETI_QUEUE_MAX = 500;
/** Attentes entre deux essais d'un même envoi, puis abandon. */
export const GETI_RETRY_DELAYS_MS: readonly number[] = [2_000, 5_000, 15_000, 30_000];

export type GetiQueueOptions = {
  /** Pousse une opération au site ; ne lève pas. */
  send: (op: GetiSiteOp) => Promise<GetiSiteOutcome>;
  /** Appelé à chaque opération perdue (`lost`) : le relais devra rattraper. */
  onLost: () => void;
  /** Attente entre deux essais (remplacée dans les tests). */
  sleep?: (ms: number) => Promise<void>;
  maxSize?: number;
  retryDelaysMs?: readonly number[];
};

/**
 * Sort d'une opération : `ok` (reçue), `refused` (le site refuse ce corps : la
 * renvoyer ne servirait à rien), `lost` (site muet ou file pleine : à rattraper).
 */
export type GetiDelivery = "ok" | "refused" | "lost";

type Pending = { op: GetiSiteOp; settle: (delivery: GetiDelivery) => void };

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms).unref(); });
}

export class GetiQueue {
  private readonly pending: Pending[] = [];
  private running = false;
  /** Le dernier envoi a épuisé ses essais : les suivants n'en font qu'un, jusqu'au prochain succès. */
  private degraded = false;
  private readonly send: GetiQueueOptions["send"];
  private readonly onLost: () => void;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxSize: number;
  private readonly retryDelaysMs: readonly number[];

  constructor(options: GetiQueueOptions) {
    this.send = options.send;
    this.onLost = options.onLost;
    this.sleep = options.sleep ?? defaultSleep;
    this.maxSize = options.maxSize ?? GETI_QUEUE_MAX;
    this.retryDelaysMs = options.retryDelaysMs ?? GETI_RETRY_DELAYS_MS;
  }

  /** Opérations en attente (hors celle en cours d'envoi). */
  get size(): number {
    return this.pending.length;
  }

  /**
   * Met une opération en file.
   * @param op Lot d'annonces, suppression ou réconciliation.
   * @returns Le sort de l'opération, une fois connu. Ne rejette jamais.
   */
  enqueue(op: GetiSiteOp): Promise<GetiDelivery> {
    if (op.kind === "delete") { this.forgetPendingPosts(new Set(op.ids)); }
    if (this.pending.length >= this.maxSize) {
      this.onLost();
      return Promise.resolve("lost");
    }
    const delivered = new Promise<GetiDelivery>((resolve) => { this.pending.push({ op, settle: resolve }); });
    void this.drain();
    return delivered;
  }

  /** Retire des lots en attente les annonces supprimées entre-temps : elles ne doivent pas reparaître. */
  private forgetPendingPosts(ids: ReadonlySet<string>): void {
    for (const { op } of this.pending) {
      if (op.kind === "upsert") { op.posts = op.posts.filter((post) => !ids.has(post.id)); }
    }
  }

  private async drain(): Promise<void> {
    if (this.running) { return; }
    this.running = true;
    try {
      for (let next = this.pending.shift(); next !== undefined; next = this.pending.shift()) {
        const delivery = await this.deliver(next.op);
        if (delivery === "lost") { this.onLost(); }
        next.settle(delivery);
      }
    } finally {
      this.running = false;
    }
  }

  private async deliver(op: GetiSiteOp): Promise<GetiDelivery> {
    // Un lot vidé par une suppression n'a plus rien à dire au site.
    if (op.kind === "upsert" && op.posts.length === 0) { return "ok"; }
    const delays = this.degraded ? [] : this.retryDelaysMs;
    for (let attempt = 0; ; attempt += 1) {
      let outcome: GetiSiteOutcome;
      try {
        outcome = await this.send(op);
      } catch {
        outcome = "retry";
      }
      if (outcome === "ok") {
        this.degraded = false;
        return "ok";
      }
      if (outcome === "drop") { return "refused"; }
      if (attempt >= delays.length) {
        this.degraded = true;
        return "lost";
      }
      await this.sleep(delays[attempt]);
    }
  }
}
