# Variables d'environnement

Texte déplacé tel quel depuis `CLAUDE.md` (allègement du fichier chargé à chaque session) : `CLAUDE.md` n'en garde que les règles.

## Environment Variables

Les noms ci-dessous sont ceux que le code lit réellement (`.env.example` en fait
foi). Cette liste en portait trois qui n'existent pas — `DISCORD_TOKEN`,
`GUILD_ID` « pour register cmds », `LOG_CHANNEL_ID` — et la distribution des
messages privés a été écrite d'après elle : elle lisait `GUILD_ID`, jamais posé,
et n'a donc rien envoyé depuis sa création.

```env
TOKEN=                          # jeton du bot
CLIENT_ID=
OWNER_ID=                       # reçoit les logs en message privé
INFO_SERV=                      # salon Discord des logs (sendLog)
PRESIDENT=
SERV_GENJI=                     # serveur BlueGenji (commandes réservées, MP du site)
SERV_RIVALS=                    # serveur BlueGenji Marvel Rivals (idem)
PASSWORD=
INTERNAL_API_HOST=
INTERNAL_API_PORT=4400          # défaut
INTERNAL_API_TOKEN=             # doit matcher BOT_INTERNAL_TOKEN côté appbluegenji
SANCTURAI_INTERNAL_URL=         # /sancturai-reply : URL de SancturAI, http en boucle locale seulement (127.0.0.1, localhost, [::1]), ex. http://127.0.0.1:8300
SANCTURAI_INTERNAL_TOKEN=       # /sancturai-reply : jeton x-internal-token envoyé à SancturAI
GUILD_ID=                       # facultatif — surcharge les serveurs démarchés par /internal/notify/dm
BACKUP_STATUS_PATH=             # statut de la sauvegarde distante (défaut /var/lib/bluegenji/backup-status.json)
BACKUP_STATUS_HISTORY_PATH=     # historique des statuts (défaut : BACKUP_STATUS_PATH sans .json + -history.jsonl)
BACKUP_ARCHIVE_DIR=             # /restore-backup : dossier local d'archives .tar.age (facultatif)
BACKUP_RCLONE_REMOTE=           # /restore-backup : remote:dossier des archives (facultatif)
BACKUP_AGE_IDENTITY=            # /restore-backup : clé privée age (défaut ~/.bluegenji-backup.key)
SITE_INTERNAL_URL=              # /message-tournoi : URL du site en boucle locale (http vers 127.0.0.1, localhost ou [::1]), ex. http://127.0.0.1:3000
SITE_INTERNAL_TOKEN=            # /message-tournoi : jeton x-internal-token envoyé au site, égal à SITE_INTERNAL_TOKEN côté appbluegenji ; 32 caractères au moins (openssl rand -hex 32), distinct d'INTERNAL_API_TOKEN
VOICE_CATEGORY_ID=              # catégorie des salons vocaux de match (défaut 676735851119640577, serveur BlueGenji)
```
