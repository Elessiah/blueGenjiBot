/**
 * Flux d'evenements du bot, persiste en base et diffuse en direct au dashboard web.
 *
 * Deux consommateurs bien differents : l'app web sœur affiche un fil
 * d'activite en temps reel via `/internal/feed/stream` (SSE), qui a besoin de
 * `subscribe()` pour recevoir les evenements au fil de l'eau, et ce meme
 * endpoint a besoin de `getBacklog()` pour rattraper l'historique recent a la
 * connexion. L'`EventEmitter` local ne fait que le direct — la persistance en
 * base (`FeedEvent`) est ce qui rend le backlog possible.
 */

import { EventEmitter } from "events";
import type { Client } from "discord.js";
import { getBddInstance } from "@/bdd/Bdd.js";
import { sendLog } from "@/safe/sendLog.js";

export type FeedEventType = "relay" | "scrim" | "recr" | "auth" | "warn";
export interface FeedEventRow {
  id: number;
  ts: string;
  type: FeedEventType;
  source: string | null;
  target: string | null;
  summary: string;
}

const emitter = new EventEmitter();
emitter.setMaxListeners(50);

/**
 * Enregistre un evenement en base puis le diffuse aux abonnes en direct.
 *
 * L'echec est avale (journalise si `client` est fourni) plutot que remonte :
 * un evenement de feed est un bonus d'observabilite, jamais une operation
 * dont l'echec doit interrompre la commande ou la route qui l'a declenche.
 *
 * @param client Client Discord pour journaliser un echec d'ecriture ; `null` pour ne rien journaliser.
 * @param type Categorie de l'evenement, utilisee par le dashboard pour le filtrage/l'icone.
 * @param summary Texte court decrivant l'evenement.
 * @param source Origine optionnelle (nom du serveur, etc.).
 * @param target Cible optionnelle (ID utilisateur, etc.).
 */
export async function recordEvent(
  client: Client | null,
  type: FeedEventType,
  summary: string,
  source?: string | null,
  target?: string | null
): Promise<void> {
  try {
    const bdd = await getBddInstance();
    await bdd.set(
      "FeedEvent",
      ["type", "source", "target", "summary"],
      [type, source ?? null, target ?? null, summary]
    );
    const rows = await bdd.raw<FeedEventRow>(
      "SELECT id, ts, type, source, target, summary FROM FeedEvent ORDER BY id DESC LIMIT 1",
      []
    );
    if (rows.length > 0) {
      emitter.emit("event", rows[0]);
    }
  } catch (err) {
    if (client) {
      await sendLog(
        client,
        `recordEvent error: ${(err as Error).message}`
      );
    }
  }
}

/**
 * Recupere les derniers evenements, pour l'amorce ou la reconnexion d'un flux SSE.
 *
 * @param limit Nombre maximal d'evenements a renvoyer.
 * @param sinceId Ne renvoie que les evenements posterieurs a cet ID (reconnexion via `Last-Event-ID`) ; sans lui, renvoie simplement les plus recents.
 * @returns Les evenements dans l'ordre chronologique croissant.
 */
export async function getBacklog(
  limit: number = 13,
  sinceId?: number
): Promise<FeedEventRow[]> {
  const bdd = await getBddInstance();
  if (typeof sinceId === "number" && !Number.isNaN(sinceId)) {
    return bdd.raw<FeedEventRow>(
      "SELECT id, ts, type, source, target, summary FROM FeedEvent WHERE id > ? ORDER BY id ASC LIMIT ?",
      [sinceId, limit]
    );
  }
  const rows = await bdd.raw<FeedEventRow>(
    "SELECT id, ts, type, source, target, summary FROM FeedEvent ORDER BY id DESC LIMIT ?",
    [limit]
  );
  return rows.reverse();
}

/**
 * S'abonne au flux d'evenements en direct.
 *
 * @param handler Rappele pour chaque evenement enregistre via `recordEvent`.
 * @returns Fonction de desabonnement, a appeler quand le consommateur (ex. une connexion SSE) se ferme.
 */
export function subscribe(
  handler: (event: FeedEventRow) => void
): () => void {
  emitter.on("event", handler);
  return () => {
    emitter.off("event", handler);
  };
}
