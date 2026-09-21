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
import { scrubFeedField, scrubFeedText } from "@/feed/feedPrivacy.js";
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
 * Le flux est **republie sur une page publique** par l'app web soeur : rien de
 * ce qui entre ici ne doit nommer une personne. L'anonymisation est posee au
 * point d'ecriture — le seul — et non chez les appelants, pour qu'aucun ne
 * puisse l'oublier ; elle porte sur les trois colonnes libres, pas seulement
 * sur le resume. Voir `feed/feedPrivacy.ts`.
 *
 * @param client Client Discord pour journaliser un echec d'ecriture ; `null` pour ne rien journaliser.
 * @param type Categorie de l'evenement, utilisee par le dashboard pour le filtrage/l'icone.
 * @param summary Texte court decrivant l'evenement ; tout identifiant Discord y est remplace par « un joueur ».
 * @param source Origine optionnelle (nom du serveur, etc.).
 * @param target Cible optionnelle ; une valeur qui n'est qu'un identifiant Discord n'est pas enregistree.
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
      [type, scrubFeedField(source), scrubFeedField(target), scrubFeedText(summary)]
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
 * Efface les identifiants Discord des evenements **deja enregistres**.
 *
 * Corriger l'ecriture ne corrige pas ce qui est ecrit : la table conserve les
 * evenements sans duree, et `getBacklog()` les rejoue a chaque connexion d'un
 * lecteur. Une base en service porte donc encore les identifiants collectes
 * avant la regle — c'est la seule facon de les en retirer.
 *
 * Idempotente et rejouee a chaque demarrage : une ligne deja propre n'est pas
 * relue deux fois (la selection ne prend que celles qui portent un
 * identifiant), et une ligne reparee ne ressort jamais de la selection.
 *
 * Ne leve **jamais** : elle s'execute au demarrage, avant l'ouverture de l'API
 * interne, et son echec ne doit pas empecher le bot de servir les codes de
 * connexion du site.
 *
 * @param client Client Discord pour journaliser un echec ; `null` pour ne rien journaliser.
 * @returns Le nombre de lignes reparees.
 */
export async function purgeFeedIdentifiers(client: Client | null): Promise<number> {
  try {
    const bdd = await getBddInstance();
    // SQLite n'a pas d'expression reguliere : le tri fin se fait en memoire.
    // `GLOB` ecarte d'emblee l'immense majorite des lignes — dix-sept chiffres
    // consecutifs, la longueur minimale d'un identifiant.
    const digits = "[0-9]".repeat(17);
    const rows = await bdd.raw<{ id: number; source: string | null; target: string | null; summary: string }>(
      `SELECT id, source, target, summary FROM FeedEvent
        WHERE target IS NOT NULL
           OR summary GLOB ?
           OR source GLOB ?`,
      [`*${digits}*`, `*${digits}*`]
    );

    let repaired = 0;
    for (const row of rows) {
      const source = scrubFeedField(row.source);
      const target = scrubFeedField(row.target);
      const summary = scrubFeedText(row.summary);
      // `target` seul peut changer sans qu'aucun identifiant ne figure nulle
      // part : une valeur qui n'en est pas un est conservee telle quelle.
      const unchanged =
        source === row.source &&
        target === row.target &&
        summary === row.summary;
      if (unchanged) {
        continue;
      }
      await bdd.raw(
        "UPDATE FeedEvent SET source = ?, target = ?, summary = ? WHERE id = ?",
        [source, target, summary, row.id]
      );
      repaired += 1;
    }

    if (repaired > 0) {
      console.log(`[feed] ${repaired} evenement(s) anonymise(s) retroactivement.`);
    }
    return repaired;
  } catch (err) {
    if (client) {
      await sendLog(client, `purgeFeedIdentifiers error: ${(err as Error).message}`);
    }
    return 0;
  }
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
