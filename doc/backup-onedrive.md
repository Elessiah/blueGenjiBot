# Sauvegarde chiffrée vers un stockage distant

> Le nom de ce fichier, et ceux des scripts (`backup-onedrive.sh`,
> `sync-uploads-onedrive.sh`, `backup-onedrive.env`), sont **historiques** : le
> cron de production les appelle sous ces noms. Le stockage distant est celui du
> remote `rclone` configuré, quel que soit son fournisseur — aujourd'hui un
> Nextcloud géré (WebDAV), hébergé dans l'Union européenne.

La sauvegarde de référence n'est plus la pièce jointe Discord (plafonnée à 24 Mo,
sans rétention, et qui ignorait la base MySQL du site). Elle est assurée par
`scripts/backup-onedrive.sh`, lancé en cron système sur le Raspberry :

1. snapshot SQLite du bot (`.backup`, sûr pendant les écritures) ;
2. `mysqldump --single-transaction` de la base du site ;
3. archive `tar`, chiffrée avec `age` ;
4. envoi `rclone` vers le stockage distant et purge des archives de plus de
   **30 jours**, durée annoncée par la politique de confidentialité du site —
   les deux doivent bouger ensemble ;
5. synchronisation des images téléversées du site (voir plus bas) ;
6. écriture d'un fichier de statut que le bot relit chaque lundi.

Le script est indépendant du bot : la sauvegarde continue même si le process
Discord est arrêté. Le bot n'envoie plus aucun fichier — les sauvegardes vivent
uniquement sur le stockage distant. Son message hebdomadaire du lundi 4 h se
limite au statut de la dernière sauvegarde et à l'espace disque restant, et
passe en alerte dès qu'aucune sauvegarde réussie n'a moins de huit jours.

**Tout part chiffré depuis le Raspberry** : `age` pour les archives, un remote
`rclone crypt` pour les images, les logos masqués et le journal des
suppressions. Les clés restent chez l'hébergeur technique ; le fournisseur du
stockage ne reçoit que des fichiers qu'il ne peut pas lire.

## Suppression définitive : corbeille et versions

Les durées annoncées par le site (30 jours pour une archive, moins d'une heure
pour une image supprimée) ne tiennent que si une suppression est **définitive**
chez le fournisseur. Or la plupart gardent une corbeille et un historique de
versions :

- **OneDrive** — les scripts le détectent seuls (`scripts/rclone-backend.sh`,
  qui suit un remote `crypt` jusqu'au remote qu'il enveloppe) et passent alors
  `--onedrive-hard-delete` (pas de corbeille) et `--onedrive-no-versions` (pas
  d'anciennes versions). Ces options ne sont passées à aucun autre fournisseur.
  **Limite** : `--onedrive-hard-delete` n'agit que sur OneDrive Entreprise /
  SharePoint ; sur un OneDrive **personnel**, une suppression passe quand même
  par la corbeille, qui ne se vide qu'à la main, depuis le site de OneDrive.
- **Nextcloud / WebDAV** (dont un Nextcloud géré) — aucune option `rclone` n'y
  peut rien : un fichier supprimé part dans la corbeille du serveur, un fichier
  réécrit y garde ses versions. **Action requise en production** : dans
  l'administration du Nextcloud, **désactiver les applications « Deleted files »
  (corbeille) et « Versions »**, ou, si l'offre ne permet pas de les désactiver,
  régler leur rétention à zéro (`trashbin_retention_obligation` et
  `versions_retention_obligation` à `auto, 0` ou équivalent proposé par
  l'offre), puis vider la corbeille et les versions déjà accumulées. Sans cela,
  une archive purgée ou un avatar supprimé survit chez le fournisseur — chiffré,
  mais au-delà de la durée annoncée.
- **Autre fournisseur** — vérifier de la même façon corbeille, versions et
  instantanés avant de le mettre en service.

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
  supprimé, logo retiré) est supprimé du stockage distant au passage suivant,
  soit en moins d'une heure, et **définitivement** (voir la section précédente).
  Garder une copie « au cas où » reviendrait à conserver précisément ce qu'on
  nous a demandé d'effacer. Contrepartie : une image supprimée par erreur ne se
  récupère pas ici, et un dump ancien restauré peut désigner des images qui
  n'existent plus (le site affiche alors l'initiale à la place) ;
