import { classifyError, describeError, type ErrorSeverity } from "./errorGuards.js";

/** Signature d'un rapporteur d'erreur : renvoie la gravité retenue. */
type ErrorReporter = (context: string, error: unknown) => Promise<ErrorSeverity>;

/** Dépendances injectables du rapporteur, pour le rendre testable hors Discord. */
type ErrorReporterOptions = {
    /** Sortie technique, toujours appelée (sauf doublon étouffé). */
    toConsole: (line: string) => void;
    /** Sortie de supervision, appelée uniquement pour les erreurs `fatal`. */
    toRemote: (line: string) => Promise<unknown> | unknown;
    /** Horloge injectable pour les tests. */
    now?: () => number;
    /** Fenêtre de dédoublonnage en millisecondes. */
    dedupeWindowMs?: number;
};

/** Fenêtre par défaut : une panne réseau de 30 s ne produit qu'une ligne. */
const DEFAULT_DEDUPE_WINDOW_MS = 60_000;

/** Borne dure de la table de dédoublonnage, purge des clés les plus anciennes au-delà. */
const MAX_TRACKED_KEYS = 200;

/**
 * Construit un rapporteur d'erreurs dédoublonné.
 *
 * Une coupure réseau produit la même erreur des dizaines de fois par minute :
 * la journaliser à chaque occurrence a déjà rempli un fichier de log de 235 Mo
 * sur l'application sœur. Les répétitions à l'identique sont donc comptées
 * pendant `dedupeWindowMs`, et la première ligne émise après la fenêtre indique
 * combien d'occurrences ont été étouffées.
 *
 * @param options Sorties, horloge et fenêtre de dédoublonnage.
 * @returns Fonction de report, qui ne rejette jamais.
 */
function createErrorReporter(options: ErrorReporterOptions): ErrorReporter {
    const now = options.now ?? Date.now;
    const windowMs = options.dedupeWindowMs ?? DEFAULT_DEDUPE_WINDOW_MS;
    const seen = new Map<string, { last: number; suppressed: number }>();

    /**
     * Ramène la table sous sa borne dure.
     *
     * Les entrées dormantes partent d'abord ; si cela ne suffit pas — un défaut
     * dont le message varie à chaque occurrence crée une clé neuve à chaque
     * fois — les plus anciennes sont retirées dans l'ordre d'insertion, que
     * `Map` préserve. Sans cette seconde passe, la table grossirait sans fin
     * sur un process qui tourne des semaines.
     *
     * @param current Horodatage courant.
     */
    function prune(current: number): void {
        if (seen.size <= MAX_TRACKED_KEYS) return;
        for (const [key, entry] of seen) {
            if (current - entry.last > windowMs * 10) seen.delete(key);
        }
        for (const key of seen.keys()) {
            if (seen.size <= MAX_TRACKED_KEYS) break;
            seen.delete(key);
        }
    }

    return async function report(context: string, error: unknown): Promise<ErrorSeverity> {
        const severity: ErrorSeverity = classifyError(error);
        const description: string = describeError(error);
        const key = `${severity}|${context}|${description}`;
        const current: number = now();
        const entry = seen.get(key);

        if (entry && current - entry.last < windowMs) {
            entry.suppressed += 1;
            return severity;
        }

        const repeated: string = entry && entry.suppressed > 0
            ? ` (+${entry.suppressed} occurrence(s) identique(s) étouffée(s))`
            : "";
        seen.set(key, { last: current, suppressed: 0 });
        prune(current);

        const line = `[${severity}] ${context} : ${description}${repeated}`;
        try {
            options.toConsole(line);
        } catch { /* une sortie de log cassée ne doit pas propager */ }

        // Le canal de supervision passe par le réseau Discord : l'appeler pendant
        // une coupure réseau ne ferait qu'empiler des échecs. Et une cible
        // disparue (message supprimé, interaction expirée) n'appelle aucune action.
        if (severity === "fatal") {
            try {
                await options.toRemote(line);
            } catch { /* idem : le report ne doit jamais lever */ }
        }
        return severity;
    };
}

export { createErrorReporter, DEFAULT_DEDUPE_WINDOW_MS, MAX_TRACKED_KEYS, type ErrorReporter, type ErrorReporterOptions };
