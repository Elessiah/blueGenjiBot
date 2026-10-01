# Reprise après perte totale de la machine

Ce guide couvre le pire cas : la machine qui fait tourner le bot **et** le site
est perdue (carte SD morte, vol, panne matérielle), et tout doit être remonté
sur une machine neuve à partir du stockage distant. Pour une simple restauration
sur une machine intacte, la section « Restauration » de
`doc/backup-onedrive.md` suffit.

Les noms `distant` et `distant-crypt` sont ceux des exemples de
`backup-onedrive.md` : ce sont les remotes `rclone` que `RCLONE_REMOTE` et
`UPLOADS_RCLONE_REMOTE` désignent dans `scripts/backup-onedrive.env`. `<bot>`
désigne le dossier du dépôt du bot, `<app>` celui du site.

Ce que la reprise rend, et ce qu'elle perd :

- **les deux bases** reviennent à l'état de la **dernière archive** (le lundi précédent au plus tard) — tout ce qui a été écrit depuis est perdu ;
- **les images**, les **logos en quarantaine** et le **journal des suppressions** reviennent à leur état d'**une heure au plus** avant la perte ;
- une suppression de compte faite dans l'heure qui a précédé la perte n'a pas encore été copiée : elle ne sera pas rejouée.
- **les deux ne coïncident pas** : une image remplacée ou supprimée après l'archive n'existe plus sur le stockage (le miroir horaire l'a effacée), si bien que la base restaurée peut désigner un fichier absent — le site affiche alors l'initiale, et l'équipe ou le joueur concerné renvoie son image. Même décalage pour la **quarantaine** (logos d'équipe et avatars) : tout masquage, rétablissement ou suppression survenu entre l'archive et la perte laisse la base restaurée et les fichiers en désaccord — un fichier masqué que la base ignore (jamais purgé au bout des six mois, et recopié chaque heure), ou un masquage que la base croit en cours alors que le fichier est déjà revenu dans `public/uploads` (« Rétablir » échoue, le logo reste caché). À l'étape 5, confronter `data/quarantine` aux masquages que la base restaurée connaît et régler chaque écart à la main — à vérifier : la requête et le geste exacts, propres au site (`docs/features/LOGO_QUARANTINE.md`).
- **les fichiers d'adhésion du bot sont perdus** : `paths.json` et les fichiers chargés par les commandes d'adhésion vivent sur disque, dans le dossier `ADHESIONS_PATH`, hors de la base SQLite — aucune sauvegarde ne les couvre. Ils sont à recharger par les commandes d'adhésion (`doc/adhesions-commands-user.md`) **sitôt la base restaurée**, avant le contrôle quotidien des rappels d'adhésion (10 h, et à chaque démarrage du bot) : ce contrôle repart du calendrier de l'archive, et sans les fichiers les rappels dus ne partiraient pas correctement. À vérifier : la liste exacte des commandes à relancer, et les rappels déjà envoyés entre l'archive et la perte, que ce calendrier ancien peut renvoyer.

## 0. À garder hors de la machine — avant la panne

Sans ces éléments, **rien n'est récupérable** : les archives et les images sont
chiffrées, et le fournisseur du stockage n'a aucun moyen de les lire. Ils se
gardent **hors de la machine** (gestionnaire de mots de passe, clé USB rangée
hors ligne), **jamais dans un dépôt git** :

- **Clé privée `age`** (`~/.bluegenji-backup.key`) : seule clé qui déchiffre les archives des bases.
- **`rclone.conf`** (`~/.config/rclone/rclone.conf` ; `rclone config file` donne le chemin exact) : accès au stockage distant (`distant`) et au remote chiffré des images (`distant-crypt`).
- **Les deux mots de passe du remote `crypt`** (mot de passe et sel), en clair : `rclone.conf` ne les garde qu'obscurcis, et sans eux une copie perdue de `rclone.conf` rend les images irrécupérables.
- **`.env` du bot** (`<bot>/.env`) : jeton du bot, `OWNER_ID`, `INTERNAL_API_TOKEN`, variables `BACKUP_*`.
- **`.env.production` du site** (`<app>/.env.production`) : accès à la base, secrets OAuth, `BOT_INTERNAL_TOKEN`, clés VAPID, sel des visites.
- **`scripts/backup-onedrive.env`** (`<bot>/scripts/backup-onedrive.env`) : configuration des scripts de sauvegarde — aucun secret, mais des chemins et des noms de remotes à reproduire.

