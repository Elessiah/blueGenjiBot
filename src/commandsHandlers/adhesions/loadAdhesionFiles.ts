import {Attachment, ChatInputCommandInteraction, Client, MessageFlags} from "discord.js";
import {unlink, writeFile} from "fs/promises";
import {safeFollowUp} from "@/safe/safeFollowUp.js";
import {PathsAdhesions} from "@/adhesion/types.js";
import {loadAdhesionPaths} from "@/adhesion/loadAdhesionPaths.js";
import {saveAdhesionPaths} from "@/adhesion/saveAdhesionPaths.js";
import {safeReply} from "@/safe/safeReply.js";
import {sendLog} from "@/safe/sendLog.js";

const ADHESION_FILES = Object.freeze({
    ADHESION: 0,
    STATUS: 1,
});

/**
 * Supprime un ancien fichier d'adhésion stocké localement.
 * @param interaction Interaction utilisateur en cours.
 * @param path Chemin(s) de fichier utilisé(s).
 * @returns `true` si le fichier local ciblé est supprimé; `false` si la suppression échoue.
 */
async function deleteOldAttachment(interaction: ChatInputCommandInteraction,
                                   path: string): Promise<boolean> {
    try {
        await unlink(path);
        return true;
    } catch (e) {
        await safeFollowUp(
            interaction,
            "Impossible de supprimer " + path + ". Erreur : " + (e as TypeError).message,
            false,
            []
        );
        return false;
    }
}

/**
 * Nettoie les anciens fichiers avant enregistrement des nouveaux.
 * @param interaction Interaction utilisateur en cours.
 * @param adhesion_file Type de fichier ciblé (`ADHESION` ou `STATUS`).
 * @returns Chemins d'adhésion mis à jour si tout se passe bien; `null` si lecture/suppression/sauvegarde échoue.
 */
async function manageOldFiles(interaction: ChatInputCommandInteraction,
                              adhesion_file: number): Promise<PathsAdhesions | null> {
    const paths: PathsAdhesions | null = await loadAdhesionPaths(interaction);
    if (!paths)
        return null;
    const path: string = adhesion_file == ADHESION_FILES.ADHESION ? paths.adhesion : paths.status;
    if (!path || path.length == 0)
        return paths;
    if (!await deleteOldAttachment(interaction, path))
        return null;
    adhesion_file == ADHESION_FILES.ADHESION ? paths.adhesion = "" : paths.status = "";
    adhesion_file == ADHESION_FILES.ADHESION ? paths.adhesionName = "" : paths.statusName = "";
    return await saveAdhesionPaths(paths, interaction) ? paths : null;
}

/**
 * Télécharge et sauvegarde une pièce jointe d'adhésion.
 * @param interaction Interaction utilisateur en cours.
 * @param attachment Pièce jointe Discord à télécharger et stocker.
 * @param adhesion_file Type de fichier ciblé (`ADHESION` ou `STATUS`).
 * @returns `true` si téléchargement, écriture disque et sauvegarde de la configuration réussissent; sinon `false`.
 */
async function downloadAttachment(interaction: ChatInputCommandInteraction,
                                  attachment: Attachment,
                                  adhesion_file: number): Promise<boolean> {
    const res : Response = await fetch(attachment.url);
    if (!res.ok) {
        await safeFollowUp(interaction, "Echec du chargement de " + attachment.name, false, []);
        return false;
    }
    const paths: PathsAdhesions | null = await manageOldFiles(interaction, adhesion_file);
    if (!paths)
        return false;
    const newPath: string = process.env.ADHESIONS_PATH + attachment.name;
    adhesion_file == ADHESION_FILES.ADHESION ? paths.adhesion = newPath : paths.status = newPath;
    adhesion_file == ADHESION_FILES.ADHESION ? paths.adhesionName = attachment.name : paths.statusName = attachment.name;
    const buf: Buffer<ArrayBuffer> = Buffer.from(await res.arrayBuffer());
    await writeFile(newPath, buf);
    await saveAdhesionPaths(paths, interaction);
    return true;
}

/**
 * Charge les nouvelles pièces jointes et met à jour la configuration.
 * @param client Client Discord utilisé pour les appels API.
 * @param interaction Interaction utilisateur en cours.
 */
async function loadAdhesionFiles(client: Client,
                                 interaction: ChatInputCommandInteraction): Promise<void> {
    const adhesionFile: Attachment | null = interaction.options.getAttachment("adhesion");
    const statusFile: Attachment | null = interaction.options.getAttachment("status");
    let hasLoad: boolean = false;
    let hasError: boolean = false;

    if (interaction.user.id != process.env.OWNER_ID && interaction.user.id != process.env.PRESIDENT) {
        await safeReply(interaction, "You are not allowed to load adhesion files.");
        return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (adhesionFile) {
        if (await downloadAttachment(interaction, adhesionFile, ADHESION_FILES.ADHESION))
            hasLoad = true;
        else
            hasError = true;
    }
    if (statusFile) {
        if (await downloadAttachment(interaction, statusFile, ADHESION_FILES.STATUS))
            hasLoad = true;
        else
            hasError = true;
    }
    if (!hasLoad && !hasError) {
        await safeFollowUp(interaction, "Pas de fichier à charger", true, []);
    } else if (!hasError) {
        await safeFollowUp(interaction, "Fichier(s) chargé(s) !", true, []);
        await sendLog(client, "Les fichiers d'adhésions ont été modifié");
    }
}

export {loadAdhesionFiles};
