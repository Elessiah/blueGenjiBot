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
  - Retourne les stats du bot : `affiliatedServers`, `affiliatedChannels`,
    `messagesLast7Days`, `relayedMessagesLast7Days`, `uniqueUsersLast7Days`
    et `windowDays` (7).
  - Les compteurs de messages ne regardent pas plus loin que la purge des
    messages relayés (`MESSAGE_RETENTION_DAYS`, 7 jours) : annoncés sur
    30 jours (`…Last30Days`), ils n'en voyaient que sept. Même fenêtre pour
    `GET /internal/kpis` (tuiles « messages » et « relais » : `delta: null`,
    la période précédente étant déjà purgée ; `windowDays` dans la réponse)
    et `GET /internal/servers` (`relays7j` au lieu de `relays30j`,
    `windowDays` dans la réponse). Le site lit les deux noms pendant le
    déploiement.

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
    de front, jamais un par un. Les serveurs BlueGenji ne retiennent pas les
    autres plus de 1,2 s : un serveur qui ne répond pas ne bloque pas les
    partenaires. Le cache des membres n'est pas consulté : un pseudo qui a
    changé de titulaire y désignerait l'ancien.
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

- `POST /internal/notify/leadership`
  - Body: `{ "message": "...", "context": "content-report" }`
  - Alerte la **direction de l'association** d'un signalement reçu par le site
    (contenu illicite, modération, bug) ou d'une contestation : le message part
    dans le canal de logs (`sendLog()`) **et** en privé au propriétaire du bot
    (`OWNER_ID`) et au président (`PRESIDENT`). Le site ne connaît pas ces deux
    comptes : ils ne sont écrits que dans la configuration du bot.
  - Les deux destinataires sont joints **par leur identifiant**, sans passer par
    les serveurs BlueGenji. Une valeur vide ou mal formée est ignorée, et une
    même personne aux deux postes ne reçoit qu'un message.
  - L'app n'y met **aucune donnée nominative** : ni pseudo de joueur, ni nom ou
    adresse du signalant, ni description — seulement la catégorie, les équipes
    et tournois visés, le nombre de joueurs et le lien du panneau.
  - Même bilan de retour que `/internal/notify/dm` (`failed` liste les
    identifiants injoignables).