- **garde-fou** — si `public/uploads` est vide (mauvais chemin après un
  redéploiement, disque non monté), le script refuse de synchroniser : le miroir
  viderait la sauvegarde ;
- **chiffré** — un avatar est une donnée personnelle, même masqué sur le site,
  et le fournisseur du stockage ne doit pas pouvoir le lire : les images passent
  par un remote `crypt` (étape 3 bis ci-dessous), qui chiffre contenu **et**
  noms de fichiers avant envoi tout en gardant la synchronisation incrémentale.
  Le script **refuse** un remote qui n'est pas de type `crypt`, sans exception :
  aucun réglage ne permet d'envoyer les images en clair.

Le **journal des suppressions** du site (`<app>/data/account-deletions.jsonl`)
part avec les images, sur le même remote chiffré. Une ligne par compte supprimé
(identifiant, date de création, date de suppression) : c'est ce qui permet, après
la restauration d'une archive, de supprimer à nouveau les comptes supprimés
depuis (voir « Restauration »). Il est élagué par le site et recopié tel quel,
sans conserver d'ancienne version.

Les **logos masqués** après un signalement (`<app>/data/quarantine`) partent
aussi, sur le même remote chiffré et en miroir : un logo masqué n'est plus servi
par le site, mais il doit pouvoir être **rétabli** si la contestation de
l'équipe aboutit — y compris après la perte de la machine. Rétabli ou supprimé
définitivement, il quitte le dossier, donc la sauvegarde au passage suivant. Un
dossier vide est normal ici (aucun logo en attente) : pas de garde-fou, un
miroir vide est la bonne copie d'une quarantaine vide. Un dossier **absent**,
lui, laisse la copie distante intacte : c'est l'état d'une machine reconstruite
avant la restauration.

```
distant:BlueGenji/chiffre/      # vu en clair par distant-crypt: uniquement
├── uploads/     avatars/ teams/ sponsors/ benevoles/ tournaments/
├── quarantine/  teams/        (logos masqués, en attente de contestation)
└── deletions/   account-deletions.jsonl
```

(`distant` et `distant-crypt` sont des noms d'exemple : ce sont ceux que
`RCLONE_REMOTE` et `UPLOADS_RCLONE_REMOTE` désignent dans `backup-onedrive.env`.)

La sauvegarde du lundi lance aussi cette synchronisation : le statut annonce
alors `sqlite+mysql+images`, et passe en échec si les images n'ont pas pu partir
— c'est le seul endroit où une panne du cron horaire se remarque.

## Installation (à faire sur le Raspberry)

### 1. Outils

```bash
sudo apt update && sudo apt install -y age sqlite3 mariadb-client
```

**`rclone` ne doit pas venir d'APT** : Debian livre une version de 2022, trop
ancienne pour certains fournisseurs (sur OneDrive, elle échoue à l'envoi en
`401 Unauthorized` alors que la lecture fonctionne — symptôme trompeur).
Installe le binaire officiel à côté du paquet :

```bash
cd /tmp
curl -fsSLO https://downloads.rclone.org/rclone-current-linux-arm64.zip
VNUM=$(curl -fsSL https://downloads.rclone.org/version.txt | sed 's/^rclone //')
curl -fsSL "https://downloads.rclone.org/$VNUM/SHA256SUMS" | grep linux-arm64.zip
sha256sum rclone-current-linux-arm64.zip   # doit correspondre à la ligne ci-dessus
unzip -q rclone-current-linux-arm64.zip
sudo install -m 755 rclone-*/rclone /usr/local/bin/rclone
```

### 2. Connexion au stockage distant

**Nextcloud / WebDAV** (cas actuel) :

