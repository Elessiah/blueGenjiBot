# BlueGenji Bot

Bot Discord de l'association **Bluegenji Esport** (esport amateur Overwatch / Marvel Rivals) : relais d'annonces entre serveurs partenaires, commandes slash, et API interne consommée par le site [bluegenji-esport.fr](https://bluegenji-esport.fr) (codes de connexion, rappels de match, alertes d'arbitrage…).

```bash
npm ci
npm run build
npm start        # node dist/main.js
npm test         # build puis node --test
npm run lint
```

Documentation :

- [`doc/`](doc), [`help.md`](help.md), [`helpfr.md`](helpfr.md) : Markdown relu à chaud par le site et publié sur [/bot/docs](https://bluegenji-esport.fr/bot/docs) — pour les pages que liste son registre `BOT_DOC_SECTIONS` ; une correction y est en ligne dans la minute
- `docs/` : référence JSDoc générée (`npm run docs`)
- [`LegalTerms/`](LegalTerms) : conditions d'utilisation et politique de confidentialité du bot (Markdown et PDF, FR / EN) — copies des pages [/terms-of-service-bot](https://bluegenji-esport.fr/terms-of-service-bot) et [/privacy-policy-bot](https://bluegenji-esport.fr/privacy-policy-bot), qui font foi ; régénérées par `scripts/generate-legal-terms.py`
- [`CLAUDE.md`](CLAUDE.md) : architecture et conventions

## Licence

Code source sous licence **GNU Affero General Public License v3.0 seulement** (`AGPL-3.0-only`) — texte intégral dans [`LICENSE`](LICENSE). Droits d'auteur : Copyright (C) 2026 Keryan Houssin ; portée de la licence et composants tiers dans [`NOTICE`](NOTICE).

## Contact

Pas d'adresse électronique ici : les moyens de joindre l'association figurent dans les [mentions légales du site](https://bluegenji-esport.fr/mentions-legales).
