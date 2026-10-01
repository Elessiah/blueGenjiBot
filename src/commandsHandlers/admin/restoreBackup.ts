import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MessageFlags, type ChatInputCommandInteraction, type Client } from "discord.js";

import {
  archiveSourcesFromEnv,
  decryptDatabase,
  fetchArchive,
  listArchives,
  pickArchive,
} from "@/backup/archiveSource.js";
import { restoreDatabase } from "@/backup/restoreDatabase.js";
import { runDataRetention } from "@/privacy/dataRetention.js";
import { purgeFeedIdentifiers } from "@/feed/feedBus.js";
import { safeReply } from "@/safe/safeReply.js";
import { sendLog } from "@/safe/sendLog.js";

/** Nombre d'archives montrées quand la commande est lancée sans `archive`. */
const LISTED_ARCHIVES = 10;

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

  let archives;
  try {
    archives = await listArchives(sources);
  } catch (error) {
    await safeReply(interaction, `❌ Archives illisibles : ${(error as Error).message}`, true, true);
    return;
  }

  if (!query) {
    const lines = archives
      .slice(0, LISTED_ARCHIVES)
      .map((archive) => `- \`${archive.name}\` (${archive.location === "local" ? "locale" : "distante"})`);
    await safeReply(
      interaction,
      lines.length > 0
        ? `Archives disponibles :\n${lines.join("\n")}\nRelance avec \`archive: AAAA-MM-JJ\` et \`confirmer: true\`.`
        : "Aucune archive disponible.",
      true,
      true,
    );
    return;
  }

  const archive = pickArchive(archives, query);
  if (!archive) {
    await safeReply(interaction, "❌ Archive introuvable. Lance la commande sans `archive` pour voir la liste.", true, true);
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
    const rollback = result.rollbackPath ? `\nSauvegarde de l'ancienne base : \`${result.rollbackPath}\`` : "";

    await safeReply(interaction, `${result.success ? "✅" : "❌"} ${result.message}${rollback}`, true, true);
    await sendLog(
      client,
      `Restauration de la base par le compte ${interaction.user.id} (${archive.name}) : ` +
        `${result.success ? "succès" : "échec"} — ${result.message}`,
    );
    // Le reste de ce que la sauvegarde a ramené (auteurs de plus de 30 jours,
    // fil d'activité ancien, serveurs quittés) n'attend pas la nuit — mais pas
    // la réponse non plus : le rattrapage des serveurs fait des appels réseau.
    // Il ne lève jamais.
    if (result.success) {
      void runDataRetention(client);
    }
  } catch (error) {
    await safeReply(interaction, `❌ Restauration échouée : ${(error as Error).message}`, true, true);
    await sendLog(client, `Restauration de la base échouée : ${(error as Error).message}`);
  } finally {
    // L'archive et la base en clair partent avec le dossier. Vide si `mkdtemp`
    // a échoué : `rm` sur une chaîne vide viserait le dossier courant.
    if (tmpDir) {
      await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
