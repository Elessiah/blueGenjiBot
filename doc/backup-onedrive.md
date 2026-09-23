# Sauvegarde chiffrée vers OneDrive

La sauvegarde de référence n'est plus la pièce jointe Discord (plafonnée à 24 Mo,
sans rétention, et qui ignorait la base MySQL du site). Elle est assurée par
`scripts/backup-onedrive.sh`, lancé en cron système sur le Raspberry :

1. snapshot SQLite du bot (`.backup`, sûr pendant les écritures) ;
2. `mysqldump --single-transaction` de la base du site ;
3. archive `tar`, chiffrée avec `age` ;
4. envoi `rclone` vers OneDrive et purge des archives trop anciennes ;
5. synchronisation des images téléversées du site (voir plus bas) ;
6. écriture d'un fichier de statut que le bot relit chaque lundi.

Le script est indépendant du bot : la sauvegarde continue même si le process
Discord est arrêté. Le bot n'envoie plus aucun fichier — les sauvegardes vivent
uniquement sur OneDrive. Son message hebdomadaire du lundi 4 h se limite au
statut de la dernière sauvegarde et à l'espace disque restant, et passe en alerte
dès qu'aucune sauvegarde réussie n'a moins de huit jours.

## Images du site

Avatars, logos d'équipe et de partenaires, photos de bénévoles et illustrations
de tournoi vivent dans `public/uploads` de l'app, **hors de la base** : le dump
MySQL n'en garde que le chemin. Sans eux, une base restaurée afficherait des
images cassées partout.

Ils sont traités à part, par `scripts/sync-uploads-onedrive.sh` :

- **au fil de l'eau** — `rclone sync` n'envoie que les fichiers nouveaux ou
  modifiés, le script tourne donc chaque heure pour presque rien, et une image
  n'attend pas le lundi suivant sa première copie ;
