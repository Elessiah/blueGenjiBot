# Relais des annonces GETI vers le site

Le site BlueGenji réunit sur une page (`/geti-info`) les annonces de recrutement
Overwatch publiées dans six salons du serveur BlueGenji. Le bot en est la seule
source : il lit ces salons et **pousse** chaque annonce au site. C'est le second
appel bot → site, après `/message-tournoi` (contrat public : `doc/internal-api.md`).

## Ce qui est recopié

Salons et durées : `GETI_CHANNELS` (`src/geti/getiPayload.ts`) — `lfp`, `lft`,
`lfsub`, `lfstaff`, `lfcast` : 14 jours ; `lfs` (scrims) : 7 jours. **Ces
identifiants et ces durées sont recopiés du site** (`GETI_CHANNEL_IDS`,
`GETI_RETENTION_DAYS`, `lib/shared/geti/` d'AppBlueGenji) : les changer d'un côté
sans l'autre fait rattraper trop ou trop peu.

Deux sortes d'annonces, toutes deux poussées (`isGetiPost`) :

- **directe** — un membre écrit dans le salon ; sa modification et sa suppression
  sont celles de son message ;
- **relais** — GETI Bot (`GETI_BOT_USER_ID`) relaie l'annonce d'un serveur abonné
  à son réseau : contenu vide, un encart dont la description porte l'auteur, son
  pseudo, le serveur d'origine, puis le texte cité. C'est la modification ou la
  suppression du relais par GETI Bot qui est suivie.

Sont laissés : les avis de GETI Bot qui ne sont pas des relais (premier encart
sans l'en-tête d'un relais — mention de l'auteur, `(pseudo)`, puis `sur`/`on`/`from` —, `isGetiRelayMessage`), les messages de tout autre bot (le nôtre compris), les messages
système, les messages sans auteur. Le bot ne lit rien dans le texte : le site
analyse (`parseGetiPost`), si bien qu'améliorer l'analyse ne demande pas de
redéployer le bot — un redémarrage du bot suffit à faire ré-analyser les annonces
gardées, puisque le rattrapage les repousse toutes.

## Règles à tenir

- **Rien n'est écrit sur Discord** : ni réponse, ni réaction, ni modification —
  pas même un message d'erreur au salon de supervision. Le relais ne journalise
  que dans pm2 (`console`), des **nombres** et des **identifiants de salon** ;
  jamais un pseudo, jamais un texte. C'est une **exception assumée** à la règle
  « try/catch + `sendLog()` » : un relais de plusieurs centaines d'appels par
  rattrapage noierait le salon de supervision au moindre arrêt du site ; chaque
  écouteur garde son try/catch, seul `sendLog()` est remplacé par pm2. Un refus
  401/403 du site (jeton, boucle locale) y a sa ligne propre (`refus 401`), une seule
  par statut (un 403 après un 401 a la sienne, une alternance 401/403 n'en ajoute plus), jusqu'à une autre réponse du site.
- **Rien n'est gardé** par le bot : ni base, ni fichier. La file d'envoi et la
  liste des messages supprimés ou modifiés en direct pendant un rattrapage
  vivent en mémoire, comme le cache de messages de discord.js (200 derniers
  messages reçus par salon, effacé au redémarrage, ce que dit la politique). Une version en direct n'est jamais écrasée par la page
  d'historique lue avant elle. Un lot perdu (site muet) arrête le rattrapage :
  le reste de l'historique attend le rattrapage dû, toutes les cinq minutes.
- **Le partiel `Message`** (`config/clientOptions.ts`) est nécessaire : sans lui,
  discord.js tait la modification et la suppression d'un message hors cache, et
  le site garderait une annonce supprimée sur Discord. Il a un effet de bord sur
  les écouteurs historiques de `main.ts` : `messageUpdate` ignore expressément un
  message partiel (comportement d'avant conservé), `messageDelete` retire
  désormais aussi les copies d'un message d'origine hors cache. Un message
  partiel est relu (`message.fetch()`) avant d'être poussé : une suppression
  reçue pendant cette relecture l'annule (`onLoadedMessage`), et pendant un
  rattrapage une suppression reste acquise jusqu'à sa fin (Discord ne rend pas
  un message supprimé), à la différence d'un relais changé en avis, qui
  redevient présent s'il redevient une annonce.
- **Chaque écouteur a sa garde** (`registerGetiRelay`), comme partout.

## Mécanique

| Fichier | Rôle |
| --- | --- |
| `getiPayload.ts` | salons, durées, `isGetiPost`, forme poussée (`toGetiWirePost`), découpe en lots (20 annonces, 200 Ko) |
| `getiSiteClient.ts` | `sendGetiOp` : `ok`, `retry` (site muet, 401/403/429/5xx) ou `drop` (corps refusé : 400/413/415) ; ne lève jamais |
| `getiQueue.ts` | file en mémoire (500 opérations), un envoi à la fois dans l'ordre ; reprises à 2, 5, 15, 30 s puis abandon (`lost`) ; après un abandon, un seul essai par envoi jusqu'au prochain succès ; une suppression retire l'annonce des lots encore en attente |
| `getiRelay.ts` | écouteurs, rattrapage, réconciliation, rattrapage différé |

Rattrapage (`GetiRelay.backfill`) : au `clientReady`, à chaque `shardReady`
suivant (nouvelle session : des événements ont pu manquer — une simple reprise
les rejoue), à l'exclusion d'un membre du relais et à sa levée (`/ban`,
`/unban` → `requestGetiResync` : ses annonces directes quittent le site ou y
reviennent), et toutes les cinq minutes tant qu'un envoi perdu ou une lecture de salon
en échec passager n'a pas été
rattrapé (`tick`) : un envoi perdu relit les six salons, une lecture de salon en échec
passager ne relit que ce salon (les cinq autres ne sont pas renvoyés au site
toutes les cinq minutes pour rien). Une première page vide n'est pas une preuve
(un salon que Discord rendrait vide un instant ferait retirer ses annonces du
site) : ce salon n'est pas réconcilié, `[geti] salon <id> rendu vide`. Un 429 du
site est attendu selon son `Retry-After` (60 s au plus) avant la reprise de la
file. Le site écrit un lot en une seule instruction, lit la liste par catégorie
avec une lecture gardée dix secondes (oubliée à chaque écriture) et purge par
500 lignes. Côté bot, `DPMsg.id_og` est indexé (`DPMSG_OG_INDEX`) : le partiel
`Message` fait partir `messageDelete` pour tout message hors cache de tout
serveur, et `deleteDPMsgs` cherche les copies par cette colonne (chaque copie a
sa garde : un salon disparu ou une copie déjà supprimée — codes 10003, 10008 —
ne laisse plus les suivantes en place ni ne remonte en erreur). Une relecture de
message partiel qui échoue autrement que par « message inconnu » (10008) fait
relire son salon au passage des cinq minutes (`noteChannelLost`). Les annonces
directes d'un exclu du relais (`Ban`, lu par `readBanVerdict`, sans avis ni
journal Discord) ne partent pas et ne comptent pas présentes : la
réconciliation les retire du site ; une base illisible les laisse partir, et
marque leur salon à relire au passage des cinq minutes (`[geti] exclusion
illisible dans le salon <id>`), pour que l'annonce d'un exclu passée ainsi
quitte le site dès que la base répond. Un
rattrapage garde le verdict de chaque auteur lu dans l'historique (une lecture
par auteur), sauf un verdict illisible, relu à l'annonce suivante ; les messages
en direct relisent toujours la base, et `/ban` / `/unban` vident ces verdicts
(`requestGetiResync`) avant de relancer un rattrapage, demandé dès l'exclusion
écrite. Par salon : pages de 100 messages jusqu'à la fenêtre de garde
(750 ms entre deux pages, 50 pages au plus), chaque page poussée par lots, puis
`reconcile` avec les identifiants des **annonces** lues sur la fenêtre (un relais
changé en avis n'en est plus une : le site le retire, comme à sa modification en
direct) —
le site retire ce qu'il garde et qui n'y est plus. Pas de réconciliation si un
lot a été perdu ou si le salon est illisible ; un refus définitif de Discord
(salon inconnu, accès ou permission manquants) ne relance pas le rattrapage en
boucle : ce salon n'est relu qu'au prochain rattrapage dû à une autre cause
(ce que dit la politique). Un message supprimé pendant le rattrapage n'est ni repoussé ni compté
présent ; une annonce poussée en direct pendant le rattrapage compte présente, même
si sa page d'historique a été lue avant (relais changé en avis puis rétabli). Un lot
dont toutes les annonces ont changé en direct n'est pas envoyé.

## Prérequis sur Discord

Sur les six salons : **Voir le salon**, **Voir les anciens messages**. Intentions
`Guilds`, `GuildMessages`, `MessageContent` (déjà demandées), rien de plus.
Le bannissement Discord d'un membre (`guildBanAdd`) n'est **pas** écouté : Discord
ne l'envoie qu'à un bot qui a **Bannir des membres** ou **Voir les logs du
serveur**, permissions que le relais n'a pas à recevoir (moindre privilège).
Les messages qu'un bannissement efface, que Discord ne signale pas un à un,
restent donc sur le site jusqu'au prochain rattrapage ou à la fin de leur durée
de garde. À vérifier pour le
bot de production avant la première mise en ligne : un salon illisible est
journalisé `[geti] salon <id> illisible (<code>)` et reste vide côté site.

## Données personnelles

Le bot lit des annonces publiques et les transmet au site, sur la même machine,
sans les garder : politique de confidentialité du bot (source :
`lib/shared/bot-legal-content.ts` d'AppBlueGenji, copie dans `LegalTerms/`),
registre du site T08 et T21.

## Tests

`src/tests/geti/` : `getiPayload.test.ts` (forme, filtres, lots, appel du site),
`getiQueue.test.ts`, `getiRelay.test.ts` (écouteurs, rattrapage, réconciliation,
durée par salon) ; `src/tests/config/clientOptions.test.ts` (partiel).