Garder aussi une copie de `scripts/backup-recipients.txt` (clés **publiques**, aucun secret) : la clé publique de `~/.bluegenji-backup.key` se recalcule (`age-keygen -y`), mais le fichier peut en lister plusieurs — une par ligne —, et le reconstruire avec une seule rendrait les archives suivantes illisibles par les autres clés, sans aucun avertissement.

Deux pièges à connaître :

- **Les clés VAPID** (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` du site) doivent revenir **à l'identique** : une nouvelle paire rend muets tous les abonnements aux notifications push existants.
- **`INTERNAL_API_TOKEN`** (bot) et **`BOT_INTERNAL_TOKEN`** (site) doivent rester égaux, sans quoi le site ne joint plus le bot.

**Contrôle périodique** (une fois par trimestre, et après tout changement de
clé ou de remote), depuis une machine qui n'est **pas** la production, avec les
seules copies hors ligne :

```bash
rclone --config /chemin/vers/copie/rclone.conf lsf distant:BlueGenji/backups
rclone --config /chemin/vers/copie/rclone.conf copy distant:BlueGenji/backups/bluegenji-AAAA-MM-JJ.tar.age .
age --decrypt -i /chemin/vers/copie/.bluegenji-backup.key bluegenji-AAAA-MM-JJ.tar.age | tar -tf -
# -> database.sqlite et appbluegenji.sql
rclone --config /chemin/vers/copie/rclone.conf lsf distant-crypt:
# -> uploads/ quarantine/ deletions/ — des noms lisibles, donc le chiffrement est le bon
```

**Une liste vide est un échec**, même si la commande rend la main sans erreur :
avec une mauvaise clé, `rclone` écarte les noms qu'il ne sait pas déchiffrer
et ne montre rien.

Tester aussi les **mots de passe en clair** du remote chiffré, seuls, sans la
copie de `rclone.conf` pour ce remote — c'est le jour où elle manque qu'ils
servent, et une faute de frappe ne se découvrirait qu'alors. Ils sont saisis
sans écho, jamais sur la ligne de commande :

```bash
read -rs CRYPT_PASS && read -rs CRYPT_SALT
rclone --config /chemin/vers/copie/rclone.conf lsf ":crypt,remote='distant:BlueGenji/chiffre',password='$(rclone obscure "$CRYPT_PASS")',password2='$(rclone obscure "$CRYPT_SALT")':"
unset CRYPT_PASS CRYPT_SALT
# -> la même liste lisible qu'au-dessus
```

Puis effacer l'archive téléchargée. Si l'une de ces commandes échoue — ou ne
liste rien —, la sauvegarde ne sert à rien : c'est maintenant qu'il faut le
découvrir.

## 1. Préparer la machine neuve

- **Système** : un Debian (ou Raspberry Pi OS) 64 bits. Les commandes de `backup-onedrive.md` visent `arm64` ; sur une machine x86, prendre les binaires `amd64`.
- **Node.js** : le CI des deux dépôts tourne en **Node 20** ; aucun des deux ne fixe de version (`engines`, `.nvmrc`). À vérifier : la version exacte que faisait tourner l'ancienne machine — à défaut, une version LTS au moins égale à 20.
- **npm 12**, comme l'ancienne machine : les deux `package.json` déclarent `allowScripts`, que npm 12 applique (le bot en dépend pour la liaison native de `sqlite3`).
- **MariaDB 11.8** — la production tourne sous MariaDB, pas sous MySQL. **Pas une version plus ancienne** : un dump de MariaDB 11.8 nomme par défaut la collation `utf8mb4_uca1400_ai_ci`, que MariaDB 10.11 (Debian 12 / Raspberry Pi OS Bookworm) ne connaît pas — l'import de l'étape 4 échouerait en `Unknown collation`. Debian 13 livre la 11.8 ; sur une version plus ancienne, passer par le dépôt officiel de MariaDB.
- **pm2**, installé globalement (`npm install -g pm2`), puis `pm2 startup` pour qu'il redémarre avec la machine — lancé sans `sudo`, il n'installe rien et **affiche** une commande `sudo …` qu'il faut copier et exécuter —, et **`pm2 install pm2-logrotate`** : sans lui, les journaux pm2 grossissent jusqu'à remplir le disque (ne jamais les effacer à la main : `pm2 flush`, voir `docs/DEPLOYMENT.md` du site).
- **nginx** (reverse proxy du site).
- **`age`**, **`sqlite3`** et **`mariadb-client`** depuis APT, **`rclone` depuis le binaire officiel** (pas d'APT, trop ancien) : section « 1. Outils » de `backup-onedrive.md`, commandes comprises.

```bash
sudo apt update && sudo apt install -y age sqlite3 mariadb-client nginx
command -v mysqldump    # le script de sauvegarde appelle ce nom
```

MariaDB 11.8 : `sudo apt install -y mariadb-server` **seulement si la distribution la livre** (Debian 13) — vérifier avec `apt-cache policy mariadb-server` avant d'installer, puis `mariadb --version`. Sinon, l'installer depuis le dépôt officiel de MariaDB (série 11.8). À faire **ici**, pas à l'étape 4 : une version trop ancienne ne se découvre sinon qu'à l'import.

Si `mysqldump` est introuvable, installer le paquet de compatibilité qui fournit les anciens noms `mysql*` (`mariadb-client-compat` sur les versions récentes de Debian — à vérifier selon la distribution) : sans lui, la sauvegarde du lundi échoue sur un `mysqldump: command not found`.

Créer aussi le **dossier des journaux** que nomment l'entrée pm2 du site (`--output`, `--error`) et les lignes de cron (`>> …/bluegenji-backup.log`) — même emplacement que sur l'ancienne machine. Absent, `pm2 start` échoue en `ENOENT`, et le shell du cron refuse la redirection **sans lancer le script** : aucune sauvegarde, et aucune trace de l'échec.

```bash
mkdir -p <dossier des journaux>
```

## 2. Remettre les secrets en place

Tout sous le compte système qui fera tourner le bot, le site et les crons (le
même que sur l'ancienne machine), et en `600` :

```bash
install -m 600 /chemin/vers/copie/.bluegenji-backup.key ~/.bluegenji-backup.key
mkdir -p ~/.config/rclone
install -m 600 /chemin/vers/copie/rclone.conf ~/.config/rclone/rclone.conf
rclone lsd distant:            # le stockage répond
rclone lsf distant-crypt:      # uploads/ quarantine/ deletions/ — une liste vide = mauvaise clé
```

Les deux `.env` sont posés à l'étape suivante, une fois les dépôts clonés.

## 3. Le bot : réinstaller, démarrer, restaurer sa base

```bash
git clone <adresse du dépôt du bot> <bot>
cd <bot>
install -m 600 /chemin/vers/copie/bot.env .env
npm ci
npm run build
```

Vérifier dans `.env` que les variables de restauration désignent bien la
machine neuve (chemins compris) :

```env
BACKUP_RCLONE_REMOTE=distant:BlueGenji/backups
BACKUP_AGE_IDENTITY=~/.bluegenji-backup.key
```

Puis démarrer le bot **sur une base vide** — c'est attendu, il l'annonce dans
ses journaux (`Aucun fichier à … — création d'une base vide.`) :

```bash
mkdir -p data          # dossier de la base par défaut (BDD_PATH, sinon ./data/database.sqlite)
pm2 start dist/main.js --name <nom du processus du bot>
pm2 save
```

À vérifier : le nom du processus pm2 du bot sur l'ancienne machine (les
documents ne le donnent pas) ; le garder identique évite d'avoir à corriger les
scripts de déploiement.

