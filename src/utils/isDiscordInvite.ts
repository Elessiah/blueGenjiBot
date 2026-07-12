const INVITE_REGEX = /^(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite)\/[A-Za-z0-9-]+\/?$/i;

/**
 * Vérifie qu'une chaîne est un lien d'invitation Discord valide.
 * Accepte les formats `discord.gg/xxx`, `discord.com/invite/xxx` et `discordapp.com/invite/xxx`,
 * avec ou sans protocole `http(s)://` ni `www.`.
 * @param url Chaîne à valider.
 * @returns `true` si l'URL correspond à un lien d'invitation Discord; sinon `false`.
 */
function isDiscordInvite(url: string): boolean {
    if (typeof url !== "string") {
        return false;
    }
    return INVITE_REGEX.test(url.trim());
}

/**
 * Normalise un lien d'invitation Discord en garantissant la présence du protocole `https://`.
 * Ne modifie pas un lien qui possède déjà un protocole.
 * @param url Lien d'invitation (supposé déjà validé par {@link isDiscordInvite}).
 * @returns URL préfixée par `https://` si nécessaire, sans espaces superflus.
 */
function normalizeInvite(url: string): string {
    const trimmed = url.trim();
    if (/^https?:\/\//i.test(trimmed)) {
        return trimmed;
    }
    return "https://" + trimmed;
}

export {isDiscordInvite, normalizeInvite};