```bash
rclone config
```

`n` (new remote) → nom `distant` → type `webdav` → `url` : l'adresse WebDAV du
compte (`https://<instance>/remote.php/dav/files/<utilisateur>/`) → `vendor` :
`nextcloud` → `user` : l'identifiant du compte → mot de passe : un **mot de
passe d'application** créé dans les réglages de sécurité du Nextcloud (jamais le
mot de passe du compte).

> L'adresse, l'identifiant et le mot de passe ne s'écrivent nulle part dans ce
> dépôt : ils ne vivent que dans `rclone.conf` du Raspberry.

Puis désactiver la corbeille et les versions côté serveur (section « Suppression
définitive » plus haut).

**OneDrive** (ancien fournisseur, toujours pris en charge) : `rclone authorize
"onedrive"` sur un PC muni d'un navigateur, puis `rclone config` sur le
Raspberry (type `onedrive`, `client_id` et `client_secret` vides, auto config
**non**, coller le jeton). Les options de suppression définitive sont alors
ajoutées d'office par les scripts.

Vérification, quel que soit le fournisseur :

```bash
rclone lsd distant:
```

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
> sert à rien le jour où la carte SD lâche. La clé n'est jamais envoyée au
> fournisseur du stockage.

### 3 bis. Chiffrement des images (remote `crypt`)

Les archives sont chiffrées par `age` ; les images et le journal des suppressions
le sont par un remote `rclone crypt`, qui garde la synchronisation incrémentale
(chaque fichier est chiffré à part, noms compris).

```bash
rclone config
```

`n` (new remote) → nom `distant-crypt` → type `crypt` → `remote` :
`distant:BlueGenji/chiffre` → `filename_encryption` : `standard` →
`directory_name_encryption` : `true` → mot de passe : **générer** (`g`, 256 bits)
→ second mot de passe (sel) : **générer** aussi.

> **Recopie les deux mots de passe affichés** là où tu gardes la clé `age`.
> `rclone.conf` ne les contient qu'obscurcis, et sans eux les images sont
> irrécupérables depuis une autre machine.

Vérification — le premier listage montre des noms lisibles, le second des noms
chiffrés :

```bash
rclone lsf distant-crypt:
rclone lsf distant:BlueGenji/chiffre
```

### 4. Accès MySQL en lecture seule

MariaDB sait authentifier par socket Unix : l'utilisateur système est reconnu
sans mot de passe, et il n'y a donc aucun secret à poser sur le disque. C'est
strictement préférable à un mot de passe dans un fichier de configuration.

Remplacer `<compte_systeme>` par le compte Unix qui lance le cron de
sauvegarde, et `<base_site>` par la base du site (`DB_DATABASE` de son `.env`).

```sql
CREATE USER IF NOT EXISTS '<compte_systeme>'@'localhost' IDENTIFIED VIA unix_socket;
GRANT SELECT, SHOW VIEW, EVENT, TRIGGER ON <base_site>.* TO '<compte_systeme>'@'localhost';
FLUSH PRIVILEGES;
```

Les droits sont ceux dont `mysqldump` a besoin, pas un de plus : `LOCK TABLES`
est inutile avec `--single-transaction`, et rien n'autorise l'écriture.

