import {AttachmentBuilder, type Client, type User} from "discord.js";
import {PathsAdhesions} from "./types.js";
import {loadAdhesionPaths} from "./loadAdhesionPaths.js";
import {safeUser} from "../safe/safeUser.js";
import {logAdhesion, logAdhesionError} from "./adhesionLog.js";
import {MISSING_FILES_NOTICE} from "./adhesionNotices.js";

/**
 * Lit la configuration des fichiers d'adhésion.
 *
 * Une configuration absente est signalée à l'auteur (qui attend ses papiers)
 * et au journal ; une lecture qui lève n'est signalée qu'au journal.
 * @param client Client Discord utilisé pour les envois et le journal.
 * @param author Auteur de l'envoi, prévenu si les fichiers manquent.
 * @returns Les chemins configurés, ou `null` s'ils sont indisponibles.
 */
async function readAdhesionPaths(client: Client, author: User): Promise<PathsAdhesions | null> {
    let paths: PathsAdhesions | null;
    try {
        paths = await loadAdhesionPaths(undefined, client);
    } catch (err) {
        await logAdhesionError(client, "sendAdhesion loadAdhesionPaths", err);
        return null;
    }
    if (!paths) {
        await reportMissingPaths(client, author);
        return null;
    }
    return paths;
}

/**
 * Prévient l'auteur puis le journal que les fichiers sont introuvables.
 * @param client Client Discord utilisé pour les envois et le journal.
 * @param author Auteur de l'envoi.
 * @returns Une promesse résolue une fois les deux avis tentés.
 */
async function reportMissingPaths(client: Client, author: User): Promise<void> {
    try {
        await safeUser(client, author, undefined, [], MISSING_FILES_NOTICE);
    } catch (err) {
        await logAdhesionError(client, "sendAdhesion safeUser (no paths)", err);
    }
    await logAdhesion(client, "Echec de l'envoi d'adhésion car non récupération des chemins");
}

/**
 * Prépare les deux pièces jointes d'un envoi : le bulletin d'adhésion puis les statuts.
 * @param client Client Discord utilisé pour le journal.
 * @param paths Chemins et noms des deux fichiers.
 * @returns Les pièces jointes dans cet ordre, ou `null` si l'une ne peut être préparée.
 */
async function buildAttachments(client: Client, paths: PathsAdhesions): Promise<AttachmentBuilder[] | null> {
    try {
        return [
            new AttachmentBuilder(paths.adhesion, {name: paths.adhesionName}),
            new AttachmentBuilder(paths.status, {name: paths.statusName}),
        ];
    } catch (err) {
        await logAdhesionError(client, "Failed to fetch adhesion and/or status", err);
        return null;
    }
}

/**
 * Charge les pièces jointes à envoyer, ou signale pourquoi c'est impossible.
 * @param client Client Discord utilisé pour les envois et le journal.
 * @param author Auteur de l'envoi, prévenu si les fichiers ne sont pas configurés.
 * @returns Le bulletin d'adhésion et les statuts, ou `null` en cas d'échec (déjà signalé).
 */
async function loadAdhesionAttachments(client: Client, author: User): Promise<AttachmentBuilder[] | null> {
    const paths = await readAdhesionPaths(client, author);
    return paths ? buildAttachments(client, paths) : null;
}

export {loadAdhesionAttachments};
