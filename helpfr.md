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
- `/ban-list`
- `/show-bot-admin`
- `/show-server-invite`

Admins du serveur :
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
- `/scrim <niveau>` : publie une recherche de scrim, **Marvel Rivals uniquement**.
- `/recrute <role>` : publie une recherche de joueurs ou staff, **Marvel Rivals uniquement**.
- `/link` : reçoit en DM un code pour lier votre compte Discord au site BlueGenji.
- `/stats [joueur]` : affiche les stats 30j d'un joueur (vous par défaut).
- `/stats-site` : affiche la fréquentation du site BlueGenji (visites totales et visiteurs uniques).

Admin :
- `/relay <channel>` : ajoute ou retire un salon de relais inter-serveurs.
- `/config <module>` : active/désactive un module (annonces, scrims, recrutement, notifications, stats).

## Support
Besoin d'aide, une suggestion ou un problème ?
Contact : `elessiah`