- `POST /internal/announce/live`
  - Body: `{ "message": "...", "streamUrl": "https://twitch.tv/...", "context": "live-announce tournoi-7 match-42", "logMessage": "..." }`
    (`logMessage` facultatif, voir plus bas)
    (`context`, étiquette des journaux : 200 caractères au plus, au-delà elle
    est coupée et se termine par « … » ; lettres, chiffres, espace et `, + … _ -`
    seulement, tout autre caractère devient `_`)
  - **Jeton exigé** : même quand le bot n'écoute que la boucle locale, cette
    route refuse de publier sans `INTERNAL_API_TOKEN` (`503
    INTERNAL_API_TOKEN_NOT_CONFIGURED`) — c'est la seule qui notifie tout le
    serveur.
  - Annonce un **live** au début d'un match diffusé : le bot publie
    `@everyone <message>` puis le lien, seul sur sa ligne, dans le salon #live
    du serveur BlueGenji. Ce salon est fixé dans le code (constante
    `LIVE_ANNOUNCE_CHANNEL_ID`), pas par une variable d'environnement. C'est le
    seul message du bot qui notifie tout le serveur : la mention n'est
    autorisée (`allowedMentions: { parse: ["everyone"] }`) que pour cet envoi.
  - Le site décide du moment (un match et son affiche ne sont annoncés
    qu'une fois, seuls ou dans un message groupé) et rédige
    le texte : les deux équipes et le tournoi, noms neutralisés. Quand
    `message` nomme le pseudo d'une entrée individuelle, le site envoie aussi
    `logMessage`, le même texte où ce pseudo devient « un joueur » : c'est
    lui, jamais `message`, que le canal de logs cite. `logMessage` se valide
    comme `message` (texte non vide, mêmes neutralisations, même longueur) ;
    présent mais vide ou d'un autre type, la requête est refusée (`400
    INVALID_LIVE_ANNOUNCEMENT`) plutôt que de citer le pseudo au staff.
    Absent, `message` (qui ne nomme alors aucun joueur) est cité. Des
    matchs d'un même tournoi passés à l'antenne ensemble sur le même lien
    partent en un seul message de plusieurs lignes (« 🔴 En direct — Tournoi : »
    puis « • A contre B » par match) ; `context` les cite alors tous
    (`live-announce tournoi-7 match-12,13`).
  - `streamUrl` doit être un lien `https` vers Twitch, YouTube ou Kick, sans
    identifiants ni port, sans espace ni caractère de contrôle, ni page de
    redirection (`/redirect`, `/attribution_link`) ni autre adresse dans son
    chemin ou sa requête, 255 caractères au plus : sinon `400 INVALID_LIVE_ANNOUNCEMENT`, comme pour un message
    vide. Le bot publie sa forme normalisée (`<` et `>` percent-encodés) : le
    lien ne peut porter ni texte, ni lien masqué, ni mention. Redirections et
    adresses glissées sont cherchées après décodage complet (y compris
    `https:\\`, `//hôte` et double encodage). Dans `message`, `://` et `](`
    sont coupés d'une espace de largeur nulle : `streamUrl` est le seul lien
    cliquable de l'annonce. Le message est
    raccourci d'un « … » (1 800 caractères au plus, puis ce qu'il faut pour que
    mention, texte et lien tiennent dans les 2 000 caractères d'un message
    Discord).
  - Retour `{ "posted": true, "mentionEveryone": boolean, "embedLinks": boolean }`.
    Sans la permission « Mentionner @everyone, @here et tous les rôles » dans
    le salon, le message part **sans** la mention (`mentionEveryone: false`) ;
    sans « Intégrer des liens », il part sans aperçu de la chaîne
    (`embedLinks: false`). Le canal de logs le signale dans les deux cas.
  - `503 { "error": "LIVE_CHANNEL_UNAVAILABLE", "reason": "<nature>" }` : le
    bot n'a pas pu publier, ou pas pu confirmer la publication. `reason` :
    - `missing`, `no-view`, `no-send`, `send-denied` — salon introuvable ou
      permission manquante ;
    - `automod` — une règle AutoMod du serveur a bloqué le message ; si la
      règle a l'action « Envoyer une alerte », c'est Discord, pas le bot, qui
      recopie le message bloqué (`message`, pseudo compris) dans le salon
      d'alerte de la règle : ce salon ne doit pas être le canal de logs, et
      seuls les modérateurs doivent le lire ;
    - `send-rejected` — Discord a refusé le message pour une autre raison,
      souvent l'état du salon (type, verrouillage) ;
    - `discord-unreachable` — Discord n'a pas répondu en lisant le salon,
      avant tout envoi ;
    - `discord-down` — Discord a lâché **pendant** l'envoi : le message a pu
      partir malgré tout.
  - `500 LIVE_ANNOUNCEMENT_FAILED` pour toute autre panne.
  - Ce que fait le site : il garde l'annonce sur un succès ; sur un `400` (la
    requête elle-même est refusée avant tout envoi, la renvoyer n'y changerait
    rien) ; sur un `503` `automod` (AutoMod bloquerait de nouveau le même
    message, et chaque essai alerterait la modération) ; et sur un délai dépassé ou un
    `503` `discord-down` — le bot a pu publier, elle n'est pas réessayée, pour
    ne jamais notifier deux fois tout le serveur. Sur tout
    autre `503`, un `500` (panne avant l'envoi) ou un bot injoignable
    (connexion refusée), il la reprend et réessaie tant que le match a
    commencé depuis moins de deux heures ; une connexion coupée avant la
    réponse (bot redémarré pendant l'envoi) la garde : l'annonce a pu partir.
  - Le canal de logs : la réponse part **avant** le signalement (un canal lent
    ne fait pas dépasser le délai du site). Il dit la cause, l'action à mener
    et cite l'annonce concernée (`logMessage` s'il est fourni, sinon
    `message` : jamais un pseudo) et son lien pour la reconnaître, en tenant
    toujours dans un message Discord (citation raccourcie au besoin), sans
    qu'aucune mention n'y notifie (`allowedMentions: { parse: [] }`). Une
    annonce « non publiée » pour une cause qui peut se régler (salon,
    permission, refus lié à l'état du salon, Discord injoignable) est réessayée par le site : la reposter à la main
    pendant ces deux heures notifierait deux fois tout le serveur ; comme le
    site réessaie environ toutes les minutes, une même cause n'est signalée qu'**une
    fois par heure** (d'autres annonces peuvent alors échouer pour elle sans
    nouveau signalement). Une annonce « non confirmée » (`discord-down`) n'est
    pas réessayée : chacune est signalée (vérifier #live), comme chaque blocage
    par AutoMod, et toute annonce dont le site avait
    déjà coupé la requête (délai dépassé) — le signalement le dit alors, au
    lieu de promettre un nouvel essai. Pour ces annonces que le site ne
    réessaie pas, hors panne pendant l'envoi, rien n'est parti : le
    signalement dit qu'elle peut être postée à la main sans doublon, avec
    « @everyone » en tête et le texte entier si la citation est raccourcie ou
    sans pseudo (après un
    blocage AutoMod, une fois la règle corrigée — ni le texte ni le lien n'y
    sont cités, la même règle pourrait bloquer le signalement : le staff
    reprend les affiches depuis la fiche du tournoi, dont le numéro suit
    « tournoi- » dans l'étiquette). Une annonce que le site
    réessaie ne se poste pas à la main pendant ces deux heures. Le canal de
    logs ne reçoit jamais de mention de masse : « @everyone » et « @here » y
    sont neutralisés.
    Un signalement qui n'a pas pu partir (canal de logs illisible, Discord
    surchargé) ne compte pas : le suivant partira. Un envoi tenté sans
    réponse claire compte, pour ne pas doubler un signalement arrivé.
  - Chaque envoi porte un jeton d'unicité (`nonce`, `enforceNonce`) tiré de
    l'étiquette et du lien : Discord ne crée pas deux fois ce même envoi s'il
    est rejoué dans les quelques minutes (nouvel essai interne de discord.js
    après une réponse perdue). Il n'arrête pas une annonce postée à la main.
  - Une mention `@everyone` ou `@here` glissée dans le texte est neutralisée :
    seule celle de tête notifie. La syntaxe de mention d'un membre, d'un rôle
    ou d'un salon (`<@id>`, `<@!id>`, `<@&id>`, `<#id>`) est coupée d'une
    espace de largeur nulle dans `message` et `logMessage` : sans notifier,
    Discord l'afficherait sous le nom actuel du membre. Un retour chariot
    (`\r`, `\r\n`) y devient un saut de ligne `\n` : chaque ligne citée au
    canal de logs garde son « > ».
  - Déploiement : le bot passe **avant** (ou avec) un site qui envoie
    `logMessage`. Un bot plus ancien ignore ce champ et citerait `message`,
    pseudo compris, au canal de logs.

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
déjà décrits ci-dessus. `GET /internal/servers/:id/modules` et
`PUT /internal/servers/:id/modules/:moduleKey` répondent en outre
`404 GUILD_NOT_JOINED` pour un serveur que le bot n'a pas rejoint : le
réglage serait effacé au prochain rattrapage des serveurs quittés, on le refuse
plutôt que de répondre 200 pour une écriture vouée à disparaître.

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
