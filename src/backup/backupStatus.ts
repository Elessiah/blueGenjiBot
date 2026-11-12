import fs from "node:fs";
import path from "node:path";

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
  /**
   * Chemin de l'historique que le script a écrit (`STATUS_HISTORY_FILE`), vide pour un
   * script antérieur : le bot relit celui-là, jamais un chemin recalculé de son côté.
   */
  historyFile: string;
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

/**
 * Sauvegarde en cours au moment du rapport : le script pose `<statut>.running`
 * (date ISO de son départ) et le retire en sortant. Une sauvegarde du dimanche
 * 23 h 49 encore en cours au rapport du lundi 4 h laisse lire le statut du mardi
 * précédent 23 h 49 (5 jours 4 h) : tant que le marqueur a moins de {@link RUNNING_MAX_AGE_MS},
 * le statut réussi garde {@link RUNNING_GRACE_MS} de plus avant d'être périmé.
 * Un marqueur plus vieux (script tué sans nettoyer) ne compte pas.
 */
export const RUNNING_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/** Lignes du marqueur de sauvegarde en cours relues, au plus (les plus récentes). */
export const RUNNING_MAX_LINES = 32;

/**
 * Délai ajouté à {@link STALE_AFTER_MS} pendant une sauvegarde en cours : trois jours
 * (six au total), au-delà des 5 jours 4 h qui séparent le mardi 23 h 49 du lundi 4 h.
 */
export const RUNNING_GRACE_MS = 3 * 24 * 60 * 60 * 1000;

/** Fenêtre relue dans l'historique : depuis le rapport précédent, une semaine plus tôt. */
export const HISTORY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Octets relus, au plus, à la fin de l'historique : le script en garde vingt lignes
 * de moins de 300 octets ; un fichier plus gros (chemin détourné, fichier enflé)
 * n'est jamais lu en entier.
 */
export const HISTORY_MAX_BYTES = 64 * 1024;

/** Octets relus, au plus, à la fin du marqueur de sauvegarde en cours. */
export const RUNNING_MAX_BYTES = 4 * 1024;

/**
 * Lit au plus les `maxBytes` derniers octets d'un fichier **ordinaire** : un lien vers
 * `/dev/zero`, une FIFO ou un dossier rendent `null` (jamais une lecture sans fin), et
 * un gros fichier n'est pas chargé en entier. La première ligne, coupée par la borne,
 * est écartée.
 * @param filePath Chemin du fichier.
 * @param maxBytes Octets lus au plus.
 * @returns Le texte lu, ou `null` (absent, illisible ou pas un fichier ordinaire).
 */
export async function readFileTail(filePath: string, maxBytes: number): Promise<string | null> {
  let handle: fs.promises.FileHandle | null = null;
  try {
    handle = await fs.promises.open(filePath, fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK ?? 0));
    const stat = await handle.stat();
    if (!stat.isFile()) { return null; }
    const length = Math.min(stat.size, maxBytes);
    const start = stat.size - length;
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    const text = buffer.subarray(0, bytesRead).toString("utf8");
    if (start === 0) { return text; }
    const firstBreak = text.indexOf("\n");
    return firstBreak === -1 ? "" : text.slice(firstBreak + 1);
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

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
      historyFile: isHistoryFilePath(parsed.historyFile) ? parsed.historyFile : "",
    };
  } catch {
    return null;
  }
}

/**
 * Chemin d'historique accepté depuis le statut : absolu, sans `..`, terminé par
 * `.jsonl` (celui du script) — jamais un fichier quelconque désigné par un statut
 * réécrit à la main ou détourné.
 * @param value Valeur lue dans le statut.
 * @returns `true` si le chemin peut être relu.
 */
function isHistoryFilePath(value: unknown): value is string {
  return typeof value === "string"
    && path.isAbsolute(value)
    && value.endsWith(".jsonl")
    && !value.split(/[\\/]/).includes("..");
}

/**
 * Chemin du marqueur de sauvegarde en cours, à côté du statut (même règle que le script).
 * @param statusPath Chemin du fichier de statut.
 * @returns Chemin du marqueur.
 */
export function runningMarkerPath(statusPath: string): string {
  return `${statusPath}.running`;
}

