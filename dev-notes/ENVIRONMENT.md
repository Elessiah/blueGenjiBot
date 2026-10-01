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
GUILD_ID=                       # facultatif — surcharge les serveurs démarchés par /internal/notify/dm
BACKUP_STATUS_PATH=             # statut de la sauvegarde distante (défaut /var/lib/bluegenji/backup-status.json)
BACKUP_ARCHIVE_DIR=             # /restore-backup : dossier local d'archives .tar.age (facultatif)
BACKUP_RCLONE_REMOTE=           # /restore-backup : remote:dossier des archives (facultatif)
BACKUP_AGE_IDENTITY=            # /restore-backup : clé privée age (défaut ~/.bluegenji-backup.key)
```
