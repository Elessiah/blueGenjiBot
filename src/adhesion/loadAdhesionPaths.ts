import {ChatInputCommandInteraction, Client} from "discord.js";
import {PathsAdhesions} from "@/adhesion/types.js";
import {readFile} from "fs/promises";
import {safeFollowUp} from "@/safe/safeFollowUp.js";
import {sendLog} from "@/safe/sendLog.js";
import {saveAdhesionPaths} from "@/adhesion/saveAdhesionPaths.js";

/**
 * Charge la configuration des fichiers d'adhésion depuis `paths.json`.
 * Si le fichier est absent/invalide, tente de créer une configuration vide par défaut.
 * @param interaction Interaction slash optionnelle pour répondre à l'utilisateur.
 * @param client Client Discord optionnel pour envoyer les logs.
 * @returns Les chemins configurés (chargés ou créés par défaut), ou `null` si lecture/écriture échouent.
 */
async function loadAdhesionPaths(interaction?: ChatInputCommandInteraction,
                                 client?: Client): Promise<PathsAdhesions | null> {
    try {
        const data: string = await readFile(process.env.ADHESIONS_PATH + "paths.json", "utf-8");
        return JSON.parse(data);
    } catch (e) {
        const errmsg: string = "Impossible de lire le fichier de configuration des adhésions, Erreur : " + (e as TypeError).message;
        if (interaction) {
            await safeFollowUp(
                interaction,
                errmsg,
                false,
                []);
            await safeFollowUp(interaction, "Création d'un nouveau fichier de configuration", true, []);
        }
        if (client){
            await sendLog(client, errmsg + "\nCréation d'un nouveau fichier de conf.");
        }
        const paths: PathsAdhesions = {adhesion: "", adhesionName: "", status: "", statusName: ""};
        try {
            await saveAdhesionPaths(paths, interaction, client);
        } catch (e) {
            if (interaction) {
                await safeFollowUp(
                    interaction,
                    "Le fichier semble inaccessible en écriture, contacte Elessiah",
                    false,
                    []
                );
                await sendLog(interaction.client, "Le fichier de configuration d'adhésion semble inaccessible en lecture et écriture" + (e as TypeError).message);
            }
            if (client) {
                await sendLog(client, "Le fichier de configuration d'adhésion semble inaccessible en lecture et écriture" + (e as TypeError).message);
            }
            return null;
        }
        return paths;
    }
}

export {loadAdhesionPaths};
