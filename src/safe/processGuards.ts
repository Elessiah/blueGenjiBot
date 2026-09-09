import type { Client } from "discord.js";
import { createErrorReporter, type ErrorReporter } from "./reportError.js";
import { sendLog } from "./sendLog.js";

let reporter: ErrorReporter | null = null;
let installed = false;

/**
 * Retourne le rapporteur d'erreurs global, créé à la première demande.
 * @param client Client Discord utilisé pour joindre le canal de supervision.
 * @returns Rapporteur partagé par tous les garde-fous.
 */
function getReporter(client: Client): ErrorReporter {
    if (!reporter) {
        reporter = createErrorReporter({
            toConsole: (line: string) => console.error(line),
            toRemote: (line: string) => sendLog(client, line),
        });
    }
    return reporter;
}

/**
 * Journalise une erreur runtime sans jamais la propager.
 * @param client Client Discord utilisé pour les appels API.
 * @param context Étiquette indiquant d'où vient l'erreur.
 * @param error Valeur capturée.
 */
async function reportError(client: Client, context: string, error: unknown): Promise<void> {
    await getReporter(client)(context, error);
}

/**
 * Installe les garde-fous process et client.
 *
 * Sans eux, Node termine le process sur le premier `unhandledRejection` — c'est
 * exactement ce qui a tué le bot pendant la coupure DNS du 8 septembre, où les
 * erreurs `EAI_AGAIN` remontaient depuis les appels internes de discord.js,
 * hors de portée de tout `try/catch` applicatif.
 *
 * @param client Client Discord utilisé pour les appels API.
 */
function installProcessGuards(client: Client): void {
    if (installed) return;
    installed = true;

    process.on("unhandledRejection", (reason: unknown) => {
        void reportError(client, "unhandledRejection", reason);
    });

    process.on("uncaughtException", (error: unknown) => {
        void reportError(client, "uncaughtException", error);
    });

    // Sans écouteur `error`, un EventEmitter relance l'erreur : la panne de
    // gateway devient une exception non capturée.
    client.on("error", (error: unknown) => {
        void reportError(client, "client", error);
    });

    client.on("shardError", (error: unknown) => {
        void reportError(client, "shard", error);
    });
}

/**
 * Réinitialise l'état du module. Réservé aux tests.
 */
function _resetProcessGuards(): void {
    reporter = null;
    installed = false;
}

export { installProcessGuards, reportError, _resetProcessGuards };