Le bot réenregistre ses commandes slash sur chaque serveur au démarrage. Dans
Discord, **depuis le compte dont l'identifiant est `OWNER_ID`** (personne
d'autre ne peut lancer la commande) :

```
/restore-backup confirmer:False                     # liste les archives, la plus récente en tête
/restore-backup confirmer:True archive:AAAA-MM-JJ   # restaure celle-ci
```

**Choisir la plus récente** — et **noter sa date** : le site sera restauré
depuis **la même archive** à l'étape 4, pour que les deux bases décrivent le
même instant.

La commande télécharge l'archive dans un dossier temporaire privé, la déchiffre
sur place, vérifie l'intégrité de la base puis la met en service sans
redémarrage. Elle recopie au passage la base vide courante en
`database.sqlite.avant-<date>` : sans valeur ici, elle sera effacée au plus tard
au bout de 30 jours par le ménage de nuit.

**Aussitôt après, recharger les fichiers d'adhésion** (`ADHESIONS_PATH`, perdus avec la machine) par les commandes d'adhésion (`doc/adhesions-commands-user.md`). La base restaurée porte le calendrier des rappels d'adhésion tel qu'il était à la date de l'archive, et le bot envoie les rappels dus **à chaque démarrage** et chaque jour à 10 h : partis sans leurs fichiers, ils seraient consommés pour rien. **Ne pas redémarrer le bot** (`pm2 restart`) avant d'avoir rechargé ces fichiers — la restauration ne le demande pas, la base est rouverte à chaud. À vérifier : la liste exacte des commandes à relancer.

## 4. Le site : base de données

