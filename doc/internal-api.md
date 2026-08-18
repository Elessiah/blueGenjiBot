# API interne du bot (BlueGenjiBot)

Le bot expose maintenant une API interne (Express) pour l'application Next.js.

## Variables d'environnement

- `INTERNAL_API_HOST` (défaut: `127.0.0.1`)
- `INTERNAL_API_PORT` (défaut: `4400`)
- `INTERNAL_API_TOKEN` (optionnel mais recommandé)

Si `INTERNAL_API_TOKEN` est défini, chaque requête doit envoyer l'en-tête:

- `x-internal-token: <INTERNAL_API_TOKEN>`

## Endpoints

- `GET /internal/stats`
  - Retourne les stats du bot (serveurs/channels/messages/users 30 jours).

- `POST /internal/auth/send-code`
  - Body: `{ "discordId": "123...", "code": "123456" }`
  - Envoie un DM Discord avec le code de connexion.

- `POST /internal/site-visits`
  - Body: instantané de fréquentation du site (`totalVisits`, `uniqueVisitors`,
    `visitsLast24h`, `uniqueVisitorsLast24h`, `visitsLast7Days`,
    `uniqueVisitorsLast7Days`, `visitsLast30Days`, `uniqueVisitorsLast30Days`,
    `identifiedVisitors`, `firstVisitAt`, `lastVisitAt`).
  - Poussé par l'app web, qui est seule à mesurer les visites. Le bot conserve
    uniquement le dernier instantané (table `SiteVisit`, une ligne) et le sert à
    la commande `/stats-site` — il n'appelle jamais le site en retour.
  - Un corps qui n'est pas un objet, ou sans aucun compteur, est refusé en 400
    (`INVALID_SITE_VISIT_STATS`) ; les champs manquants valent 0, de sorte
    qu'une version antérieure de l'app continue d'alimenter le bot.

- `POST /internal/log`
  - Body: `{ "message": "..." }`
  - Relaye un log vers `sendLog()`.
