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
sans la mention de l'auteur, `isGetiRelayMessage`), les messages de tout autre bot (le nôtre compris), les messages
système, les messages sans auteur. Le bot ne lit rien dans le texte : le site
analyse (`parseGetiPost`), si bien qu'améliorer l'analyse ne demande pas de
redéployer le bot — un redémarrage du bot suffit à faire ré-analyser les annonces
gardées, puisque le rattrapage les repousse toutes.

## Règles à tenir

- **Rien n'est écrit sur Discord** : ni réponse, ni réaction, ni modification —
  pas même un message d'erreur au salon de supervision. Le relais ne journalise
  que dans pm2 (`console`), des **nombres** et des **identifiants de salon** ;
  jamais un pseudo, jamais un texte.
- **Rien n'est gardé** par le bot : ni base, ni fichier. La file d'envoi et la
  liste des messages supprimés pendant un rattrapage vivent en mémoire.
- **Le partiel `Message`** (`config/clientOptions.ts`) est nécessaire : sans lui,
  discord.js tait la modification et la suppression d'un message hors cache, et
  le site garderait une annonce supprimée sur Discord. Il a un effet de bord sur
  les écouteurs historiques de `main.ts` : `messageUpdate` ignore expressément un
  message partiel (comportement d'avant conservé), `messageDelete` retire
  désormais aussi les copies d'un message d'origine hors cache.
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
les rejoue), et toutes les cinq minutes tant qu'un envoi perdu n'a pas été
rattrapé (`tick`). Par salon : pages de 100 messages jusqu'à la fenêtre de garde
(750 ms entre deux pages, 50 pages au plus), chaque page poussée par lots, puis
`reconcile` avec **tous** les identifiants lus sur la fenêtre (annonces ou non) —
le site retire ce qu'il garde et qui n'y est plus. Pas de réconciliation si un
lot a été perdu ou si le salon est illisible ; un refus définitif de Discord
(salon inconnu, accès ou permission manquants) ne relance pas le rattrapage en
boucle. Un message supprimé pendant le rattrapage n'est ni repoussé ni compté
présent.

## Prérequis sur Discord

Sur les six salons : **Voir le salon**, **Voir les anciens messages**. Intentions
`Guilds`, `GuildMessages`, `MessageContent` (déjà demandées). À vérifier pour le
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
