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
  - Ordre de recherche : les serveurs BlueGenji (`GUILD_ID`, sinon
    `SERV_GENJI` / `SERV_RIVALS`), puis les autres — cinq serveurs interrogés
    de front, jamais un par un. Le cache des membres n'est pas consulté : un
    pseudo qui a changé de titulaire y désignerait l'ancien.
  - Délai total de 2,5 s, sous les 3 s après lesquelles le site abandonne :
    à l'échéance, **504** (`BOT_RESOLVE_TIMEOUT`) et non 404 — des serveurs
    n'ont pas répondu, le joueur y est peut-être. Le site dit alors que la
    recherche n'a pas abouti à temps, et non que le tag est introuvable.

- `POST /internal/notify/dm`
  - Body: `{ "message": "...", "recipients": [{ "discordId": "123...", "handle":
    "pseudo", "label": "Pseudo du site" }], "context": "match-reminder" }`
  - Envoie un message privé à chaque destinataire. **L'app rédige le texte** :
    elle seule connaît le tournoi, le match et les équipes ; le bot ne sait que
    joindre les comptes. Un destinataire sans `discordId` est résolu par son
    `handle` (même résolution que `/internal/auth/resolve`) — les joueurs sont
    sur le serveur BlueGenji, l'ID n'est donc pas requis.
  - **Seuls les membres des serveurs BlueGenji sont démarchés** : le
    destinataire est d'abord retrouvé dans l'un d'eux, par ID quand l'app le
    connaît, par tag sinon. Absent de tous, aucun envoi n'est tenté — un tag
    mal saisi ne doit pas faire écrire le bot à un inconnu croisé sur un
    serveur partenaire. Les serveurs sont ceux de `SERV_GENJI` et
    `SERV_RIVALS` (un joueur de Marvel Rivals peut n'être que sur le second),
    ou ceux de `GUILD_ID` s'il est posé — surcharge facultative, une ou
    plusieurs valeurs séparées par des virgules.
  - **Aucun serveur joignable → `503` (`HOME_GUILD_UNAVAILABLE`)**, rien n'est
    envoyé. Ce n'est pas un bilan : le bot répondait `200` en déclarant tous
    les destinataires « introuvables », que l'app lit comme « absents du
    serveur » — un résultat définitif, qu'elle ne retente pas. La route
    n'envoyait donc plus rien depuis sa création (la variable `GUILD_ID` n'a
    jamais figuré dans la configuration réelle) sans qu'aucun statut ne le dise.
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
  - **Au plus 25 messages privés par serveur.** Le rôle est choisi à la main :
    `@everyone` est refusé à la configuration, mais rien n'empêche de désigner
    un rôle « Membre ». Sans cette borne, un seul signalement ferait écrire le
    bot à des centaines de comptes d'un coup — ce que Discord traite comme du
    spam et sanctionne par une suspension. Les membres écartés apparaissent dans
    `unresolved`, et le canal de logs le dit.
  - Même bilan de retour que `/internal/notify/dm`.

- `GET /internal/feed/stream`
  - Flux SSE des évènements d'activité (`FeedEvent`) : le backlog récent
    d'abord, puis le direct. `Last-Event-ID` reprend là où le lecteur s'était
    arrêté.
  - **Aucun évènement ne nomme une personne.** L'app web republie ce flux sur
    `/bot`, une page de vitrine que l'on lit **sans compte** : un évènement y
    disait « Code DM envoye a 100000000000000001 », et `recordEvent` rangeait le
    même identifiant dans la colonne `target` — donc en base et sans durée,
    d'où il repartait à chaque rattrapage d'historique. Un identifiant Discord
    n'est pas un secret, mais c'est une **coordonnée** : il suffit à écrire à
    la personne, horodatage de sa connexion à l'appui.
  - La règle est posée dans `recordEvent`, **unique écrivain** de la table, et
    non chez les appelants : aucun ne peut l'oublier, et une commande ajoutée
    demain en hérite sans une ligne. Mention (`<@id>`) comme identifiant nu sont
    remplacés par « un joueur » ; une colonne d'appoint qui n'**est** qu'un
    identifiant n'est pas enregistrée. Voir `src/feed/feedPrivacy.ts`.
  - Corriger l'écriture ne corrige pas ce qui est écrit : `purgeFeedIdentifiers()`
    répare au démarrage les lignes antérieures à la règle, **avant** l'ouverture
    de l'API interne. Idempotente, elle ne réécrit rien sur une base propre.

## Réponses d'erreur

Une erreur ne renvoie **jamais** le message de l'exception, seulement un code
stable en majuscules : `{ "error": "INTERNAL_STATS_ERROR" }`. Le détail — pile
d'appel, chemin de fichier, fragment de SQL — part au canal de logs Discord par
`sendLog()`, qui est l'endroit où l'exploitant le lit de toute façon.

Ce n'était pas le cas : huit routes écrivaient
`{ error: (error as Error).message || "INTERNAL_STATS_ERROR" }`, où le code
stable servait de **repli** à un message qu'on ne contrôle pas. L'API n'écoute
que sur `127.0.0.1` et exige `x-internal-token`, donc le lecteur est l'app sœur
— mais elle relaie ces réponses, et un code que l'appelant peut comparer vaut
mieux qu'une phrase qui change avec la version de SQLite.

Les codes en usage : `INTERNAL_FEED_ERROR`, `INTERNAL_STATUS_ERROR`,
`INTERNAL_STATS_ERROR`, `INTERNAL_KPIS_ERROR`, `INTERNAL_SERVERS_ERROR`,
`INTERNAL_ACTIVITY_ERROR`, `INTERNAL_MODULES_ERROR`,
`INTERNAL_MODULE_TOGGLE_ERROR`, plus les codes propres aux routes d'écriture
déjà décrits ci-dessus.

Cas particulier de `GET /internal/feed/stream` : les en-têtes SSE sont envoyés
d'emblée (`flushHeaders()`), si bien qu'une erreur survenant ensuite ne peut
plus répondre. Le flux est **fermé**, pas répondu — y poser un `res.status(500)`
levait `ERR_HTTP_HEADERS_SENT` depuis un `catch`, donc un rejet non capturé
qu'Express 4 ne rattrape pas.

## Rôle arbitre

Le rôle destinataire des signalements se configure par commande, serveur par
serveur (table `RefereeRole`, une ligne par serveur) :

- `/set-referee-role role:@Arbitres` — administrateur du serveur uniquement.
  `@everyone` est refusé : chaque signalement enverrait un message privé à tout
  le serveur.
- `/show-referee-role` — affiche le rôle configuré (tout le monde).
- `/reset-referee-role` — retire le rôle ; les signalements n'arrivent plus que
  dans le canal de logs.
