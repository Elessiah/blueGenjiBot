import fs from "node:fs";

/** Occupation d'un système de fichiers, en octets. */
export interface DiskUsage {
  /** Taille totale du système de fichiers. */
  total: number;
  /** Espace réellement disponible pour un utilisateur non privilégié. */
  free: number;
  /** Espace occupé (réservé root inclus). */
  used: number;
  /** Part occupée, entre 0 et 1. */
  usedRatio: number;
}

// En dessous de ces seuils, la ligne de rapport passe en alerte.
const LOW_SPACE_RATIO = 0.9;
const LOW_SPACE_BYTES = 1024 * 1024 * 1024;

/**
 * Lit l'occupation du système de fichiers qui héberge un chemin donné.
 * @param targetPath Chemin dont on veut connaître le volume (la base SQLite, en pratique).
 * @returns L'occupation du volume, ou `null` si elle n'a pas pu être lue.
 */
export async function getDiskUsage(targetPath: string): Promise<DiskUsage | null> {
  // `statfs` n'existe qu'à partir de Node 18.15 : sans lui, on renonce sans casser la sauvegarde.
  if (typeof fs.promises.statfs !== "function") {
    return null;
  }

  try {
    const stats = await fs.promises.statfs(targetPath);
    const blockSize = Number(stats.bsize);
    const total = Number(stats.blocks) * blockSize;
    const free = Number(stats.bavail) * blockSize;
    const used = (Number(stats.blocks) - Number(stats.bfree)) * blockSize;

    if (!Number.isFinite(total) || total <= 0) {
      return null;
    }

    return { total, free, used, usedRatio: used / total };
  } catch (error) {
    console.error("[backup] Espace disque illisible :", (error as Error).message);
    return null;
  }
}

/**
 * Met en forme une taille en octets avec l'unité la plus lisible.
 * @param bytes Taille à formater.
 * @returns La taille en Mo, Go ou To, avec une décimale.
 */
function formatBytes(bytes: number): string {
  const units = [
    { limit: 1024 ** 4, suffix: "To" },
    { limit: 1024 ** 3, suffix: "Go" },
    { limit: 1024 ** 2, suffix: "Mo" },
  ];
  const unit = units.find((candidate) => bytes >= candidate.limit) ?? units[units.length - 1];
  return `${(bytes / unit.limit).toFixed(1).replace(".", ",")} ${unit.suffix}`;
}

/**
 * Construit la ligne d'état disque jointe à la sauvegarde hebdomadaire.
 * @param usage Occupation mesurée, ou `null` si la lecture a échoué.
 * @returns Une ligne prête à être envoyée en message privé.
 */
export function formatDiskUsage(usage: DiskUsage | null): string {
  if (!usage) {
    return "💾 Espace disque : indisponible.";
  }

  const percent = Math.round(usage.usedRatio * 100);
  const line =
    `Espace disque : ${formatBytes(usage.free)} libres sur ${formatBytes(usage.total)} ` +
    `(${percent} % utilisé).`;

  const low = usage.usedRatio >= LOW_SPACE_RATIO || usage.free < LOW_SPACE_BYTES;
  return low ? `⚠️ ${line} Pense à faire de la place.` : `💾 ${line}`;
}
