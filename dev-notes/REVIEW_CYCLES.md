# Cycles de revue d'une PR

Règle posée le 2026-10-01, une fois les deux projets arrivés à une version stable (site v1.0.0, bot v3.0.x) — même règle que le site (`docs/REVIEW_CYCLES.md` d'AppBlueGenji), adaptée au bot. Elle s'ajoute au CI (lint → build → test) sans rien en retirer.

## 1. Boucle standard

`/code-review --comment` en boucle : corriger, commiter, pousser, relancer une revue **complète**, jusqu'à un cycle **sans finding**.

**Changements critiques** — textes légaux, authentification (codes de connexion envoyés en message privé, jeton de l'API interne), RGPD (rétention, effacement d'un serveur, flux d'activité), sécurité des sauvegardes (`/restore-backup`, archives chiffrées) : la boucle standard continue jusqu'à **deux cycles consécutifs sans finding** ; tout finding remet le compteur à zéro.

## 2. Cycles thématiques — PR qui ajoute ou modifie une fonctionnalité

Une fois la boucle standard propre, trois cycles thématiques, **chacun relancé jusqu'à revenir sans finding** :

1. **UI/UX** — l'interface du bot est Discord : messages et embeds (clarté, français, longueur sous les limites de Discord), commandes slash (noms, descriptions, options, autocomplétion), réponses éphémères ou publiques à bon escient, états d'erreur et d'interaction expirée (`safeReply`), cohérence avec `help.md` / `helpfr.md` / `doc/`.
2. **Sécurité** — permissions des commandes (rôles, propriétaire, serveurs autorisés), validation des options et des corps de `/internal/*`, jeton `x-internal-token`, requêtes SQL paramétrées, mentions désamorcées (`@everyone`, rôles), secrets, exposition de données (journal, flux d'activité public, messages privés), plafonds de débit. Une PR qui change ce que le bot collecte, garde ou efface est aussi relue pour ses **déclarations** : politique de confidentialité du bot (source sur le site, `lib/shared/bot-legal-content.ts`), registre des traitements et `PRIVACY_CHANGES` du site.
3. **Performance** — appels à l'API Discord (limites de débit, récupérations en boucle, cache de discord.js), requêtes SQLite et N+1, tâches cron et minuteries, mémoire du processus, chemins chauds de la distribution des messages.

Un cycle thématique se lance avec le skill `code-review` et des arguments qui **nomment le thème**, par exemple :

```
/code-review --comment focus: security review — command permissions, input validation, internal API token, SQL injection, mentions, secrets, data exposure, rate limits
```

Le thème voyage en texte libre dans les arguments : ne compter un cycle thématique comme fait que si son compte rendu traite bien du thème nommé. Une correction qui touche du code au-delà du thème fait relancer la boucle standard avant de reprendre.

## 3. Exceptions

- **Renommage seul** (fichier, symbole, libellé, sans changement de comportement) : boucle standard uniquement, **aucun** cycle thématique.
- **Documentation ou textes légaux seulement** : la boucle standard reste due ; à la place des trois cycles thématiques, **un cycle orienté juridique**, relancé jusqu'à revenir propre — RGPD, LCEN/DSA, recommandations CNIL, cohérence avec la politique de confidentialité du bot et le `/rgpd` du site, le registre des traitements et `PRIVACY_CHANGES` du site, dates des textes avancées avec eux, `LegalTerms/` régénéré et jamais corrigé à la main, aucune donnée personnelle ni aucun secret publié (`doc/` est public sur `/bot/docs`).
- Un texte légal reste un changement critique : sa boucle standard exige deux cycles consécutifs propres.
