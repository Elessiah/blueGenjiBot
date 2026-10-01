# Versionnage

Texte déplacé tel quel depuis `CLAUDE.md` (allègement du fichier chargé à chaque session) : `CLAUDE.md` n'en garde que les règles.

## Versionnage

La version vit dans `package.json` (et `package-lock.json`), en SemVer. **2.0.0** = migration TypeScript, **3.0.0** = connexion avec le site BlueGenji. Elle monte toute seule à la **fusion** d'une PR dans `main` : `.github/workflows/version-bump.yml` lit le niveau sur les étiquettes de la PR, lance `npm version <niveau>` sur `main` à jour, commite `release vX.Y.Z (#N) [skip ci]`, pousse commit et tag `vX.Y.Z` d'un seul push atomique (cinq essais si une autre fusion passe entre-temps), puis publie la release GitHub avec des notes générées depuis les titres de PR. Relancer le job est sûr : si `main` porte déjà le commit `(#N)`, il reprend cette version au lieu d'en monter une seconde. Même mécanique que le site (`docs/features/VERSIONING.md` de l'app).

**Chaque PR porte la bonne étiquette** — c'est le seul geste demandé :

| Étiquette | Effet à la fusion | Quand |
|---|---|---|
| `release:major` | `X+1.0.0` | changement cassant : commande retirée ou au contrat changé, contrat de l'API interne `/internal/*` changé côté site, migration de base irréversible |
| `release:minor` | `X.Y+1.0` | nouvelle fonctionnalité : commande, module, route interne, réglage |
| *(aucune)* | `X.Y.Z+1` | correctif, refonte interne, dépendances, tests, documentation |
| `release:skip` | rien | outillage de dépôt pur, ou PR qui fixe elle-même la version |

`release:skip` l'emporte sur les autres, `release:major` sur `release:minor`. Le job pousse avec `secrets.RELEASE_TOKEN` s'il existe, sinon avec le `GITHUB_TOKEN` : si une protection est posée un jour sur `main`, autoriser GitHub Actions en contournement ou créer ce secret — ne jamais affaiblir la protection. Cette section n'a **pas** sa place dans `doc/`, publié tel quel sur `/bot/docs`.
