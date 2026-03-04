import {Attachment, ChatInputCommandInteraction, Client, MessageFlags} from "discord.js";
import {readFile, unlink, writeFile} from "fs/promises";
import {safeFollowUp} from "@/safe/safeFollowUp.js";
import {PathsAdhesions} from "@/adhesion/types.js";
import {loadAdhesionPaths} from "@/adhesion/loadAdhesionPaths.js";
import {saveAdhesionPaths} from "@/adhesion/saveAdhesionPaths.js";
import {checkPermissions} from "@/check/checkPermissions.js";
import {safeReply} from "@/safe/safeReply.js";

const ADHESION_FILES = Object.freeze({
    ADHESION: 0,
    STATUS: 1,
});

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

async function loadAdhesionFiles(client: Client,
                                 interaction: ChatInputCommandInteraction): Promise<void> {
    const adhesionFile: Attachment | null = interaction.options.getAttachment("adhesion");
    const statusFile: Attachment | null = interaction.options.getAttachment("status");
    let hasLoad: boolean = false;
    let hasError: boolean = false;

    if (!checkPermissions(interaction)) {
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
    }
}

export {loadAdhesionFiles};