- **en miroir strict** — un fichier supprimé du site (avatar changé, compte
  supprimé, logo retiré) est supprimé de OneDrive au passage suivant, soit en
  moins d'une heure, et **définitivement** : `--onedrive-hard-delete` évite la
  corbeille OneDrive, qui l'aurait gardé 30 jours de plus. Garder une copie
  « au cas où » reviendrait à conserver précisément ce qu'on nous a demandé
  d'effacer. Contrepartie : une image supprimée par erreur ne se récupère pas
  ici, et un dump ancien restauré peut désigner des images qui n'existent plus
  (le site affiche alors l'initiale à la place) ;
- **garde-fou** — si `public/uploads` est vide (mauvais chemin après un
  redéploiement, disque non monté), le script refuse de synchroniser : le miroir
  viderait la sauvegarde ;
- **en clair par défaut** — les images sont servies par le site à qui en connaît
  l'adresse. Pour les chiffrer, créer un remote `crypt` enveloppant `onedrive:`
  (`rclone config`) et le désigner par `UPLOADS_RCLONE_REMOTE` : rien d'autre ne
  change, la synchronisation reste incrémentale.

```
onedrive:BlueGenji/uploads/      # copie conforme de public/uploads
├── avatars/  teams/  sponsors/  benevoles/  tournaments/
```

La sauvegarde du lundi lance aussi cette synchronisation : le statut annonce
alors `sqlite+mysql+images`, et passe en échec si les images n'ont pas pu partir
— c'est le seul endroit où une panne du cron horaire se remarque.

## Installation (à faire sur le Raspberry)

### 1. Outils

```bash
sudo apt update && sudo apt install -y age sqlite3 mariadb-client
```

**`rclone` ne doit pas venir d'APT.** Sur un OneDrive personnel, Graph redirige
l'envoi vers `my.microsoftpersonalcontent.com`, un hôte auquel le jeton Graph ne
doit plus être présenté ; les versions antérieures au correctif l'envoient quand
même et récoltent un `401 Unauthorized`. La lecture continue de fonctionner, si
bien que `rclone lsd` réussit et que seul l'envoi échoue — le symptôme est
trompeur. Debian trixie livre encore une 1.60 de 2022. Installe le binaire
officiel à côté du paquet :

```bash
cd /tmp
curl -fsSLO https://downloads.rclone.org/rclone-current-linux-arm64.zip
VNUM=$(curl -fsSL https://downloads.rclone.org/version.txt | sed 's/^rclone //')
curl -fsSL "https://downloads.rclone.org/$VNUM/SHA256SUMS" | grep linux-arm64.zip
sha256sum rclone-current-linux-arm64.zip   # doit correspondre à la ligne ci-dessus
unzip -q rclone-current-linux-arm64.zip
sudo install -m 755 rclone-*/rclone /usr/local/bin/rclone
```

### 2. Connexion OneDrive

`rclone` embarque son propre identifiant d'application : **aucune inscription
Azure n'est nécessaire pour un compte Microsoft personnel**. En revanche la
connexion demande un navigateur, que le Raspberry n'a pas. Sur un PC ayant
`rclone` installé :

```bash
rclone authorize "onedrive"
```

Connecte-toi dans le navigateur qui s'ouvre, puis recopie le jeton affiché.
Sur le Raspberry :

```bash
rclone config
```

`n` (new remote) → nom `onedrive` → type `onedrive` → laisser `client_id` et
`client_secret` vides → `Use auto config?` **non** → coller le jeton → choisir
`OneDrive Personal or Business` → valider le compte proposé.

Vérification :

```bash
rclone lsd onedrive:
```

> Le jeton d'un compte personnel se renouvelle à chaque usage. Une exécution
> hebdomadaire le garde vivant ; si le Raspberry reste éteint plus de trois mois,
> il faudra refaire `rclone config reconnect onedrive:`.

### 3. Clé de chiffrement

```bash
age-keygen -o ~/.bluegenji-backup.key      # chmod 600, à sauvegarder AILLEURS
grep 'public key' ~/.bluegenji-backup.key  # -> age1...
```

Place la clé publique dans le fichier des destinataires :

```bash
echo 'age1xxxxxxxxxxxxxxxxxxxxxxxxxxxxx' > scripts/backup-recipients.txt
```

> **Sans la clé privée, les archives sont irrécupérables.** Garde une copie hors
> du Raspberry (gestionnaire de mots de passe, clé USB) — sinon la sauvegarde ne
> sert à rien le jour où la carte SD lâche.

### 4. Accès MySQL en lecture seule

MariaDB sait authentifier par socket Unix : l'utilisateur système est reconnu
sans mot de passe, et il n'y a donc aucun secret à poser sur le disque. C'est
strictement préférable à un mot de passe dans un fichier de configuration.

```sql
CREATE USER IF NOT EXISTS 'elessiah'@'localhost' IDENTIFIED VIA unix_socket;
GRANT SELECT, SHOW VIEW, EVENT, TRIGGER ON bluegenji_arena.* TO 'elessiah'@'localhost';
FLUSH PRIVILEGES;
```

Les droits sont ceux dont `mysqldump` a besoin, pas un de plus : `LOCK TABLES`
est inutile avec `--single-transaction`, et rien n'autorise l'écriture.

```bash
printf '[client]
user=elessiah
' > ~/.mysql-backup.cnf
chmod 600 ~/.mysql-backup.cnf
```

Ne pas renseigner `host` : c'est ce qui garde la connexion sur le socket local.
Avec `host=127.0.0.1`, mysqldump passerait en TCP et l'authentification par
socket ne s'appliquerait plus.

### 5. Configuration du script

```bash
cp scripts/backup-onedrive.env.example scripts/backup-onedrive.env
chmod 600 scripts/backup-onedrive.env
```

Ajuste les chemins, puis prépare le dossier de statut :

```bash
sudo mkdir -p /var/lib/bluegenji && sudo chown "$USER" /var/lib/bluegenji
```

Premier essai à la main :

```bash
./scripts/backup-onedrive.sh && cat /var/lib/bluegenji/backup-status.json
```

### 6. Cron

`crontab -e`, tous les lundis à 3 h (avant le rapport du bot, à 4 h). La ligne
`PATH` n'est pas décorative : cron ne voit que `/usr/bin:/bin` par défaut, donc
sans elle c'est la `rclone` d'APT — celle qui ne sait plus écrire — qui serait
appelée, et l'échec ne se manifesterait qu'en production.

```cron
PATH=/usr/local/bin:/usr/bin:/bin
0 3 * * 1 /home/elessiah/apps/blueGenjiBot/scripts/backup-onedrive.sh >> /home/elessiah/apps/logs/bluegenji-backup.log 2>&1
17 * * * * /home/elessiah/apps/blueGenjiBot/scripts/sync-uploads-onedrive.sh >> /home/elessiah/apps/logs/bluegenji-uploads.log 2>&1
```

La seconde ligne synchronise les images chaque heure. Renseigner d'abord
`UPLOADS_DIR` dans `backup-onedrive.env` (chemin absolu de `public/uploads` de
l'app), puis faire un premier passage à la main — c'est lui qui envoie tout le
dossier, les suivants n'envoient que les nouveautés :

```bash
./scripts/sync-uploads-onedrive.sh
```

Les deux tâches partagent un verrou (`flock`) : si elles se croisent le lundi à
3 h, la seconde attend la première au lieu de synchroniser en même temps.

## Restauration

Récupère et déchiffre l'archive, depuis n'importe quelle machine ayant la clé :

```bash
rclone copy onedrive:BlueGenji/backups/bluegenji-2026-09-08.tar.age .
age --decrypt -i ~/.bluegenji-backup.key bluegenji-2026-09-08.tar.age | tar -x
# -> database.sqlite (bot) et appbluegenji.sql (site)
```

**Base du bot** — glisse le `database.sqlite` obtenu dans la commande Discord :

```
/restore-backup fichier:<database.sqlite> confirmer:True
```

La commande n'accepte que le propriétaire déclaré dans `OWNER_ID` — aucun rôle
Discord ne l'ouvre à quelqu'un d'autre. Elle refuse un fichier encore chiffré ou
une base corrompue (`PRAGMA integrity_check`, en lecture seule), et recopie la
base courante en `database.sqlite.avant-<date>` avant de l'écraser. La connexion
SQLite est fermée — et la fermeture attendue, sinon le checkpoint du WAL écrirait
par-dessus la base restaurée — puis rouverte, sans redémarrage du bot.

Si la copie échoue en cours d'écriture, la base précédente est automatiquement
remise en place, à condition qu'elle passe elle-même la vérification d'intégrité.
Les trois copies de secours les plus récentes sont conservées, les plus anciennes
sont purgées : ce sont des copies intégrales de la base, sur la machine dont on
surveille justement l'espace disque.

**Base du site** — restauration manuelle, le bot n'y touche pas :

```bash
mysql -u root appbluegenji < appbluegenji.sql
```

**Images du site** — à recopier dans `public/uploads` de l'app :

```bash
rclone copy onedrive:BlueGenji/uploads /chemin/vers/appbluegenji/public/uploads
```

C'est l'état **actuel** des images, pas celui de la date du dump : avec un dump
ancien, les images supprimées depuis manquent — c'est voulu.

## Variable côté bot

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `BACKUP_STATUS_PATH` | `/var/lib/bluegenji/backup-status.json` | Fichier de statut relu pour le rapport hebdomadaire. |
