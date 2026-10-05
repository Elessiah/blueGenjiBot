/**
 * Liens d'un tournoi BlueGenji : règlement en français, en anglais, et
 * formulaire de candidature des casters.
 *
 * Les valeurs par défaut vivent ici ; `/set-tournoi-lien` en remplace une
 * dans la table `TournamentLink`, que `/tournoi` superpose à ces défauts.
 */

/** Clés des liens de tournoi, dans l'ordre d'affichage. */
export const TOURNAMENT_LINK_KINDS = ["reglement-fr", "reglement-en", "cast"] as const;

export type TournamentLinkKind = typeof TOURNAMENT_LINK_KINDS[number];

/** Texte de chaque lien (sans crochet : il est inséré dans un lien masqué). */
export const TOURNAMENT_LINK_LABELS: Readonly<Record<TournamentLinkKind, string>> = {
    "reglement-fr": "Règlement (français)",
    "reglement-en": "Rules (English)",
    "cast": "Formulaire pour caster",
};

/** Liens tant qu'aucun n'a été remplacé. */
export const DEFAULT_TOURNAMENT_LINKS: Readonly<Record<TournamentLinkKind, string>> = {
    "reglement-fr": "https://docs.google.com/document/d/1CchCLJI2QaaVM1SB3X1OFDJr0jD1KGm-/edit",
    "reglement-en": "https://docs.google.com/document/d/1XHv8qYZe-yQ3qoHOcWFXrRSXpYb1TwSE/edit?usp=sharing&ouid=114574181631804082850&rtpof=true&sd=true",
    "cast": "https://docs.google.com/forms/d/e/1FAIpQLSfn1BGmT3YUXpAwehDSo47xfQk01jObC1qgJA3J8Gd6QCLQpw/viewform",
};

/** Longueur maximale d'un lien enregistré. */
export const MAX_TOURNAMENT_LINK_LENGTH = 500;

/**
 * @param value Valeur reçue d'une option de commande.
 * @returns `true` si c'est une clé de lien de tournoi connue.
 */
export function isTournamentLinkKind(value: string): value is TournamentLinkKind {
    return (TOURNAMENT_LINK_KINDS as readonly string[]).includes(value);
}

/**
 * Valide un lien proposé par `/set-tournoi-lien`.
 *
 * `https` seul, sans espace ni caractère qui romprait le lien masqué
 * `[libellé](<url>)` de `/tournoi` (`<`, `>`, parenthèses) : le message est
 * publié tel quel dans un salon.
 * @param raw Texte saisi.
 * @returns L'URL normalisée, ou `null` si elle est refusée.
 */
export function normalizeTournamentLink(raw: string): string | null {
    const trimmed = raw.trim();
    if (trimmed.length === 0 || /[\s<>()]/.test(trimmed)) {
        return null;
    }
    let url: URL;
    try {
        url = new URL(trimmed);
    } catch {
        return null;
    }
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) {
        return null;
    }
    // Longueur mesurée après normalisation : l'encodage des caractères non
    // ASCII (`é` → `%C3%A9`) allonge l'adresse, et une adresse acceptée ici
    // puis refusée à la relecture serait remplacée en silence par le défaut.
    const normalized = url.toString();
    return normalized.length > MAX_TOURNAMENT_LINK_LENGTH ? null : normalized;
}

/**
 * Superpose les liens enregistrés aux liens par défaut ; une clé inconnue
 * ou une URL devenue invalide en base est ignorée.
 * @param stored Liens lus dans `TournamentLink` (clé → URL).
 * @returns Les trois liens à afficher.
 */
export function resolveTournamentLinks(stored: Record<string, string>): Record<TournamentLinkKind, string> {
    const links = { ...DEFAULT_TOURNAMENT_LINKS };
    for (const kind of TOURNAMENT_LINK_KINDS) {
        const url = stored[kind] ? normalizeTournamentLink(stored[kind]) : null;
        if (url) {
            links[kind] = url;
        }
    }
    return links;
}

/**
 * Message de `/tournoi`. Liens masqués entre chevrons : Discord n'en
 * déploie pas l'aperçu, trois cartes Google Docs noieraient le salon.
 * @param links Liens à afficher.
 * @returns Le texte du message.
 */
export function formatTournamentLinks(links: Record<TournamentLinkKind, string>): string {
    const lines = TOURNAMENT_LINK_KINDS.map((kind) => `- [${TOURNAMENT_LINK_LABELS[kind]}](<${links[kind]}>)`);
    return ["🏆 **Tournoi BlueGenji**", ...lines].join("\n");
}