```bash
printf '[client]
user=<compte_systeme>
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

Renseigne `RCLONE_REMOTE` (remote du stockage, ex. `distant`) et
`UPLOADS_RCLONE_REMOTE` (remote chiffré, ex. `distant-crypt`), ajuste les
chemins, puis prépare le dossier de statut :

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
sans elle c'est la `rclone` d'APT, trop ancienne, qui serait appelée, et l'échec
ne se manifesterait qu'en production.

```cron
PATH=/usr/local/bin:/usr/bin:/bin
0 3 * * 1 /home/<compte_systeme>/apps/blueGenjiBot/scripts/backup-onedrive.sh >> /home/<compte_systeme>/apps/logs/bluegenji-backup.log 2>&1
17 * * * * /home/<compte_systeme>/apps/blueGenjiBot/scripts/sync-uploads-onedrive.sh >> /home/<compte_systeme>/apps/logs/bluegenji-uploads.log 2>&1
```

La seconde ligne synchronise les images et le journal des suppressions chaque
heure : une image ou un compte supprimé du site quitte le stockage distant dans
l'heure. Elle purge aussi les archives de plus de `RETENTION_DAYS` jours — la
purge du lundi seule laisserait une archive vivre jusqu'à 35 jours.
Renseigner d'abord `UPLOADS_DIR` dans `backup-onedrive.env` (chemin absolu de
`public/uploads` de l'app) et créer le remote chiffré (3 bis), puis faire un
premier passage à la main — c'est lui qui envoie tout le dossier, les suivants
n'envoient que les nouveautés :

```bash
./scripts/sync-uploads-onedrive.sh
```

Les deux tâches partagent un verrou (`flock`) : si elles se croisent le lundi à
3 h, la seconde attend la première au lieu de synchroniser en même temps.

### Changement de fournisseur

Pour passer d'un stockage à un autre : créer les deux nouveaux remotes (2 et
3 bis), les renseigner dans `backup-onedrive.env`, faire un passage complet à la
main (`backup-onedrive.sh` puis `sync-uploads-onedrive.sh`), vérifier la
restauration d'une archive et d'une image depuis le nouveau stockage — **puis
seulement** effacer définitivement les copies laissées chez l'ancien fournisseur
(corbeille et versions comprises), et retirer ses remotes de `rclone.conf`.
Le cron n'a pas à changer : les noms des scripts sont restés les mêmes.

**Délai : avant que la plus ancienne archive de l'ancien stockage n'atteigne
`RETENTION_DAYS` (30 jours).** Les purges horaire et hebdomadaire ne visent que
le remote configuré : une fois `RCLONE_REMOTE` passé au nouveau stockage, plus
rien n'efface les copies de l'ancien, qui survivraient alors à la durée
annoncée par le site. Pour un ancien OneDrive (remotes `onedrive` et
`onedrive-crypt`, dossiers par défaut — à adapter) :

```bash
rclone purge onedrive:BlueGenji --onedrive-hard-delete   # archives et copie chiffrée
rclone purge onedrive:uploads --onedrive-hard-delete     # anciennes copies en clair,
rclone purge onedrive:quarantine --onedrive-hard-delete  # si elles existent encore
rclone purge onedrive:deletions --onedrive-hard-delete
rclone cleanup onedrive:                                 # anciennes versions seulement
rclone config delete onedrive-crypt && rclone config delete onedrive
```

**Puis, obligatoirement, vider la corbeille à la main** sur le site de OneDrive
(« Corbeille » → « Vider la corbeille », y compris la corbeille secondaire) :
sur un compte personnel, ni `--onedrive-hard-delete` ni `rclone cleanup` ne la
vident, et les copies purgées y resteraient jusqu'à 30 jours de plus. Même
geste chez tout autre ancien fournisseur : corbeille et historique de versions
vidés depuis son interface.

## Restauration

> **Machine perdue** (carte SD morte, vol, panne matérielle) : suivre
> `doc/disaster-recovery.md`, qui reprend les étapes ci-dessous dans l'ordre
> d'une reconstruction complète — secrets à garder hors de la machine, bot,
> base et images du site, rejeu des suppressions, crons remis **en dernier**.

**Base du bot** — la commande Discord lit l'archive chiffrée **sur la machine
du bot** et la déchiffre sur place ; aucune base ne transite par Discord.
Elle se règle dans le `.env` du bot :

```env
# Dossier local d'archives bluegenji-AAAA-MM-JJ.tar.age (facultatif)
BACKUP_ARCHIVE_DIR=
# Remote rclone et dossier des archives (facultatif) — celui du script de sauvegarde
BACKUP_RCLONE_REMOTE=distant:BlueGenji/backups
# Clé privée age (défaut : ~/.bluegenji-backup.key), en chmod 600, lisible du seul compte du bot
BACKUP_AGE_IDENTITY=/home/pi/.bluegenji-backup.key
```

```
/restore-backup confirmer:False                     # liste les archives disponibles
/restore-backup confirmer:True archive:2026-09-08   # restaure cette archive
```

Une archive présente dans le dossier local est lue là, sinon elle est
téléchargée (`rclone copyto`) dans un dossier temporaire privé (`mkdtemp`,
0700). `age` déchiffre dans un tube que `tar` lit, et seul `database.sqlite`
est extrait : le dump du site (`appbluegenji.sql`) n'est jamais écrit en clair.
Le dossier temporaire est effacé à la fin, succès ou échec. La saisie ne
compose jamais un chemin : seule une archive déjà listée peut être désignée.

La commande n'accepte que le propriétaire déclaré dans `OWNER_ID` — aucun rôle
Discord ne l'ouvre à quelqu'un d'autre. Elle refuse une base corrompue
(`PRAGMA integrity_check`, en lecture seule), et recopie la base courante en
`database.sqlite.avant-<date>` avant de l'écraser. La connexion SQLite est
fermée — et la fermeture attendue, sinon le checkpoint du WAL écrirait
par-dessus la base restaurée — puis rouverte, sans redémarrage du bot.

Si la copie échoue en cours d'écriture, la base précédente est automatiquement
remise en place, à condition qu'elle passe elle-même la vérification d'intégrité.
Une copie de secours est la base d'avant, **en clair** : elle est supprimée à la
restauration réussie suivante (qui ne garde que la sienne), et au plus tard au
bout de 30 jours par le ménage de nuit (`ROLLBACK_RETENTION_DAYS`, aligné sur
`RETENTION_DAYS`). **Attention** : deux restaurations de suite perdent l'état d'avant la première, y compris ce qui a été écrit depuis la dernière sauvegarde. Pour chercher la bonne archive, l'essayer d'abord à la main sur une autre machine (ci-dessous).

À la main, depuis n'importe quelle machine ayant la clé (base du site, ou bot
arrêté) :

```bash
rclone copy distant:BlueGenji/backups/bluegenji-2026-09-08.tar.age .
age --decrypt -i ~/.bluegenji-backup.key bluegenji-2026-09-08.tar.age | tar -x
# -> database.sqlite (bot) et appbluegenji.sql (site)
```

**Base du site** — restauration manuelle, le bot n'y touche pas :

```bash
mysql -u root <base_site> < appbluegenji.sql
```

**Images du site** — à recopier dans `public/uploads` de l'app :

```bash
rclone copy distant-crypt:uploads /chemin/vers/appbluegenji/public/uploads
```

C'est l'état **actuel** des images, pas celui de la date du dump : avec un dump
ancien, les images supprimées depuis manquent — c'est voulu.

**Logos en quarantaine** — à recopier dans `data/quarantine` de l'app, **avant**
de rouvrir le site : sans eux, « Rétablir » échoue sur chaque logo masqué en
attente de contestation. Tant que le dossier local n'existe pas, la
synchronisation horaire ne touche pas à la copie distante.

```bash
rclone copy distant-crypt:quarantine /chemin/vers/appbluegenji/data/quarantine
```

**Suppressions de compte — obligatoire avant de rouvrir le site.** Le dump date
d'avant certaines suppressions de compte, qui y sont donc revenues. Le site les
rejoue depuis son journal (`docs/features/BACKUP_DATA_PROTECTION.md` côté site) :

```bash
cd /chemin/vers/appbluegenji
# Si la machine a été perdue, le journal local aussi : on reprend sa copie.
rclone copy distant-crypt:deletions/account-deletions.jsonl data/
NODE_ENV=production npm run replay:deletions -- --dry-run   # ce qui va être supprimé
NODE_ENV=production npm run replay:deletions
```

Sans cette étape, restaurer ferait revenir les pseudos, identités de connexion et
tags Discord de joueurs qui avaient demandé leur suppression.

## Vérification de restauration (rapport hebdomadaire et `/backup-check`)

Le rapport du lundi (4 h, en message privé à `OWNER_ID`) ne se contente plus de
dire qu'une archive est partie : il vérifie qu'elle **se relit**. La même
vérification se lance à la demande par `/backup-check` (propriétaire seul,
réponse éphémère). Trois contrôles, chacun « ✅ » ou « ❌ », les échecs repris
en rouge dans un bloc `diff` en fin de message :

- **Archive la plus récente** — `rclone cat` | `age --decrypt` | `tar -t` :
  l'archive est déchiffrée **en flux**, seule la liste de ses fichiers sort du
  tube, et rien n'est écrit en clair sur le disque. `database.sqlite` et
  `appbluegenji.sql` doivent y figurer ;
- **Miroir des images** — le remote des images doit être de type `crypt` et
  lister au moins une entrée (`rclone lsf`, un niveau) : des noms déchiffrables
  prouvent que son mot de passe est le bon. Rien n'est téléchargé ni affiché ;
- **Clé de déchiffrement** — `age-keygen -y` tire la clé publique de la clé
  privée du bot, qui doit figurer dans `scripts/backup-recipients.txt` ; sinon
  « 🚨 la clé du bot n'est PAS dans backup-recipients.txt » : les archives
  sont chiffrées pour une clé que le bot ne détient pas.

La clé publique (`age1…`, pas un secret) est affichée pour que tu la compares à
ta copie hors ligne : `age-keygen -y <copie>` doit afficher exactement la même
(voir `doc/disaster-recovery.md`, contrôle périodique). Le message ne contient
ni chemin, ni nom de remote, ni nom d'hôte, ni sortie d'erreur d'une commande :
le détail d'un échec va au journal du bot (`pm2 logs`, préfixe `[backup-check]`).

`age`, `age-keygen`, `rclone` et `tar` doivent être dans le `PATH` du processus
du bot, et la clé privée lisible par son compte (c'est déjà le cas pour
`/restore-backup`).

## Variables côté bot

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `BACKUP_STATUS_PATH` | `/var/lib/bluegenji/backup-status.json` | Fichier de statut relu pour le rapport hebdomadaire. |
| `BACKUP_UPLOADS_REMOTE` | `UPLOADS_RCLONE_REMOTE:UPLOADS_REMOTE_DIR` de `scripts/backup-onedrive.env` (défauts du script compris) ; sans objet si `UPLOADS_DIR` est vide | Remote `crypt` et dossier des images, lu par la vérification. |
| `BACKUP_RECIPIENTS_FILE` | `AGE_RECIPIENTS_FILE` du même fichier (chemin absolu, `$SCRIPT_DIR`, `~` ou `$HOME` en tête — un chemin relatif n'est pas deviné, régler alors cette variable), sinon `scripts/backup-recipients.txt` (`$SCRIPT_DIR` est le dossier du script, même si sa configuration vit ailleurs) | Clés publiques autorisées, comparées à la clé du bot. |
| `BACKUP_ONEDRIVE_ENV` (ou `BACKUP_CONFIG`) | `scripts/backup-onedrive.env` | Fichier de configuration du script, relu (jamais exécuté) pour les défauts ci-dessus. |

Sans `BACKUP_RCLONE_REMOTE`, la vérification lit aussi les archives là où le
script les écrit (`RCLONE_REMOTE:REMOTE_DIR`, défaut du script compris), en plus
d'un éventuel `BACKUP_ARCHIVE_DIR` : la plus récente des deux est déchiffrée. Elle n'exige
`appbluegenji.sql` que si le script a MySQL à sauvegarder (`MYSQL_DEFAULTS_FILE`
et `DB_DATABASE`), comme le script lui-même. Les trois contrôles tournent en
parallèle, chaque commande bornée à 6 minutes : la réponse de `/backup-check`
arrive avant les 15 minutes d'une réponse différée de Discord.
