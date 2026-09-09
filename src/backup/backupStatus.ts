import fs from "node:fs";

/** Statut déposé par `scripts/backup-onedrive.sh` après chaque exécution. */
export interface BackupStatus {
  /** Date ISO de la tentative. */
  date: string;
  /** `true` si l'archive a bien été envoyée sur OneDrive. */
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

/** Au-delà de ce délai, une sauvegarde OneDrive réussie n'est plus une garantie. */
export const STALE_AFTER_MS = 8 * 24 * 60 * 60 * 1000;

/**
 * Lit le statut de la dernière sauvegarde OneDrive.
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
 * Indique si le statut atteste d'une sauvegarde OneDrive récente et réussie.
 *
 * Tant que ce n'est pas le cas, la pièce jointe Discord reste envoyée : mieux
 * vaut une sauvegarde redondante qu'aucune.
 * @param status Statut lu, ou `null`.
 * @param now Horloge injectable, pour les tests.
 * @returns `true` si OneDrive couvre déjà la sauvegarde de la semaine.
 */
export function isBackupFresh(status: BackupStatus | null, now: number = Date.now()): boolean {
  if (!status || !status.ok) {
    return false;
  }

  const date = Date.parse(status.date);
  return Number.isFinite(date) && now - date < STALE_AFTER_MS;
}

/**
 * Met en forme la ligne OneDrive jointe au rapport hebdomadaire.
 * @param status Statut lu, ou `null` si le script n'a jamais tourné.
 * @param now Horloge injectable, pour les tests.
 * @returns Une ligne prête à être envoyée en message privé.
 */
export function formatBackupStatus(status: BackupStatus | null, now: number = Date.now()): string {
  if (!status) {
    return "☁️ OneDrive : aucune sauvegarde enregistrée (script non installé ?).";
  }

  const day = status.date.slice(0, 10);

  if (!status.ok) {
    return `❌ OneDrive : échec du ${day} — ${status.error || "cause inconnue"}.`;
  }

  const size = `${(status.sizeBytes / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`;
  const line = `OneDrive : ${status.parts || "base"} sauvegardée le ${day} (${size}).`;

  return isBackupFresh(status, now) ? `☁️ ${line}` : `⚠️ ${line} Sauvegarde périmée.`;
}
