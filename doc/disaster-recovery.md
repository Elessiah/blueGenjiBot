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
- **les deux ne coïncident pas** : une image remplacée ou supprimée après l'archive n'existe plus sur le stockage (le miroir horaire l'a effacée), si bien que la base restaurée peut désigner un fichier absent — le site affiche alors l'initiale, et l'équipe ou le joueur concerné renvoie son image. Même décalage pour la **quarantaine** (logos d'équipe et avatars) : tout masquage, rétablissement ou suppression survenu entre l'archive et la perte laisse la base restaurée et les fichiers en désaccord — un fichier masqué que la base ignore (jamais purgé au bout des six mois, et recopié chaque heure), ou un masquage que la base croit en cours alors que le fichier est déjà revenu dans `public/uploads` (« Rétablir » échoue, le logo reste caché). À l'étape 5, confronter `data/quarantine` aux masquages que la base restaurée connaît et régler chaque écart à la main (requête et gestes à l'étape 5, « Confronter la quarantaine »).
- **les fichiers d'adhésion du bot sont perdus** : `paths.json` et les fichiers chargés par les commandes d'adhésion vivent sur disque, dans le dossier `ADHESIONS_PATH`, hors de la base SQLite — aucune sauvegarde ne les couvre. Ils sont à recharger par les commandes d'adhésion (`doc/adhesions-commands-user.md`) **sitôt la base restaurée**, avant le contrôle quotidien des rappels d'adhésion (10 h, et à chaque démarrage du bot) : ce contrôle repart du calendrier de l'archive, et sans les fichiers les rappels dus ne partiraient pas correctement. Une seule commande les recharge (`/load-adhesion-files`, étape 3). Revers à connaître : un rappel parti entre l'archive et la perte **repart une fois** (étape 3 pour l'éviter).

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
sans écho et ne passent **jamais en argument** d'une commande (lisible de tout
compte de la machine par `ps`) : `printf`, intégré au shell, les donne à
`rclone obscure` par l'entrée standard, et le remote de test `verif` est
décrit par des variables d'environnement :

```bash
read -rsp 'Mot de passe du remote crypt : ' CRYPT_PASS; echo
read -rsp 'Sel du remote crypt : ' CRYPT_SALT; echo
export RCLONE_CONFIG_VERIF_TYPE=crypt
export RCLONE_CONFIG_VERIF_REMOTE=distant:BlueGenji/chiffre
export RCLONE_CONFIG_VERIF_PASSWORD="$(printf '%s' "$CRYPT_PASS" | rclone obscure -)"
export RCLONE_CONFIG_VERIF_PASSWORD2="$(printf '%s' "$CRYPT_SALT" | rclone obscure -)"
rclone --config /chemin/vers/copie/rclone.conf lsf verif:
unset CRYPT_PASS CRYPT_SALT RCLONE_CONFIG_VERIF_TYPE RCLONE_CONFIG_VERIF_REMOTE RCLONE_CONFIG_VERIF_PASSWORD RCLONE_CONFIG_VERIF_PASSWORD2
# -> la même liste lisible qu'au-dessus
```

Puis effacer l'archive téléchargée. Si l'une de ces commandes échoue — ou ne
liste rien —, la sauvegarde ne sert à rien : c'est maintenant qu'il faut le
découvrir.

## 1. Préparer la machine neuve

- **Système** : un Debian (ou Raspberry Pi OS) 64 bits — l'ancienne machine tournait sous **Debian 13** (`arm64`), qui livre directement MariaDB 11.8. Les commandes de `backup-onedrive.md` visent `arm64` ; sur une machine x86, prendre les binaires `amd64`.
- **Node.js 22** : c'est la version de production (22.23.2 sur l'ancienne machine, pour le bot comme pour le site). Aucun des deux dépôts ne fixe de version (`engines`, `.nvmrc`), et leur CI tourne encore en **Node 20** : la production est donc plus récente que ce que le CI éprouve. Prendre la dernière 22.x plutôt qu'une version plus récente, qu'aucun des deux n'a encore vu tourner.
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

