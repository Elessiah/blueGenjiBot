# Stack, commandes, architecture

Texte déplacé tel quel depuis `CLAUDE.md` (allègement du fichier chargé à chaque session) : `CLAUDE.md` n'en garde que les règles.

## Tests (`npm test`)

`npm test` **se place dans `dist/` et laisse Node découvrir** les fichiers, plutôt que de lui passer un motif `dist/tests/**/*.test.js` : ce motif n'est développé ni par bash sans `globstar`, ni par `--test` avant Node 22 — la commande passait donc en local (Node 24) et échouait en CI (Node 20).

## Stack

- **Node.js + TypeScript ESM** (strict). Imports avec extension `.js` obligatoire.
- **Deux TypeScript cohabitent.** `typescript-native` (alias npm de `typescript@^7`, le compilateur réécrit en Go) produit `dist/` — environ 3 s au lieu de 9. `typescript` (5.x) reste installé pour **typescript-eslint** (qui exige `<6.1`) et **ts-node** (`npm run dev`) : TypeScript 7 n'expose plus l'API JavaScript qu'ils appellent. Les deux paquets fournissent un binaire `tsc`, et celui que retient `node_modules/.bin` dépend de l'ordre d'installation : les scripts désignent donc leur compilateur **par chemin** (`node node_modules/<paquet>/bin/tsc`), jamais par `tsc` ni `npx tsc`. `baseUrl` a quitté `tsconfig.json` (retiré en TypeScript 7) : `paths` s'écrit `"@/*": ["./src/*"]`, lu pareil par les deux versions. Le lockfile porte les binaires natifs de toutes les plateformes, dont `@typescript/typescript-linux-arm64` pour le serveur. Même schéma que l'app sœur ; le passage complet attendra que typescript-eslint accepte la version 7. Câblage gardé par `tests/utils/typescriptWiring.test.ts`.
- **discord.js 14** — slash commands, intents : Guilds, GuildMembers, GuildMessages, MessageContent
- **Express 4** — API interne montée sur `/internal`, auth via header `x-internal-token`
- **SQLite** (`sqlite` + `sqlite3`) — base locale `database.sqlite`, accès via singleton `Bdd` (`src/bdd/Bdd.ts`)
- **`allowScripts` (package.json) — requis par npm 12**, qui tourne sur le serveur depuis le 24/09/2026 et bloque par défaut les scripts d'installation des dépendances. `sqlite3` **en a besoin** : son script `install` (`prebuild-install -r napi || node-gyp rebuild`) est ce qui pose `build/Release/node_sqlite3.node` — bloqué, `npm ci` réussit, le build aussi, et le bot meurt au démarrage sur `Could not locate the bindings file` (c'est ainsi que `updateBlueGenji.sh` a laissé le bot à terre ce jour-là). Il est donc **approuvé**, sans épingler la version : épinglé, la prochaine montée de `sqlite3` recasserait le déploiement de la même façon muette. `unrs-resolver` est **refusé** (`postinstall` de simple vérification, la liaison native arrive par sa dépendance optionnelle — même choix que le site). Un nouveau paquet à script s'annonce à la fin de `npm ci` (`npm warn install-scripts`) : le relire (`npm install-scripts ls`), puis l'approuver ou le refuser ici.
- **node-cron** — tâches périodiques (vérif adhésion, etc.)
- **pm2** — process manager pour la prod, **installé globalement sur le serveur**. Il n'est *pas* une dépendance du projet : rien ne l'importe, il n'apparaissait que dans des commentaires, et la copie que `npm ci` posait dans `node_modules` ne servait qu'à traîner l'avis `js-yaml`. `mongoose` et `gridfs-stream` sont partis pour la raison voisine — reliquats de l'ère MongoDB, plus référencés nulle part depuis le passage à SQLite.

## Architecture (`src/`)

```
src/
├── main.ts                 # entrypoint : client Discord + API interne + cron
├── internalApi.ts          # serveur Express pour l'app web
├── types.ts                # types partagés
├── bdd/                    # singleton SQLite Bdd, types, helpers (deleteDPMsgs)
├── commandsHandlers/       # handlers de commandes slash
│   ├── adhesions/          # parcours d'adhésion partenaire
│   ├── admin/              # commandes admin
│   ├── services/           # gestion des services (resetChannel, resetServer)
│   ├── ban/, broadcast.ts, contactAdminServer.ts, printHelp.ts
├── adhesion/               # logique d'adhésion : rappels (checkIntervalleAdhesion…) ; envoi
│                           #   sendAdhesion → adhesionAttachments, adhesionRecipients, adhesionDelivery
│                           #   (textes : adhesionNotices, journal : adhesionLog)
├── check/                  # checks runtime (checkBan…)
├── messages/               # buildServiceMessage, manageDistribution
├── safe/                   # wrappers défensifs : safeReply, sendLog
├── config/                 # commandes statiques + fillBlueCommands (dynamiques)
├── utils/                  # updateCommands, helpers divers
└── tests/                  # node:test
```