Récupérer **la même archive** qu'à l'étape 3 et n'en extraire que le dump du
site, dans un dossier privé (le dump est **en clair**) :

```bash
umask 077
mkdir -p ~/restauration && cd ~/restauration
rclone copy distant:BlueGenji/backups/bluegenji-AAAA-MM-JJ.tar.age .
age --decrypt -i ~/.bluegenji-backup.key bluegenji-AAAA-MM-JJ.tar.age | tar -xf - appbluegenji.sql
```

Créer la base et le compte que lit le site, avec les valeurs de `DB_DATABASE`,
`DB_USER` et `DB_PASSWORD` de `.env.production` :

```bash
sudo mariadb
```

```sql
CREATE DATABASE <DB_DATABASE>;
CREATE USER '<DB_USER>'@'localhost' IDENTIFIED BY '<DB_PASSWORD>';
GRANT ALL PRIVILEGES ON <DB_DATABASE>.* TO '<DB_USER>'@'localhost';
FLUSH PRIVILEGES;
```

À vérifier : l'hôte exact du compte (`localhost` ou `127.0.0.1`, selon
`DB_HOST`) et les droits qu'avait le compte sur l'ancienne machine — le site
crée et modifie lui-même ses tables au démarrage, il lui faut donc plus que la
lecture et l'écriture.

Importer, puis effacer le dump et l'archive :

```bash
sudo mariadb <DB_DATABASE> < ~/restauration/appbluegenji.sql
rm -rf ~/restauration
```

Le dump est fait sans `--databases` : il ne crée pas la base, d'où le
`CREATE DATABASE` préalable.

Recréer aussi le compte **en lecture seule** de la sauvegarde
(`backup-onedrive.md`, « 4. Accès MySQL en lecture seule »), et le fichier
`~/.mysql-backup.cnf` qui va avec. Ce compte porte le nom du **compte système**
et s'authentifie par socket : il doit être **distinct** du `DB_USER` du site.
S'ils portaient le même nom, le `CREATE USER IF NOT EXISTS` de la sauvegarde
ne ferait rien, le compte resterait à mot de passe seul, et le `mysqldump` du
lundi échouerait en `Access denied`.

**Ne pas encore démarrer le site** : la base restaurée contient des comptes
supprimés depuis l'archive (étape 6).

## 5. Le site : code, images et quarantaine

```bash
git clone <adresse du dépôt du site> <app>
cd <app>
install -m 600 /chemin/vers/copie/site.env.production .env.production
npm ci                 # sans NODE_ENV=production : `tsx` (étape 6) est une dépendance de développement
npm run build
```

Puis recopier les images et les logos masqués **du stockage vers la machine**.
Toujours `rclone copy`, **jamais `rclone sync`** : dans le mauvais sens, un
`sync` depuis un dossier vide effacerait la seule copie.

```bash
mkdir -p public/uploads data/quarantine
rclone copy distant-crypt:uploads public/uploads
rclone copy distant-crypt:quarantine data/quarantine
```

Les logos en quarantaine doivent être en place **avant** de rouvrir le site :
sans eux, « Rétablir » échoue sur chaque logo masqué en attente de contestation.

## 6. Le site : rejouer les suppressions de compte

**Obligatoire avant de rouvrir le site.** Le dump date d'avant certaines
suppressions de compte, qui y sont donc revenues ; le journal, copié chaque
heure, les rejoue :

```bash
cd <app>
rclone copy distant-crypt:deletions/account-deletions.jsonl data/
NODE_ENV=production npm run replay:deletions -- --dry-run data/account-deletions.jsonl   # ce qui va être supprimé
NODE_ENV=production npm run replay:deletions -- data/account-deletions.jsonl
```

Le chemin est passé **explicitement** : sans lui, le script lit
`ACCOUNT_DELETION_JOURNAL_PATH` quand `.env.production` le définit, et un
fichier absent y vaut un journal vide — le rejeu annoncerait `0 suppression(s)`
et rendrait la main sans erreur. Si cette variable est définie, recopier aussi
le journal **à ce chemin-là** (et vérifier que `DELETION_JOURNAL_PATH` de
`backup-onedrive.env` le suit) : c'est là que le site écrira les suppressions
suivantes, et là que la synchronisation horaire le cherche — absent, elle
**supprimerait** sa copie distante. Un `0 suppression(s) consignée(s)` à la
simulation est suspect : vérifier que le fichier a bien été copié.

`NODE_ENV=production` n'est pas décoratif : sans lui, le script lit `.env` au
lieu de `.env.production` et meurt sur `DB_HOST`. Le rejeu est sans danger à
relancer (un compte déjà supprimé est reconnu) et sort en erreur si une
suppression a échoué.

