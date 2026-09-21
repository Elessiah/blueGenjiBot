# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

**BlueGenjiBot** est le bot Discord de la plateforme BlueGenji Arena (esports amateur Marvel Rivals / Overwatch 2, FR). Il gère :
- Les commandes slash Discord (adhésion, services partenaires, ban, broadcast, admin)
- Une API HTTP interne (`internalApi.ts`) consommée par l'app web sœur `appbluegenji` (auth DM codes, stats, logs de conflits)
- La distribution de messages, les vérifications cron (intervalles d'adhésion), les channels partenaires

Projet sœur : `C:\work\BlueGenji\appbluegenji` (Next.js 15, MySQL). Le bot reçoit du token interne via `INTERNAL_API_TOKEN`, qui doit correspondre à `BOT_INTERNAL_TOKEN` côté web.

## Commands

```bash
npm run dev          # nodemon + ts-node ESM loader
npm run build        # tsc && tsc-alias (résout les @/* en chemins relatifs)
npm start            # node dist/main.js
npm run lint         # ESLint
npm test             # build puis node --test sur dist/tests/**/*.test.js
npm run docs         # build + jsdoc
```

Test ciblé après build : `node --test "dist/tests/path/to/file.test.js"`.

`npm test` **se place dans `dist/` et laisse Node découvrir** les fichiers, plutôt que de lui passer un motif `dist/tests/**/*.test.js` : ce motif n'est développé ni par bash sans `globstar`, ni par `--test` avant Node 22 — la commande passait donc en local (Node 24) et échouait en CI (Node 20).

## Stack

- **Node.js + TypeScript ESM** (strict). Imports avec extension `.js` obligatoire.
- **discord.js 14** — slash commands, intents : Guilds, GuildMembers, GuildMessages, MessageContent
- **Express 4** — API interne montée sur `/internal`, auth via header `x-internal-token`
- **SQLite** (`sqlite` + `sqlite3`) — base locale `database.sqlite`, accès via singleton `Bdd` (`src/bdd/Bdd.ts`)
- **node-cron** — tâches périodiques (vérif adhésion, etc.)
- **pm2** — process manager pour la prod, **installé globalement sur le serveur**. Il n'est *pas* une dépendance du projet : rien ne l'importe, il n'apparaissait que dans des commentaires, et la copie que `npm ci` posait dans `node_modules` ne servait qu'à traîner l'avis `js-yaml`. `mongoose` et `gridfs-stream` sont partis pour la raison voisine — reliquats de l'ère MongoDB, plus référencés nulle part depuis le passage à SQLite.

## Path Alias

`@/*` → `src/*` (configuré dans `tsconfig.json`, résolu au build par `tsc-alias`).

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
├── adhesion/               # logique d'adhésion (checkIntervalleAdhesion…)
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

## Environment Variables

```env
DISCORD_TOKEN=
CLIENT_ID=
GUILD_ID=                       # serveur principal pour register cmds
INTERNAL_API_TOKEN=             # doit matcher BOT_INTERNAL_TOKEN côté appbluegenji
INTERNAL_API_PORT=4400          # défaut
LOG_CHANNEL_ID=                 # channel Discord pour sendLog
BACKUP_STATUS_PATH=             # statut de la sauvegarde OneDrive (défaut /var/lib/bluegenji/backup-status.json)
```

## Conventions

- **Tout en français** côté UI/messages utilisateur.
- **Imports ESM** : toujours suffixer `.js` (même pour les fichiers `.ts`), TypeScript ESM l'exige.
- **Requêtes SQL** : exclusivement paramétrées via `Bdd.get/set/...`. Jamais de concat de strings.
- **Flux d'activité** : rien de ce qui entre dans `recordEvent()` ne doit nommer une personne. L'app web republie ce flux sur `/bot`, page de vitrine lue **sans compte**, et la table `FeedEvent` conserve ses lignes sans durée — un identifiant écrit ici repart à chaque rattrapage d'historique. `feed/feedPrivacy.ts` remplace mention et identifiant nu par « un joueur » ; la règle est posée dans `recordEvent`, **unique écrivain**, jamais chez l'appelant. Un évènement dit *ce qui se passe*, jamais *à qui*.
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
- **Lint** : configuration `.eslintrc.cjs` (format eslintrc — ESLint 8 ne lit la « flat config » que derrière un drapeau). Le périmètre est **`src/` seul** (`.eslintignore`) : sans lui, `eslint .` partait analyser `dist/`. `src/main.js` est ignoré — ancien point d'entrée, ni compilé (`allowJs: false`) ni référencé.

## CI

`.github/workflows/ci.yml` vérifie chaque PR vers `main` : **lint → build → test**, enchaînés par `needs:`. Un lint rouge rend le reste sans objet, et le build est un prérequis réel des tests (`node --test` lit `dist/`). Ne pas merger sur un CI rouge.

## Documentation

Deux dossiers aux noms voisins, et ils ne servent pas le même public :

- **`doc/` + `help.md` + `helpfr.md` — Markdown, lus à chaud par le site.** L'app sœur ne les copie pas : `lib/server/bot-docs.ts` les lit sur disque à chaque revalidation et les publie sur `/bot/docs`, d'après le registre `BOT_DOC_SECTIONS`. Une correction y est donc en ligne sans rebuild ni déploiement — une erreur aussi.
- **`docs/` — HTML JSDoc, généré puis commité.** C'est la référence des modules, produite par `npm run docs` (build, puis `jsdoc -c jsdoc.json`). La source est **`dist/`** et non `src/` : JSDoc ne lit pas le TypeScript, d'où le build préalable. `dist/tests` en est exclu — un runner de tests n'est pas une API.

**Règle : une PR qui touche `src/` régénère `docs/`.** Ajout, renommage ou suppression d'un module, réécriture d'un bloc JSDoc : la référence part avec le code, dans la même PR. Faute de cette règle elle avait dérivé de **vingt-deux modules** — `docs/` n'avait plus été regénéré depuis son commit d'origine, et publiait encore la page d'une commande retirée.

Cinq choses à savoir avant de lancer la génération :

1. **Vider `docs/` d'abord** (`rm -rf docs`). JSDoc écrit ses pages, il n'efface jamais celles qui n'ont plus de source : sans ce ménage, un module supprimé garde la sienne indéfiniment — et c'est exactement ce qui est arrivé à `/restart-bot`.
2. **Vider `dist/` aussi**, et pour la même raison une marche plus bas : la source de JSDoc est `dist/`, et `tsc` n'efface pas davantage un `.js` dont le `.ts` a disparu. Nettoyer `docs/` seul ne suffit donc pas — la page revient à la génération suivante, produite depuis un artefact périmé. `/restart-bot` est revenu ainsi, avec `updateOldPartner` et l'ancienne orthographe de `checkIntervalleAdhesion` : trois modules qui n'existent plus dans `src/` et que la référence publiait encore. Le ménage complet est donc `rm -rf dist docs && npm run docs`.
3. **Chaque page porte l'horodatage de sa génération** en pied. L'arbre entier ressort donc modifié à chaque passage, même sans changement de fond : mettre la régénération dans **son propre commit**, sinon le vrai diff s'y noie.
4. `jsdoc` est en `devDependencies`. Il n'y était pas, et `npm run docs:gen` échouait sur un binaire introuvable : une commande qui ne s'exécute pas est la meilleure explication d'une doc qui ne se met pas à jour.
5. **Un module sans le moindre bloc JSDoc ne produit aucune page.** JSDoc ne signale pas ce qu’il ne sait pas documenter, il l’omet : trente fichiers de `dist/` sont ainsi absents de la référence, dont `main.ts` et `internalApi.ts`. Une régénération réussie ne prouve donc pas que le module est couvert — vérifier que sa page existe.

## Communication Style

- **Exécute sans détailler** : ne décris pas ce que tu vas faire avant d'agir, fais le travail.
- **Court résumé final** : une fois terminé, résume brièvement les changements et problèmes éventuels.
- **Arrête les processus** : à la fin de chaque prompt, arrête les serveurs lancés (`npm run dev`, tests serveurs) pour éviter l'accumulation.

## Skills Disponibles

Voir `.agents/skills/` :
- `nodejs-best-practices` — décisions d'architecture, frameworks, async, sécurité
- `nodejs-backend-patterns` — Express/Fastify, middleware, error handling, repos
- `typescript-advanced-types` — generics, conditional/mapped types, utility types
- `opus-haiku-pipeline` — pipeline 2 phases (plan Opus → exécution Haiku) via `scripts/run_pipeline.py`. Modes `prose` (rédaction) et `code` (modifs filesystem via CLI `claude`). Ce skill **doit** être déclenché dès que l'utilisateur demande d'« enchaîner des prompts », « planifier puis exécuter », ou de « faire planifier par un modèle et exécuter par un autre ».
