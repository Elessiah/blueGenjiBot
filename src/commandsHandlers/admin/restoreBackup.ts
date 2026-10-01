import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MessageFlags, type ChatInputCommandInteraction, type Client } from "discord.js";

import {
  archiveSourcesFromEnv,
  decryptDatabase,
  fetchArchive,
  findMissingCommand,
  listArchives,
  missingCommandText,
  pickArchive,
} from "@/backup/archiveSource.js";
import { restoreDatabase } from "@/backup/restoreDatabase.js";
import { runDataRetention } from "@/privacy/dataRetention.js";
import { purgeFeedIdentifiers } from "@/feed/feedBus.js";
import { safeReply } from "@/safe/safeReply.js";
import { sendLog } from "@/safe/sendLog.js";

/** Nombre d'archives montrées quand la commande est lancée sans `archive`. */
const LISTED_ARCHIVES = 10;

/** Renvoi vers le détail, gardé hors de Discord. */
const SEE_PM2 = "détail dans les journaux pm2";

/**
 * Texte d'un échec de restauration, **pour Discord** : sans le message brut.
 *
 * Celui de `rclone`, `age` ou `tar` porte le remote et le dossier distants,
 * le dossier temporaire, le chemin de la clé : rien de cela ne part sur
 * Discord, ni dans le salon de logs ni dans la réponse. Le détail est écrit
 * dans les journaux pm2 (`console.error`) par l'appelant. Seule exception, la
 * commande introuvable, que `missingCommandText` nomme sans chemin : c'est
 * elle qui dit à l'exploitant quoi corriger.
 * @param error Erreur reçue.
 * @returns Le texte à montrer.
 */
export function restoreFailureText(error: unknown): string {
  const missing = findMissingCommand(error);
  return missing ? `${missingCommandText(missing)} — ${SEE_PM2}` : SEE_PM2;
}

/**
 * Libellé, sans détail, d'une source qui n'a pas répondu (`listArchives`
 * préfixe chaque échec de « stockage distant » ou « dossier local »).
 * @param failure Échec tel que `listArchives` le rend.
 * @returns Le libellé de la source.
 */
export function failedSourceLabel(failure: string): string {
  const end = failure.indexOf(" : ");
  return end > 0 ? failure.slice(0, end) : "source";
}

/**
 * Restaure la base SQLite du bot depuis une archive chiffrée **présente sur la
 * machine du bot** (dossier local ou stockage distant), déchiffrée sur place.
 *
 * Aucune base ne transite plus par Discord : la commande ne prend qu'une date
 * ou un nom d'archive (voir `backup/archiveSource.ts`). Sans `archive`, elle
 * liste les archives disponibles et ne restaure rien.
 *
 * Réservée au propriétaire déclaré dans `OWNER_ID` : la commande écrase la base
 * de production, aucun rôle Discord ne suffit à l'autoriser.
 * @param client Client Discord, pour la journalisation.
 * @param interaction Interaction `/restore-backup` en cours.
 * @returns Rien ; la réponse part par `safeReply`.
 */