## 7. Le site : démarrage, nginx, crons

**Premier démarrage.** `./update.sh` ne crée pas l'entrée pm2, il la
redémarre (`pm2 restart bluegenji`) : la première fois, il faut la créer — la
commande est celle de `docs/DEPLOYMENT.md` du site (« Se remettre d'une entrée
perdue »), chemins adaptés à la machine neuve, suivie de `pm2 save`. Les
déploiements suivants passent par `./update.sh`.

**nginx et TLS.** La configuration n'est versionnée dans aucun des deux dépôts
(elle est partagée avec un autre site) : à reconstruire à la main, à partir de
ce qu'en dit `docs/DEPLOYMENT.md` du site —

- un `server` qui relaie vers le site sur `127.0.0.1`, en posant `X-Forwarded-For` (le site en tire l'IP de ses plafonds) ;
- `proxy_buffering off` sur `/api/` (flux temps réel) ;
- `client_max_body_size 6m` (téléversement d'images) ;
- les deux zones de plafond de débit des pages ;
- l'en-tête `Strict-Transport-Security`, que le site ne pose pas lui-même ;
- les journaux d'accès gardés **14 jours** au plus (`logrotate` : `daily`, `rotate 13`) — durée annoncée par le registre des traitements.

**Si la machine neuve n'est pas hébergée au même endroit** que l'ancienne, mettre d'abord à jour `lib/shared/site-host.ts` du site (puis déployer) : les mentions légales et le registre des traitements y lisent l'hébergement annoncé.

À vérifier : la façon dont le certificat TLS était obtenu et renouvelé sur
l'ancienne machine (les dépôts ne le disent pas), et l'enregistrement DNS du
domaine, à faire pointer vers la machine neuve si son adresse a changé.

**Sauvegardes et crons — en dernier.** La synchronisation des images est un
**miroir** : lancée avant que les images, la quarantaine et le journal soient
revenus, elle effacerait leur copie distante (le journal, en particulier, est
supprimé du stockage quand il manque sur la machine). Une fois les étapes 5 et
6 faites :

```bash
cd <bot>
install -m 600 /chemin/vers/copie/backup-onedrive.env scripts/backup-onedrive.env
install -m 644 /chemin/vers/copie/backup-recipients.txt scripts/backup-recipients.txt
# à défaut de copie, et seulement si l'ancien fichier ne listait que cette clé :
# age-keygen -y ~/.bluegenji-backup.key > scripts/backup-recipients.txt
sudo mkdir -p /var/lib/bluegenji && sudo chown "$USER" /var/lib/bluegenji
```

Vérifier dans `backup-onedrive.env` les chemins de la machine neuve
(`BDD_PATH`, `AGE_RECIPIENTS_FILE`, `MYSQL_DEFAULTS_FILE`, `UPLOADS_DIR`), puis
réinstaller les deux lignes de cron (`crontab -e`), ligne `PATH` comprise —
elles sont données dans `backup-onedrive.md`, « 6. Cron ».

## 8. Contrôle final

Le site répond en local (`200` attendu), puis en HTTPS depuis l'extérieur :

```bash
curl -s -o /dev/null -w '%{http_code}
' http://127.0.0.1:3000/
```

Premier passage des images à la main, sans attendre le cron — il doit finir par `Images et journal des suppressions synchronisés…` :

```bash
<bot>/scripts/sync-uploads-onedrive.sh
```

Première sauvegarde à la main — elle contient désormais les bases restaurées, et le statut doit annoncer `"ok": true` et `"parts": "sqlite+mysql+images"` :

```bash
<bot>/scripts/backup-onedrive.sh && cat /var/lib/bluegenji/backup-status.json
```

Puis, point par point :

- **Connexion** : une connexion par Google, Discord ou Blizzard aboutit (même domaine, donc mêmes adresses de retour OAuth).
- **Bot** : en ligne dans Discord, `pm2 logs <nom du processus du bot>` sans erreur, et la page `/bot` du site affiche son état (le site joint le bot).
- **Images** : un avatar et un logo d'équipe s'affichent.
- **Crons** : `crontab -l` montre les deux lignes, et le journal de la synchronisation horaire se remplit à l'heure suivante.
- **pm2** : `pm2 save` fait après le dernier changement, pour qu'un redémarrage de la machine relance le bot et le site.
- **Copies hors ligne** : si une clé, un remote ou un `.env` a changé pendant la reprise, mettre à jour les copies de l'étape 0.