/**
 * Dit si le processus `pid` tourne encore sur cette machine (celle du script de
 * sauvegarde) : `EPERM` veut dire qu'il existe sous un autre compte.
 * @param pid PID relu dans le marqueur.
 * @returns `false` seulement si le processus n'existe plus.
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as { code?: string }).code === "EPERM";
  }
}

/**
 * Lit le départ d'une sauvegarde en cours (marqueur posé par le script). Le
 * marqueur porte une ligne par exécution en cours (`<date ISO> <PID>`, ou la date
 * seule d'un script antérieur) : la plus ancienne des lignes lisibles et récentes
 * est rendue, une ligne illisible, future ou trop vieille est ignorée — comme celle
 * dont le PID ne tourne plus (exécution tuée sans repasser par sa sortie : manque de
 * mémoire, redémarrage), qui ferait sinon passer une sauvegarde manquée pour en cours.
 * @param statusPath Chemin du fichier de statut.
 * @param now Horloge injectable, pour les tests.
 * @param isAlive Test de vie d'un PID, injectable pour les tests.
 * @returns L'instant du départ (ms) d'une exécution en cours récente, sinon `null`.
 */
export async function readRunningSince(
  statusPath: string,
  now: number = Date.now(),
  isAlive: (pid: number) => boolean = isProcessAlive,
): Promise<number | null> {
  // Les lignes récentes sont à la fin (le script ajoute) : un marqueur enflé (exécutions
  // tuées, édition à la main) n'est pas relu en entier à chaque rapport — seuls ses
  // derniers octets le sont ({@link RUNNING_MAX_BYTES}).
  const raw = await readFileTail(runningMarkerPath(statusPath), RUNNING_MAX_BYTES);
  if (raw === null) { return null; }
  const starts = raw.split("\n").slice(-RUNNING_MAX_LINES)
    .map((line) => line.trim().split(/\s+/))
    .filter(([, pid]) => pid === undefined || !/^\d+$/.test(pid) || isAlive(Number(pid)))
    .map(([date]) => Date.parse(date ?? ""))
    .filter((startedAt) => Number.isFinite(startedAt) && startedAt <= now && now - startedAt < RUNNING_MAX_AGE_MS);
  return starts.length === 0 ? null : Math.min(...starts);
}

/**
 * Indique si le statut atteste d'une sauvegarde distante récente et réussie.
 *
 * Sinon, le rapport du lundi passe en alerte (« Sauvegarde à vérifier »).
 * @param status Statut lu, ou `null`.
 * @param now Horloge injectable, pour les tests.
 * @param running `true` si une sauvegarde est en cours (`readRunningSince`).
 * @returns `true` si la dernière sauvegarde a réussi il y a moins de {@link STALE_AFTER_MS}
 * ({@link RUNNING_GRACE_MS} de plus pendant une sauvegarde en cours).
 */
export function isBackupFresh(status: BackupStatus | null, now: number = Date.now(), running: boolean = false): boolean {
  if (!status?.ok) {
    return false;
  }

  const date = Date.parse(status.date);
  const limit = running ? STALE_AFTER_MS + RUNNING_GRACE_MS : STALE_AFTER_MS;
  return Number.isFinite(date) && now - date < limit;
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
  // Fin du fichier seulement ({@link HISTORY_MAX_BYTES}), et jamais autre chose qu'un
  // fichier ordinaire : un chemin détourné vers `/dev/zero` ne bloque pas le rapport.
  const raw = await readFileTail(historyPath, HISTORY_MAX_BYTES);
  if (raw === null) { return []; }
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
 * @param runningSince Départ d'une sauvegarde en cours (`readRunningSince`), ou `null`.
 * @returns Une ligne prête à être envoyée en message privé.
 */
export function formatBackupStatus(status: BackupStatus | null, now: number = Date.now(), runningSince: number | null = null): string {
  if (!status) {
    return "☁️ Stockage distant : aucune sauvegarde enregistrée (script non installé ?).";
  }

  const day = status.date.slice(0, 10);

  if (!status.ok) {
    return `❌ Stockage distant : échec du ${day} — ${status.error || "cause inconnue"}.`;
  }

  const size = `${(status.sizeBytes / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`;
  const line = `Stockage distant : ${status.parts || "base"} sauvegardée le ${day} (${size}).`;

  const running = runningSince !== null;
  if (!isBackupFresh(status, now, running)) { return `⚠️ ${line} Sauvegarde périmée.`; }
  // Le statut ne tient que par la sauvegarde en cours : le rapport le dit.
  if (running && !isBackupFresh(status, now)) {
    const since = new Date(runningSince).toISOString().slice(0, 16).replace("T", " à ");
    return `☁️ ${line} Sauvegarde suivante en cours depuis le ${since} (UTC).`;
  }
  return `☁️ ${line}`;
}
