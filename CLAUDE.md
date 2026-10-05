# CLAUDE.md

Chargé à chaque session : règles transverses seulement. Le détail et le pourquoi vivent dans **`dev-notes/`** (jamais dans `doc/`, public, ni `docs/`, généré) — le lire avant de toucher la zone concernée.

## Project Overview

**BlueGenjiBot**, bot Discord de BlueGenji (esport amateur Marvel Rivals / Overwatch 2, FR) : commandes slash (adhésion, services partenaires, ban, broadcast, admin), API HTTP interne (`internalApi.ts`) consommée par l'app sœur `C:\work\BlueGenji\appbluegenji` (codes de connexion en MP, stats, logs), distribution de messages, tâches cron. `INTERNAL_API_TOKEN` doit égaler `BOT_INTERNAL_TOKEN` côté web.

## Commands

```bash
npm run dev          # node --watch-path=src --watch-preserve-output + ts-node ESM loader (sans nodemon)
npm run build        # TypeScript 7 (imports relatifs, aucune réécriture)
npm run typecheck:ts5 # même contrôle avec TypeScript 5 (ESLint, ts-node)
npm start            # node dist/main.js
npm run lint         # ESLint (src/ seul)
npm test             # build puis node --test dans dist/
npm run docs         # build + jsdoc
node --test "dist/tests/path/to/file.test.js"  # un seul fichier, après build
```

## Stack → `dev-notes/STACK.md`

- **Node.js + TypeScript ESM** strict ; imports **toujours suffixés `.js`**. Imports **relatifs**, aucun alias de chemin (`@/*` et `tsc-alias` retirés : chaîne `braces` sans correctif).
- **Deux TypeScript** : `typescript-native` (7) produit `dist/`, `typescript` (5) sert ESLint et ts-node — les scripts désignent leur `tsc` **par chemin**, jamais `tsc` ni `npx tsc`.
- discord.js 14, Express 4 (`/internal`, en-tête `x-internal-token`), SQLite via le singleton `Bdd` (`getBddInstance()` / `closeBddInstance()`), node-cron. pm2 est global sur le serveur, **pas** une dépendance.
- **`allowScripts`** (npm 12) : `sqlite3` approuvé (sans lui le bot meurt au démarrage), `unrs-resolver` refusé ; tout nouveau paquet à script annoncé par `npm ci` se relit puis s'approuve ou se refuse.
- Arborescence de `src/` : `dev-notes/STACK.md`.

## Conventions (à appliquer partout)

- **Tout en français** côté messages utilisateur.
- **SQL exclusivement paramétré** (`Bdd.get/set/...`), jamais de concaténation ; seule exception, un nom de table/colonne tiré d'une constante et vérifié par `assertSqlIdentifier`.
- **Erreurs** : try/catch + `sendLog()`, jamais une exception qui plante le bot ; **tout listener `client.on(...)` et tout callback `cron`/`setTimeout` a sa propre garde**. Réponses par `safeReply()`, réactions par `safeReact()`.
- **Flux d'activité** : rien de ce qui entre dans `recordEvent()` ne nomme une personne (règle posée dans `recordEvent`, unique écrivain).
- **Journal Discord** : un identifiant, **jamais un pseudo**.
- **Commandes** : enregistrées par `updateCommands()`, déclarées dans `config/commands.ts` ou `fillBlueCommands()`.
- **Tests** : `node:test` sur `dist/`. **Lint** : ESLint 10 flat + SonarJS (complexité cognitive ≤ 15), `src/` seul.
- **Variables d'environnement** : `.env.example` fait foi → `dev-notes/ENVIRONMENT.md`.
- **Données d'un serveur** : une table de configuration se range dans `GUILD_CONFIG_TABLES`, une table par salon dans `Bdd.deleteChannel` ; l'oubli d'un serveur passe par `eraseGuild` seul → `dev-notes/LEGAL_AND_DATA.md`.

## CI

`.github/workflows/ci.yml` : **lint → build → test** sur chaque PR vers `main`. Ne pas merger sur un CI rouge.

## Versionnage → `dev-notes/VERSIONING.md`

Bump, tag et release automatiques à la fusion. **Chaque PR porte la bonne étiquette** : `release:major` (changement cassant, contrat `/internal/*` changé), `release:minor` (fonctionnalité), aucune (correctif, refonte, dépendances, tests, doc), `release:skip` (outillage pur).

## Documentation → `dev-notes/DOCUMENTATION.md`

- `doc/`, `help.md`, `helpfr.md` sont **lus à chaud et publiés par le site** sur `/bot/docs` : les corriger avec toute commande touchée, n'y mettre rien d'interne.
- **Une PR qui touche `src/` régénère `docs/`** (JSDoc) : `rm -rf dist docs && npm run docs`, commité **à part** ; vérifier que la page du module existe (un module sans bloc JSDoc n'en a pas).

## Textes légaux et licence → `dev-notes/LEGAL_AND_DATA.md`

`LegalTerms/` n'est qu'une copie : corriger le site (`lib/shared/bot-legal-content.ts` d'AppBlueGenji) puis régénérer par `scripts/generate-legal-terms.py`, jamais à la main ; aucune adresse électronique. Licence `AGPL-3.0-only`.

## Revue des PR → `dev-notes/REVIEW_CYCLES.md`

`/code-review --comment` **en boucle** jusqu'à un cycle sans finding (deux consécutifs pour un changement critique : légal, auth, RGPD, sauvegardes), puis, pour une PR qui ajoute ou modifie une fonctionnalité, trois cycles **thématiques** relancés chacun jusqu'à revenir propres : UI/UX (messages, embeds, commandes), sécurité, performance. Doc ou texte légal seul : un cycle juridique à la place ; renommage seul : aucun.

## Communication Style

- **Exécute sans détailler** : ne décris pas ce que tu vas faire, fais-le.
- **Court résumé final** des changements et problèmes éventuels.
- **Arrête les processus** lancés (`npm run dev`, tests serveurs) à la fin de chaque prompt.
- Skills du dépôt (`.agents/skills/`) → `dev-notes/SKILLS.md` ; `opus-haiku-pipeline` **doit** être déclenché quand on demande d'« enchaîner des prompts » ou de « planifier puis exécuter ».
