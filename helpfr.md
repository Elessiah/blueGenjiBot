# BlueGenjiBot - Aide

## À quoi sert le bot
BlueGenjiBot connecte des serveurs partenaires via des services partagés.
Si vous postez dans un salon assigné avec le bon préfixe, votre message est retransmis aux autres serveurs partenaires utilisant le même service.

## Jeux couverts
Le bot ne rend pas les mêmes services selon le jeu :
- **Marvel Rivals** : diffusion des annonces entre serveurs partenaires (tous les services ci-dessous) **et** gestion des tournois BlueGenji.
- **Overwatch** : gestion des tournois BlueGenji **uniquement** (rappels de match, alertes d'arbitrage, journal du tournoi). Aucune annonce Overwatch n'est diffusée entre serveurs.

## Services (préfixes)
Tous les services ci-dessous, annonces de tournoi comprises, sont réservés
à **Marvel Rivals**.

- `LFS` : Recherche de scrim (Marvel Rivals).
- `TA` : Annonce de tournoi (Marvel Rivals).
- `LFSub` : Recherche de remplaçant (Marvel Rivals).
- `LFT` : Recherche d'équipe compétitive (Marvel Rivals).
- `LFP` : Recherche de joueurs pour une équipe compétitive (Marvel Rivals).
- `LFG` : Recherche de groupe casu/classé (Marvel Rivals).
- `LFStaff` : Recherche de staff (coach, manager, admin, etc.) pour Marvel Rivals.
- `LFCast` : Recherche de commentateurs/casters (Marvel Rivals).

## Format de message recommandé
Ajoutez ces informations pour obtenir de meilleures réponses :
- Région : `EU`, `NA`, `LATAM`, `ASIA`
- Rang ou plage de rang
- Date + heure
- Fuseau horaire
- Contexte utile (format, rôle, map pool, etc.)

Exemple :
`LFS EU Diamond Mardi 21:00 CET - Scrim BO3`

## Effacer un message retransmis
Si vous supprimez votre message d'origine, le bot supprime les copies qu'il a
posées dans les autres salons partenaires.

Il ne peut le faire que tant qu'il garde la trace du relais, soit **sept jours**.
Passé ce délai, le message d'origine peut toujours être supprimé, mais les copies
restent là où elles sont : le bot ne sait plus à quel message elles se
rattachaient.

## Commandes slash
Pour tout le monde :
- `/help language:<English|Français>`
- `/list-partner service:<service>`
- `/display-channel-filter-region channel:<channel>`
- `/display-channel-filter-rank channel:<channel>`
- `/show-bot-admin`
- `/show-server-invite`

Admins du serveur :
- `/ban-list` (liste de tout le réseau, voir plus bas)
- `/assign-channel channel:<channel> service:<service> region-filter:<region> [rank-min] [rank-max]`
- `/edit-channel-filter-region channel:<channel> region:<region>`
- `/edit-channel-filter-rank channel:<channel> rank-min:<rank> rank-max:<rank>`
- `/reset-channel channel:<channel>`
- `/reset-all`
- `/set-bot-admin role:<role>`
- `/set-server-invite invite:<lien>` : définit un lien d'invitation personnalisé pour ce serveur (prioritaire sur le lien auto-généré).
- `/reset-server-invite` : retire le lien personnalisé (retour au lien auto-généré).

Modération (serveurs de 50+ membres) :
- `/ban-user-of-this-server user:<user> reason:<reason>`
- `/ban-user-of-another-server username:<username> reason:<reason>`
- `/unban id_ban:<id>`

## Nouvelles commandes (v2)

Publiques :
- `/ping` : vérifie la latence du bot.
- `/scrim <niveau>` : publie une recherche de scrim, **Marvel Rivals uniquement** — niveau choisi dans une liste (Débutant, Intermédiaire, Avancé).
- `/recrute <role>` : publie une recherche de joueurs ou staff, **Marvel Rivals uniquement** — rôle choisi dans une liste (Tank, DPS, Heal, Coach, Manager).
- `/stats` : affiche **votre propre** activité récente (réponse visible de vous seul) : messages partenaires des 7 derniers jours, scrims et recherches des 30 derniers jours. On ne consulte pas l'activité d'un autre joueur.
- `/stats-site` : affiche la fréquentation du site BlueGenji (visites totales, et visiteurs uniques des 25 derniers mois).

Pour lier votre compte Discord au site, connectez-vous au site avec Discord, ou utilisez « Applications connectées » sur votre profil.

Admin :
- `/relay <channel>` : ajoute ou retire un salon de relais inter-serveurs.
- `/config <module>` : active/désactive un module (annonces, scrims, recrutement).

## Durées de conservation
- Suivi des messages relayés (identifiants, date) : 7 jours, effacé au plus tard dans la nuit qui suit. Les copies publiées dans les salons partenaires restent ensuite sur Discord (voir « Effacer un message retransmis »).
- Scrims et recherches (`/scrim`, `/recrute`) : 30 jours avec leur auteur. Dans la nuit qui suit, ils sont repliés en simples nombres par jour, serveur et niveau (ou rôle) : ni auteur, ni heure, ni ordre ne restent.
- Fil d'activité public (heure, serveur, niveau ou rôle de chaque annonce) : 30 jours, supprimé dans la nuit qui suit.
- Exclusions du réseau : jusqu'à leur levée. Leur avis et leur motif (salon de journal privé du staff, message privé au titulaire du bot) sont supprimés à la levée.
- Autres messages du salon de journal privé du staff : 1 an.
- Configuration d'un serveur : effacée quand le bot le quitte — y compris s'il l'a quitté pendant un arrêt du bot, au démarrage suivant.

## `/ban-list` et exclusions du réseau
Une exclusion s'applique à **tout le réseau** : c'est une modération communautaire, prononcée par les administrateurs des serveurs de 50 membres et plus. `/ban-list` montre donc à l'administrateur de tout serveur partenaire la liste complète des exclusions du réseau (joueur exclu, modérateur, motif, date), pour qu'il sache qui ne peut plus publier par le bot et pourquoi.

## Support
Besoin d'aide, une suggestion ou un problème ?
Contact : `elessiah`
