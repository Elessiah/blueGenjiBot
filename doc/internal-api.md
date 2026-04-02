# API interne du bot (BlueGenjiBot)

Le bot expose maintenant une API interne (Express) pour l'application Next.js.

## Variables d'environnement

- `INTERNAL_API_HOST` (défaut: `127.0.0.1`)
- `INTERNAL_API_PORT` (défaut: `4400`)
- `INTERNAL_API_TOKEN` (optionnel mais recommandé)

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
