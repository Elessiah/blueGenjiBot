import {ChatInputCommandInteraction, Client} from "discord.js";
import {PathsAdhesions} from "@/adhesion/types.js";
import {writeFile} from "fs/promises";
import {safeFollowUp} from "@/safe/safeFollowUp.js";
import {sendLog} from "@/safe/sendLog.js";

/**
 * Enregistre la configuration des fichiers d'adhésion dans `paths.json`.
 * @param paths Objet de configuration contenant les chemins et noms de fichiers.
 * @param interaction Interaction slash optionnelle pour signaler les erreurs à l'utilisateur.
 * @param client Client Discord optionnel pour journaliser l'erreur.
 * @returns `true` si `paths.json` est écrit avec succès; `false` si l'écriture échoue.
 */
async function saveAdhesionPaths(paths: PathsAdhesions,
                                 interaction?: ChatInputCommandInteraction,
                                 client?: Client): Promise<boolean> {
    try {
        await writeFile(process.env.ADHESIONS_PATH + "paths.json", JSON.stringify(paths), "utf-8");
        return true;
    } catch (e) {
        const errmsg: string = "Impossible de sauvegarder le fichier de configuration des adhésions, Erreur : " + (e as TypeError).message;
        if (interaction) {
            await safeFollowUp(
                interaction,
                errmsg,
                false,
                []);
        }
        if (client) {
            await sendLog(client, errmsg);
        }
        return false;
    }
}

export {saveAdhesionPaths};
