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

- `POST /internal/auth/resolve`
  - Body: `{ "handle": "pseudo" }` (ID numérique, `pseudo`, ou legacy
    `pseudo#1234`).
  - Retourne `{ "discordId": "...", "matchedBy": "id" | "tag" }`, ou 404
    (`DISCORD_USER_NOT_FOUND`) si aucun membre des serveurs du bot ne
    correspond. Seul le `username` est comparé : `globalName` et le surnom de
    serveur ne sont pas uniques.
  - Balaye **tous** les serveurs du bot, contrairement à `/internal/notify/dm` :
    un membre d'un serveur partenaire doit pouvoir se connecter au site sans
    être sur le serveur BlueGenji.

- `POST /internal/notify/dm`
  - Body: `{ "message": "...", "recipients": [{ "discordId": "123...", "handle":
    "pseudo", "label": "Pseudo du site" }], "context": "match-reminder" }`
  - Envoie un message privé à chaque destinataire. **L'app rédige le texte** :
    elle seule connaît le tournoi, le match et les équipes ; le bot ne sait que
    joindre les comptes. Un destinataire sans `discordId` est résolu par son
    `handle` (même résolution que `/internal/auth/resolve`) — les joueurs sont
    sur le serveur BlueGenji, l'ID n'est donc pas requis.
  - **Seuls les membres du serveur BlueGenji sont démarchés** (`GUILD_ID`) : le
    destinataire est d'abord retrouvé dans cette guilde, par ID quand l'app le
    connaît, par tag sinon. Absent de la guilde, aucun envoi n'est tenté — un
    tag mal saisi ne doit pas faire écrire le bot à un inconnu croisé sur un
    serveur partenaire. Sans `GUILD_ID` configuré, rien n'est envoyé du tout.
  - Le message est tronqué à 1800 caractères, les destinataires dédoublonnés
    (par ID, à défaut par tag en minuscules) et bornés à 100 par appel. Un corps
    sans message ou sans destinataire joignable est refusé en 400
    (`INVALID_NOTIFICATION_PAYLOAD`).
  - Retourne `{ "sent": n, "unresolved": ["..."], "failed": ["..."] }` :
    `unresolved` = absent du serveur BlueGenji, `failed` = membre du serveur mais
    injoignable (DM fermés). Un échec de remise est un **résultat**, pas une
    erreur : l'app peut dire au staff qui n'a pas été prévenu.

- `POST /internal/notify/referees`
  - Body: `{ "message": "...", "context": "issue-report" }`
  - Poste le message dans le canal de logs (`sendLog()`) **et** l'envoie en
    privé à chaque membre du rôle arbitre configuré, sur chaque serveur qui en a
    défini un (`/set-referee-role`). Les deux canaux, pas l'un ou l'autre : le
    log garde la trace même si aucun arbitre n'est joignable.
  - Sans rôle configuré, seul le log part — l'endpoint répond quand même 200.
  - Même bilan de retour que `/internal/notify/dm`.

## Rôle arbitre

Le rôle destinataire des signalements se configure par commande, serveur par
serveur (table `RefereeRole`, une ligne par serveur) :

- `/set-referee-role role:@Arbitres` — administrateur du serveur uniquement.
- `/show-referee-role` — affiche le rôle configuré (tout le monde).
- `/reset-referee-role` — retire le rôle ; les signalements n'arrivent plus que
  dans le canal de logs.
