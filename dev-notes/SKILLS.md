# Skills disponibles

Texte déplacé tel quel depuis `CLAUDE.md` (allègement du fichier chargé à chaque session) : `CLAUDE.md` n'en garde que les règles.

## Skills Disponibles

Voir `.agents/skills/` :
- `nodejs-best-practices` — décisions d'architecture, frameworks, async, sécurité
- `nodejs-backend-patterns` — Express/Fastify, middleware, error handling, repos
- `typescript-advanced-types` — generics, conditional/mapped types, utility types
- `opus-haiku-pipeline` — pipeline 2 phases (plan Opus → exécution Haiku) via `scripts/run_pipeline.py`. Modes `prose` (rédaction) et `code` (modifs filesystem via CLI `claude`). Ce skill **doit** être déclenché dès que l'utilisateur demande d'« enchaîner des prompts », « planifier puis exécuter », ou de « faire planifier par un modèle et exécuter par un autre ».