**Singleton DB** : `getBddInstance()` / `closeBddInstance()` depuis `bdd/Bdd.js`. Les méthodes `set()` et `partnerHasRanks()` ont été sécurisées récemment contre l'injection SQL — toute nouvelle méthode d'accès BDD **doit** utiliser des requêtes paramétrées.

**Logging** : `sendLog(client, message)` poste dans le channel de logs Discord. Toujours wrapper les opérations BDD dans try/catch + sendLog.

**Réponses Discord** : utiliser `safeReply()` plutôt que `interaction.reply()` directement (gère déjà les erreurs et les interactions expirées).

## Conventions

- **Tout en français** côté UI/messages utilisateur.
- **Imports ESM** : toujours suffixer `.js` (même pour les fichiers `.ts`), TypeScript ESM l'exige.
- **Requêtes SQL** : exclusivement paramétrées via `Bdd.get/set/...`. Jamais de concat de strings. Seule exception : un **nom** de table ou de colonne tiré d'une constante du code (`GUILD_CONFIG_TABLES`, `GUILD_CHANNEL_TABLE`), vérifié par `assertSqlIdentifier` au chargement du module — les valeurs, elles, restent toujours bindées.
- **Flux d'activité** : rien de ce qui entre dans `recordEvent()` ne doit nommer une personne. L'app web republie ce flux sur `/bot`, page de vitrine lue **sans compte**, et la table `FeedEvent` conserve ses lignes 30 jours (`FEED_EVENT_RETENTION_DAYS`, purge de `runDataRetention`) — un identifiant écrit ici repart à chaque rattrapage d'historique jusque-là. `feed/feedPrivacy.ts` remplace mention et identifiant nu par « un joueur » ; la règle est posée dans `recordEvent`, **unique écrivain**, jamais chez l'appelant. Un évènement dit *ce qui se passe*, jamais *à qui*.
- **Erreurs runtime** : try/catch + `sendLog()` ; ne jamais laisser une exception planter le bot.
  `installProcessGuards()` (`safe/processGuards.ts`) capte `unhandledRejection`,
  `uncaughtException` et les événements `error`/`shardError` du client — sans quoi une
  coupure DNS suffit à tuer le process. `reportError()` trie les erreurs via
  `safe/errorGuards.ts` : les pannes réseau et les cibles Discord disparues (10008,
  10062, 50013…) restent en console, le reste part au canal de supervision.
  **Tout listener `client.on(...)` et tout callback `cron`/`setTimeout` doit avoir sa
  propre garde** : ils s'exécutent hors de toute pile applicative.
- **Réactions Discord** : `safeReact()` plutôt que `message.react()` — un message
  supprimé entre-temps lève un `10008` qui interromprait la diffusion en cours.
- **Commandes Discord** : enregistrer via `updateCommands()`, déclarer dans `config/commands.ts` (statiques) ou `fillBlueCommands()` (dynamiques).
- **Tests** : runner natif `node:test` sur le build (`dist/`), pas de transpil à la volée.
- **Lint** : ESLint 10, configuration « flat » dans `eslint.config.js` (`@eslint/js` + `typescript-eslint`, recommandés). Le périmètre est **`src/` seul** (`ignores` de la configuration) : sans lui, `eslint .` partait analyser `dist/`. L’ancien point d’entrée compilé `src/main.js`, ni compilé (`allowJs: false`) ni référencé, a été retiré du dépôt : le seul point d’entrée est `src/main.ts` → `dist/main.js`. Aucun plugin `import` : il n’était chargé que pour que quatre `eslint-disable` résolvent des règles jamais activées, et ESLint 10 signale un tel commentaire comme inutile. Le seul avis `deprecated` restant à l’installation, `prebuild-install`, vient de `sqlite3` et ne se corrige pas de notre côté.

## Project Overview

**BlueGenjiBot** est le bot Discord de la plateforme BlueGenji Arena (esports amateur Marvel Rivals / Overwatch 2, FR). Il gère :
- Les commandes slash Discord (adhésion, services partenaires, ban, broadcast, admin)
- Une API HTTP interne (`internalApi.ts`) consommée par l'app web sœur `appbluegenji` (auth DM codes, stats, logs de conflits)
- La distribution de messages, les vérifications cron (intervalles d'adhésion), les channels partenaires

Projet sœur : `C:\work\BlueGenji\appbluegenji` (Next.js 15, MySQL). Le bot reçoit du token interne via `INTERNAL_API_TOKEN`, qui doit correspondre à `BOT_INTERNAL_TOKEN` côté web.

## CI

`.github/workflows/ci.yml` vérifie chaque PR vers `main` : **lint → build → test**, enchaînés par `needs:`. Un lint rouge rend le reste sans objet, et le build est un prérequis réel des tests (`node --test` lit `dist/`). Ne pas merger sur un CI rouge.