Sur Debian 13, `mysqldump` est fourni par **`mariadb-client` lui-même** (lien vers `mariadb-dump` ; `dpkg -S /usr/bin/mysqldump` répondait `mariadb-client` sur l'ancienne machine) : aucun paquet de plus. Sur une autre distribution, si `command -v mysqldump` ne rend rien, chercher le paquet qui fournit `/usr/bin/mysqldump` (`sudo apt install -y apt-file && sudo apt-file update && apt-file search /usr/bin/mysqldump`) : sans lui, la sauvegarde du lundi échoue sur un `mysqldump: command not found`.

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
# Le bot ne crée ni le dossier de sa base ni celui de ses fichiers d'adhésion :
mkdir -p <dossier de BDD_PATH>      # ./data si BDD_PATH n'est pas défini dans .env
mkdir -p <ADHESIONS_PATH>          # inutile si la variable n'est pas définie (dossier courant)
pm2 start dist/main.js --name bluegenjibot
pm2 save
```

`bluegenjibot` est le nom qu'avait le processus sur l'ancienne machine (celui
du site est `bluegenji`, étape 7) : les garder identiques évite d'avoir à
corriger les scripts de déploiement et les commandes `pm2 logs` des documents.

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

**Aussitôt après, recharger les fichiers d'adhésion** (`ADHESIONS_PATH`, perdus avec la machine). La base restaurée porte le calendrier des rappels d'adhésion tel qu'il était à la date de l'archive, et le bot envoie les rappels dus **à chaque démarrage** et chaque jour à 10 h : chaque rappel — récurrent comme avis de péremption — joint ces deux fichiers, et parti sans eux il serait consommé pour rien (son décompte avance même quand l'envoi échoue). **Ne pas redémarrer le bot** (`pm2 restart`) avant d'avoir rechargé ces fichiers — la restauration ne le demande pas, la base est rouverte à chaud, et le prochain contrôle n'aura lieu qu'à 10 h.

Une seule commande suffit, avec **les deux** pièces (réservée au dev et au président de l'association) — `paths.json` est recréé de lui-même au premier chargement :

```
/load-adhesion-files adhesion:<bulletin d'adhésion> status:<statuts de l'association>
```

Les rappels programmés vivent dans la base : ils reviennent **tels qu'à la date de l'archive**. Ce qui a changé depuis est à refaire à la main. Le bot ne journalise ni la programmation d'un rappel ni sa suppression par commande : confronter `/show-rappel-adhesion` à ce que se rappellent ceux qui gèrent les adhésions (validations et suppressions de la semaine) :

- un rappel **créé** après l'archive est perdu — notamment l'avis de péremption d'une adhésion validée dans la semaine. Le reposer : `/get-adhesion … interval:` pour un rappel récurrent (qui envoie aussi les fichiers sur-le-champ), `/adhesion-valide` pour un avis de péremption (qui renvoie aussi le message de validation au membre — le prévenir) ;
- un rappel **supprimé** après l'archive est revenu, et repartirait indéfiniment s'il est récurrent : le supprimer de nouveau par `/delete-rappel-adhesion`, avant 10 h.

**Rappels envoyés deux fois.** Un rappel parti entre l'archive et la perte est revenu « dû » avec la base : il **repart une fois** au prochain contrôle — une fois seulement, son échéance suivante étant recalculée à partir de l'envoi. C'est le cas d'un avis de péremption déjà reçu (`/adhesion-valide`) ou d'un rappel récurrent (`/get-adhesion … interval:`) passé dans la semaine. Pour l'éviter, **avant 10 h** : `/show-rappel-adhesion` liste les rappels avec leur prochain envoi ; un envoi daté d'avant la restauration est dû. Un **avis de péremption** (« Péremption — 1 envoi restant ») dont on sait qu'il est déjà parti (salon de logs du bot, message reçu par le membre) se supprime par `/delete-rappel-adhesion` : il n'avait plus rien à envoyer. Un **rappel récurrent**, lui, se laisse partir : le supprimer l'arrêterait pour de bon, et le reposer par `/get-adhesion` enverrait les fichiers sur-le-champ — le doublon qu'on voulait éviter. Dans le doute, laisser partir : un doublon vaut mieux qu'un rappel perdu.

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

C'est exactement le compte de l'ancienne machine : déclaré sur l'hôte
`localhost`, avec `ALL PRIVILEGES` sur la base du site **et rien d'autre** (le
site crée et modifie lui-même ses tables au démarrage, il lui faut donc plus que
la lecture et l'écriture, mais aucun droit global). `DB_HOST` y valait
`127.0.0.1` : la connexion passe par TCP, et MariaDB rattache l'adresse de
bouclage au compte `localhost` tant que la résolution de noms est active (le
défaut). Si `skip_name_resolve` est posé sur la machine neuve, ce rattachement
cesse et le site échoue en `Access denied` : déclarer alors le compte sur
`'<DB_USER>'@'127.0.0.1'`, mêmes droits.

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
et s'authentifie par socket, avec `SELECT, SHOW VIEW, EVENT, TRIGGER` sur la seule
base du site — les droits exacts de l'ancienne machine. Il doit être **distinct**
du `DB_USER` du site.
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

**Confronter la quarantaine.** La base date de l'archive, les fichiers d'une
heure avant la perte : comparer les masquages en cours selon la base aux
fichiers effectivement en quarantaine.

```bash
sudo mariadb <DB_DATABASE> -e "SELECT id, team_id, user_id, logo_url FROM bg_logo_quarantines WHERE status = 'HIDDEN'"
ls data/quarantine/teams data/quarantine/players
```

Chaque ligne désigne un fichier attendu : `data/quarantine/teams/team-<team_id>-<nom>`
pour un logo, `data/quarantine/players/user-<user_id>-<nom>` pour un avatar, où
`<nom>` est le dernier segment de `logo_url`. Les écarts se règlent dans cet ordre :

- **Logo partagé** — d'abord vérifier, pour chaque ligne d'équipe sans fichier, qu'aucune autre équipe ne désigne le même logo (`SELECT id FROM bg_teams WHERE logo_url = '<logo_url>'`). S'il y en a une, le fichier en ligne est resté présent quoi qu'il soit arrivé (le masquage d'un logo partagé copie au lieu de déplacer) : on ne peut plus savoir s'il avait été rétabli. Clore la ligne comme supprimée (geste de « Ligne sans fichier nulle part », plus bas) — l'équipe signalée pourra renvoyer son logo —, **jamais** la rétablir sur la seule présence du fichier.
- **Ligne sans fichier, logo non partagé, et `<nom>` présent dans `public/uploads/teams` (ou `avatars`)** : l'image a probablement été rétablie après l'archive — probablement seulement, le partage se jugeant au moment du masquage et non sur la base restaurée (une autre équipe a pu quitter ce logo entre-temps, et le fichier en ligne survivre à une suppression de la copie). Pour un **logo**, **le confirmer dans le salon de logs Discord** : chaque geste du staff y laisse une ligne qui nomme l'équipe (« Logo de l'équipe … rétabli par le staff », contre une suppression) ; sans ligne de rétablissement, traiter comme supprimé (geste de « Ligne sans fichier nulle part », juste après). Pour un **avatar**, la ligne ne nomme personne et ne départage rien, mais la présence du fichier suffit : un avatar masqué est toujours **déplacé**, jamais copié, si bien que seul un rétablissement a pu le remettre en ligne. Confirmé, rejouer le rétablissement :

  ```sql
  UPDATE bg_teams SET logo_url = '<logo_url>' WHERE id = <team_id> AND logo_url IS NULL;
  -- pour un avatar : UPDATE bg_users SET avatar_url = '<logo_url>' WHERE id = <user_id> AND is_deleted = 0 AND avatar_url IS NULL;
  UPDATE bg_logo_quarantines SET status = 'RESTORED', closed_at = NOW() WHERE id = <id>;
  ```

  Le logo d'entrée solo d'un joueur dont l'avatar est ainsi rétabli se recale à sa prochaine modification de profil ou inscription.
- **Ligne sans fichier nulle part** : l'image a été supprimée après l'archive. Clore la ligne : `UPDATE bg_logo_quarantines SET status = 'PURGED', closed_at = NOW() WHERE id = <id>;`. Même geste pour un logo partagé (« Logo partagé », premier cas). Pour un **avatar** dont le joueur a masqué l'image (`bg_users.visible_avatar = 0`), l'absence ne prouve pas la suppression : rétabli après l'archive, l'avatar a été renommé sous un nom aléatoire (le site le fait à chaque masquage par le joueur), que rien dans la base restaurée ne désigne. Clore la ligne de la même façon — le joueur renverra son avatar — en sachant que le fichier renommé reste orphelin dans `public/uploads/avatars`.
- **Fichier sans ligne `HIDDEN`** : l'image a été masquée après l'archive, et la base restaurée l'affiche toujours. Si `bg_teams.logo_url` (ou `bg_users.avatar_url`) de l'équipe ou du joueur indiqué par le nom du fichier désigne encore `<nom>`, remettre le fichier en ligne (`mv data/quarantine/teams/team-<team_id>-<nom> public/uploads/teams/<nom>`, ou `players/user-<user_id>-<nom>` vers `public/uploads/avatars/<nom>`) puis **rejuger** : masquer ou retirer de nouveau depuis le panneau des signalements si le signalement figure dans la base restaurée, sinon depuis la fiche de l'équipe. Si plus rien ne le désigne, supprimer le fichier : il serait recopié chaque heure sans jamais être purgé.

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

**Le DNS d'abord.** Si l'adresse publique de la machine neuve diffère de
l'ancienne, mettre à jour chez le registraire l'enregistrement du domaine (et
de chaque nom servi par nginx) **avant** de demander un certificat : la
validation de Let's Encrypt joint le domaine par HTTP, elle échoue tant qu'il
désigne l'ancienne adresse. Le port 80 doit donc atteindre la machine (et le
443 pour le site).

**Le certificat** : l'ancienne machine l'obtenait par **certbot** (paquets
Debian, avec le greffon nginx), qui gérait aussi le certificat de l'autre site
hébergé, et le renouvelait par le minuteur systemd `certbot.timer` livré avec
le paquet — aucun cron à écrire. **Dans cet ordre** : un `server` nginx
provisoire en HTTP seul (`listen 80` et `server_name`, sans aucune directive
`ssl_*`) — une configuration complète désignerait des fichiers de certificat qui
n'existent pas encore, `nginx -t` la refuserait et certbot ne pourrait pas
s'exécuter —, puis le certificat, que certbot ajoute lui-même au `server`, puis
seulement le reste de la configuration ci-dessus (relais, plafonds, en-tête
`Strict-Transport-Security`) :

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d <domaine>        # un -d par nom servi
systemctl list-timers | grep certbot     # le renouvellement est programmé
sudo certbot renew --dry-run             # et il aboutira
```

Les certificats de l'ancienne machine sont perdus avec elle, sans dommage :
certbot en délivre de neufs.

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
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/
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
- **Bot** : en ligne dans Discord, `pm2 logs bluegenjibot` sans erreur, et la page `/bot` du site affiche son état (le site joint le bot).
- **Images** : un avatar et un logo d'équipe s'affichent.
- **Crons** : `crontab -l` montre les deux lignes, et le journal de la synchronisation horaire se remplit à l'heure suivante.
- **pm2** : `pm2 save` fait après le dernier changement, pour qu'un redémarrage de la machine relance le bot et le site.
- **Copies hors ligne** : si une clé, un remote ou un `.env` a changé pendant la reprise, mettre à jour les copies de l'étape 0.
