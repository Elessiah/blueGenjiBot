import type {Client} from "discord.js";
import {sendLog} from "@/safe/sendLog.js";

/**
 * Journalisation de l'envoi des adhésions.
 *
 * L'envoi ne doit jamais lever : il tourne aussi bien sous une commande que
 * sous la tâche planifiée des rappels, où une exception arrêterait le passage
 * pour toutes les lignes suivantes. Chaque écriture au journal est donc
 * elle-même gardée — un journal injoignable ne fait pas échouer l'envoi.
 */

/**
 * Écrit une ligne au journal de supervision, sans jamais lever.
 * @param client Client Discord utilisé pour le journal.
 * @param text Ligne à journaliser.
 * @returns Une promesse résolue une fois la tentative terminée.
 */
async function logAdhesion(client: Client, text: string): Promise<void> {
    try {
        await sendLog(client, text);
    } catch { /* le journal est la voie de secours : rien d'autre à tenter */ }
}

/**
 * Journalise une exception sous le nom de l'étape qui l'a levée.
 * @param client Client Discord utilisé pour le journal.
 * @param step Étape en cause, en tête de la ligne (`<étape>: <message>`).
 * @param err Valeur levée, `Error` ou non.
 * @returns Une promesse résolue une fois la tentative terminée.
 */
async function logAdhesionError(client: Client, step: string, err: unknown): Promise<void> {
    const reason = err instanceof Error ? err.message : String(err);
    await logAdhesion(client, step + ": " + reason);
}

export {logAdhesion, logAdhesionError};
