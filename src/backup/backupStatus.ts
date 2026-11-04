import fs from "node:fs";

import { sliceWithoutSplittingPair } from "../notifications/dmLanguage.js";

/** Statut déposé par `scripts/backup-onedrive.sh` après chaque exécution. */
export interface BackupStatus {
  /** Date ISO de la tentative. */
  date: string;
  /** `true` si l'archive a bien été envoyée sur le stockage distant. */
  ok: boolean;
  /** Chemin distant de l'archive chiffrée. */
  remote: string;
  /** Taille de l'archive envoyée, en octets. */
  sizeBytes: number;
  /** Bases incluses dans l'archive (`sqlite`, `sqlite+mysql`). */
  parts: string;
  /** Message d'erreur, vide si la sauvegarde a réussi. */
  error: string;
}

/**
 * Au-delà de ce délai, une sauvegarde distante réussie n'est plus une garantie.
 *
 * Deux sauvegardes par semaine (dimanche et mardi soir), relues par le rapport
 * du lundi à 4 h : la dernière réussie y a normalement quelques heures. Trois
 * jours laissent passer un retard, mais pas un dimanche manqué (la dernière
 * réussie serait alors celle du mardi, six jours plus tôt).
 */
export const STALE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

/** Fenêtre relue dans l'historique : depuis le rapport précédent, une semaine plus tôt. */
export const HISTORY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Une ligne de l'historique des statuts (`STATUS_HISTORY_FILE` du script). */
export interface BackupHistoryEntry {
  /** Date ISO de la tentative. */
  date: string;
  /** `true` si l'archive a bien été envoyée. */
  ok: boolean;
  /** Message d'erreur, vide si la sauvegarde a réussi. */
  error: string;
}

/**
 * Lit le statut de la dernière sauvegarde distante.
 *
 * Le script tourne en cron système, indépendamment du bot : le fichier peut
 * donc être absent (script pas encore installé) ou illisible sans que ce soit
 * une anomalie du bot.
 * @param statusPath Chemin du fichier de statut JSON.
 * @returns Le statut lu, ou `null` s'il est absent ou invalide.
 */
export async function readBackupStatus(statusPath: string): Promise<BackupStatus | null> {
  try {
    const raw = await fs.promises.readFile(statusPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<BackupStatus>;

    if (typeof parsed.date !== "string" || typeof parsed.ok !== "boolean") {
      return null;
    }

    return {
      date: parsed.date,
      ok: parsed.ok,
      remote: parsed.remote ?? "",
      sizeBytes: typeof parsed.sizeBytes === "number" ? parsed.sizeBytes : 0,
      parts: parsed.parts ?? "",
      error: parsed.error ?? "",
    };
  } catch {
    return null;
  }
}

/**
 * Indique si le statut atteste d'une sauvegarde distante récente et réussie.
 *
 * Sinon, le rapport du lundi passe en alerte (« Sauvegarde à vérifier »).
 * @param status Statut lu, ou `null`.
 * @param now Horloge injectable, pour les tests.
 * @returns `true` si la dernière sauvegarde a réussi il y a moins de {@link STALE_AFTER_MS}.
 */
export function isBackupFresh(status: BackupStatus | null, now: number = Date.now()): boolean {
  if (!status?.ok) {
    return false;
  }

  const date = Date.parse(status.date);
  return Number.isFinite(date) && now - date < STALE_AFTER_MS;
}

/**
 * Lit les échecs de l'historique depuis le rapport précédent.
 *
 * Le dernier statut ne dit que la dernière exécution : un échec du mardi est
 * écrasé par le succès du dimanche. L'historique, une ligne JSON par
 * exécution, les garde. Absent (script antérieur) ou illisible : aucun échec
 * connu, le rapport s'appuie alors sur le seul dernier statut, comme avant.
 * @param historyPath Chemin de l'historique (lignes JSON).
 * @param now Horloge injectable, pour les tests.
 * @returns Les échecs de la fenêtre {@link HISTORY_WINDOW_MS}, du plus ancien au plus récent.
 */
export async function readBackupFailures(historyPath: string, now: number = Date.now()): Promise<BackupHistoryEntry[]> {
  let raw: string;
  try {
    raw = await fs.promises.readFile(historyPath, "utf8");
  } catch {
    return [];
  }
  const failures: BackupHistoryEntry[] = [];
  for (const line of raw.split("\n")) {
    const entry = parseHistoryLine(line);
    if (!entry || entry.ok) { continue; }
    const date = Date.parse(entry.date);
    if (Number.isFinite(date) && now - date < HISTORY_WINDOW_MS && date <= now) {
      failures.push(entry);
    }
  }
  return failures;
}

/**
 * Lit une ligne de l'historique.
 * @param line Ligne brute.
 * @returns L'entrée, ou `null` si la ligne est vide ou invalide.
 */
function parseHistoryLine(line: string): BackupHistoryEntry | null {
  if (line.trim() === "") { return null; }
  try {
    const parsed = JSON.parse(line) as Partial<BackupHistoryEntry>;
    if (typeof parsed.date !== "string" || typeof parsed.ok !== "boolean") { return null; }
    return { date: parsed.date, ok: parsed.ok, error: typeof parsed.error === "string" ? parsed.error : "" };
  } catch {
    return null;
  }
}

/**
 * Met en forme les échecs depuis le rapport précédent.
 * @param failures Échecs lus par {@link readBackupFailures}.
 * @returns Une ligne par échec, ou `null` s'il n'y en a aucun.
 */
export function formatBackupFailures(failures: BackupHistoryEntry[]): string | null {
  if (failures.length === 0) { return null; }
  return failures
    .map((failure) => `❌ Échec depuis le rapport précédent : ${failure.date.slice(0, 10)} — ${shortCause(failure.error)}.`)
    .join("\n");
}

/** Longueur maximale d'une cause recopiée de l'historique (le message privé plafonne à 2 000 caractères). */
export const FAILURE_CAUSE_MAX_LENGTH = 200;

/**
 * Abrège une cause d'échec de l'historique, sans couper un émoji.
 * @param error Cause enregistrée par le script (vide si inconnue).
 * @returns La cause, abrégée au besoin, ou « cause inconnue ».
 */
function shortCause(error: string): string {
  if (!error) { return "cause inconnue"; }
  return error.length > FAILURE_CAUSE_MAX_LENGTH ? `${sliceWithoutSplittingPair(error, FAILURE_CAUSE_MAX_LENGTH)}…` : error;
}

/**
 * Met en forme la ligne du stockage distant jointe au rapport du lundi.
 * @param status Statut lu, ou `null` si le script n'a jamais tourné.
 * @param now Horloge injectable, pour les tests.
 * @returns Une ligne prête à être envoyée en message privé.
 */
export function formatBackupStatus(status: BackupStatus | null, now: number = Date.now()): string {
  if (!status) {
    return "☁️ Stockage distant : aucune sauvegarde enregistrée (script non installé ?).";
  }

  const day = status.date.slice(0, 10);

  if (!status.ok) {
    return `❌ Stockage distant : échec du ${day} — ${status.error || "cause inconnue"}.`;
  }

  const size = `${(status.sizeBytes / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`;
  const line = `Stockage distant : ${status.parts || "base"} sauvegardée le ${day} (${size}).`;

  return isBackupFresh(status, now) ? `☁️ ${line}` : `⚠️ ${line} Sauvegarde périmée.`;
}
