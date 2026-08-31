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
- **Mongoose** — présent dans les deps (legacy, vérifier avant de supposer une utilisation)
- **node-cron** — tâches périodiques (vérif adhésion, etc.)
- **pm2** — process manager pour la prod

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
│   ├── ban/, broadcast.ts, contactAdminServer.ts, printHelp.ts, restartBot.ts
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
```

## Conventions

- **Tout en français** côté UI/messages utilisateur.
- **Imports ESM** : toujours suffixer `.js` (même pour les fichiers `.ts`), TypeScript ESM l'exige.
- **Requêtes SQL** : exclusivement paramétrées via `Bdd.get/set/...`. Jamais de concat de strings.
- **Erreurs runtime** : try/catch + `sendLog()` ; ne jamais laisser une exception planter le bot.
- **Commandes Discord** : enregistrer via `updateCommands()`, déclarer dans `config/commands.ts` (statiques) ou `fillBlueCommands()` (dynamiques).
- **Tests** : runner natif `node:test` sur le build (`dist/`), pas de transpil à la volée.
- **Lint** : configuration `.eslintrc.cjs` (format eslintrc — ESLint 8 ne lit la « flat config » que derrière un drapeau). Le périmètre est **`src/` seul** (`.eslintignore`) : sans lui, `eslint .` partait analyser `dist/`. `src/main.js` est ignoré — ancien point d'entrée, ni compilé (`allowJs: false`) ni référencé.

## CI

`.github/workflows/ci.yml` vérifie chaque PR vers `main` : **lint → build → test**, enchaînés par `needs:`. Un lint rouge rend le reste sans objet, et le build est un prérequis réel des tests (`node --test` lit `dist/`). Ne pas merger sur un CI rouge.

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