export async function restoreBackup(
  client: Client,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const ownerId = process.env.OWNER_ID;
  if (!ownerId || interaction.user.id !== ownerId) {
    await safeReply(interaction, "❌ Commande réservée au propriétaire du bot.");
    return;
  }

  const query = interaction.options.getString("archive")?.trim() ?? "";
  if (query && !interaction.options.getBoolean("confirmer")) {
    await safeReply(
      interaction,
      "❌ Restauration annulée : relance la commande avec `confirmer: true`. " +
        "Elle remplace la base de production en cours d'utilisation.",
    );
    return;
  }

  // Listage, téléchargement et déchiffrement dépassent les 3 s d'une interaction.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const sources = archiveSourcesFromEnv();
  // Le seul refus de `listArchives` qui ne doive rien aux commandes : il se
  // dit ici, nommément, plutôt que de renvoyer aux journaux.
  if (!sources.localDir && !sources.remote) {
    await safeReply(
      interaction,
      "❌ Aucune source d'archives configurée (`BACKUP_ARCHIVE_DIR` ou `BACKUP_RCLONE_REMOTE`).",
      true,
      true,
    );
    return;
  }

  let archives;
  let failures: string[];
  let listingMissingCommand: string | null;
  try {
    ({ archives, failures, missingCommand: listingMissingCommand } = await listArchives(sources));
  } catch (error) {
    console.error("[restore-backup] Archives illisibles :", (error as Error).message);
    // `listArchives` ne lève que si **toutes** les sources configurées ont
    // échoué : elles sont toutes nommées, sans quoi la panne de l'une (dossier
    // local) ne se verrait qu'une fois l'autre (commande absente) réparée.
    const failed = [sources.remote && "stockage distant", sources.localDir && "dossier local"].filter(Boolean).join(", ");
    await safeReply(interaction, `❌ Archives illisibles : ${failed} (${restoreFailureText(error)})`, true, true);
    return;
  }
  // Une source muette se dit : sans elle, « aucune archive » se lirait
  // « aucune sauvegarde ». « Non lue » plutôt qu'« injoignable » : la cause
  // peut être une commande introuvable, que le texte nomme alors.
  let partial = "";
  if (failures.length > 0) {
    console.error("[restore-backup] Source non lue :", failures.join(" ; "));
    const cause = listingMissingCommand ? missingCommandText(listingMissingCommand) : SEE_PM2;
    partial = `\n⚠️ Source non lue : ${failures.map(failedSourceLabel).join(", ")} (${cause})`;
  }

  if (!query) {
    const lines = archives
      .slice(0, LISTED_ARCHIVES)
      .map((archive) => `- \`${archive.name}\` (${archive.location === "local" ? "locale" : "distante"})`);
    await safeReply(
      interaction,
      (lines.length > 0
        ? `Archives disponibles :\n${lines.join("\n")}\nRelance avec \`archive: AAAA-MM-JJ\` et \`confirmer: true\`.`
        : "Aucune archive disponible.") + partial,
      true,
      true,
    );
    return;
  }

  const archive = pickArchive(archives, query);
  if (!archive) {
    await safeReply(
      interaction,
      `❌ Archive introuvable. Lance la commande sans \`archive\` pour voir la liste.${partial}`,
      true,
      true,
    );
    return;
  }

  // Dossier neuf, nom tiré par le noyau, créé en 0700 : ni devinable ni
  // préemptable par un autre compte de la machine (lien symbolique posé
  // d'avance dans un `/tmp` partagé).
  let tmpDir = "";

  try {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "bluegenji-restore-"));
    const archivePath = await fetchArchive(sources, archive, tmpDir);
    const dbPath = await decryptDatabase(archivePath, sources.identity, tmpDir);

    const result = await restoreDatabase(dbPath);
    // Une sauvegarde peut ramener au flux d'activité des identifiants Discord
    // que l'API interne servirait, tels quels, à la page publique `/bot` : la
    // purge passe avant la réponse et le journal, la base restaurée étant
    // déjà ouverte. Elle est locale et ne lève pas.
    if (result.success) {
      await purgeFeedIdentifiers(client);
    }
    // Un échec porte le message brut du système de fichiers (chemins de la
    // base et du dossier temporaire) : Discord — réponse comme salon de logs —
    // n'en reçoit que le résumé, sans chemin, pas même celui de la copie de
    // l'ancienne base ; le détail va dans les journaux pm2.
    if (result.success) {
      const rollback = result.rollbackPath ? `\nSauvegarde de l'ancienne base : \`${result.rollbackPath}\`` : "";
      await safeReply(interaction, `✅ ${result.message}${rollback}`, true, true);
    } else {
      const rollback = result.rollbackPath ? ` (ancienne base : ${result.rollbackPath})` : "";
      console.error("[restore-backup]", result.message + rollback);
      await safeReply(interaction, `❌ ${result.summary} (${SEE_PM2})`, true, true);
    }
    await sendLog(
      client,
      `Restauration de la base par le compte ${interaction.user.id} (${archive.name}) : ` +
        (result.success ? `succès — ${result.message}` : `échec — ${SEE_PM2}`),
    );
    // Le reste de ce que la sauvegarde a ramené (auteurs de plus de 30 jours,
    // fil d'activité ancien, serveurs quittés) n'attend pas la nuit — mais pas
    // la réponse non plus : le rattrapage des serveurs fait des appels réseau.
    // Il ne lève jamais.
    if (result.success) {
      void runDataRetention(client);
    }
  } catch (error) {
    console.error("[restore-backup] Restauration échouée :", (error as Error).message);
    const text = restoreFailureText(error);
    await safeReply(interaction, `❌ Restauration échouée : ${text}`, true, true);
    await sendLog(client, `Restauration de la base échouée : ${text}`);
  } finally {
    // L'archive et la base en clair partent avec le dossier. Vide si `mkdtemp`
    // a échoué : `rm` sur une chaîne vide viserait le dossier courant.
    if (tmpDir) {
      await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
