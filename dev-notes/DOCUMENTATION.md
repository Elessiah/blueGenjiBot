# Documentation : `doc/` et `docs/`

Texte déplacé tel quel depuis `CLAUDE.md` (allègement du fichier chargé à chaque session) : `CLAUDE.md` n'en garde que les règles.

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
