# API interne du bot (BlueGenjiBot)

Le bot expose maintenant une API interne (Express) pour l'application Next.js.

## Variables d'environnement

- `INTERNAL_API_HOST` (défaut: `127.0.0.1`)
- `INTERNAL_API_PORT` (défaut: `4400`)
- `INTERNAL_API_TOKEN` (optionnel mais recommandé)
- `VOICE_CATEGORY_IDS` (défaut: `676735851119640577`) — catégories des salons de
  match, séparées par des virgules ; la première qui a de la place est servie.
  Discord plafonne une catégorie à **50 salons**, soit 25 matchs simultanés : en
  lister plusieurs lève ce plafond. `VOICE_CATEGORY_ID` (au singulier) est encore
  lu en repli.

Si `INTERNAL_API_TOKEN` est défini, chaque requête doit envoyer l'en-tête:

- `x-internal-token: <INTERNAL_API_TOKEN>`

## Endpoints

- `GET /internal/stats`
  - Retourne les stats du bot (serveurs/channels/messages/users 30 jours).

- `POST /internal/auth/send-code`
  - Body: `{ "discordId": "123...", "code": "123456" }`
  - Envoie un DM Discord avec le code de connexion.

- `POST /internal/log`
  - Body: `{ "message": "..." }`
  - Relaye un log vers `sendLog()`.

### Salons vocaux d'équipe

Le site ouvre un salon vocal de 5 places par équipe 15 min avant un match
(`docs/features/MATCH_VOICE.md` du site) et le rend quand le match est fini. Le
bot doit avoir **Gérer les salons** sur chaque catégorie de `VOICE_CATEGORY_IDS`. Aucun pseudo n'est
jamais envoyé : seul un nom d'équipe.

- `POST /internal/voice/channels`
  - Body: `{ "key": "match:12:team:34", "name": "Les Bleus" }`
  - Réponse: `{ "channelId": "123..." }` — même `key` = même salon ; un salon
    supprimé à la main est recréé.
  - Refus: `400 INVALID_PAYLOAD` (clé illisible), `400 INVALID_VOICE_CHANNEL_NAME`,
    `503 DISCORD_NOT_READY`, `500 VOICE_CATEGORY_UNAVAILABLE`,
    `500 VOICE_MISSING_PERMISSIONS`, `500 VOICE_DISCORD_ERROR`,
    `500 VOICE_STORAGE_ERROR`, `500 VOICE_INTERNAL_ERROR`.

- `POST /internal/voice/channels/:id/release`
  - Réponse: `{ "released": true, "deleted": true|false }` — supprimé s'il est
    vide, sinon dès qu'il se vide (balayage toutes les 30 min, au plus tard 24 h
    après le rendu). Un salon déjà parti ou jamais suivi répond succès **sans
    rien supprimer** : seul un salon que le bot suit est détruit.
  - Refus: `400 INVALID_CHANNEL_ID`, puis les mêmes codes que la création.

Un salon jamais rendu resté vide est supprimé au bout de 48 h, et une ligne
qu'on n'arrive pas à solder est abandonnée au bout de 96 h. Toutes les catégories pleines
(50 salons chacune) répondent `VOICE_CATEGORY_UNAVAILABLE`, qui arrête la passe du site au
lieu de faire redemander chaque salon toutes les minutes. Le bot a besoin de
l'intent `GuildVoiceStates`, sans lequel un salon occupé passerait pour vide.

Le suivi tient
dans la table SQLite `VoiceChannel` (identifiant du salon, clé du site, heures) :
ni membres, ni effectif.

Toute autre route sous `/internal` répond `404 INTERNAL_ROUTE_NOT_FOUND` en JSON,
pour que le site distingue un écart de version d'une panne.

### Cycle de vie d'un salon

- Rendu et vide : supprimé aussitôt.
- Rendu et occupé : supprimé dès qu'il se vide (événement voiceStateUpdate), au plus tard 24 h après le rendu.
- Jamais rendu et vide : supprimé au bout de 48 h.
- Ligne insoluble : une dernière tentative forcée à 96 h, puis la ligne est abandonnée (journalisée).
