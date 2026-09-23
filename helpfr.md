# BlueGenjiBot - Aide

## A quoi sert le bot
BlueGenjiBot connecte des serveurs partenaires via des services partages.
Si vous postez dans un salon assigne avec le bon prefixe, votre message est retransmis aux autres serveurs partenaires utilisant le meme service.

## Services (prefixes)
Tous les services ci-dessous, annonces de tournoi comprises, sont reserves
a **Marvel Rivals**.

- `LFS` : Recherche de scrim (Marvel Rivals).
- `TA` : Annonce de tournoi (Marvel Rivals).
- `LFSub` : Recherche de remplacant (Marvel Rivals).
- `LFT` : Recherche d'equipe competitive (Marvel Rivals).
- `LFP` : Recherche de joueurs pour une equipe competitive (Marvel Rivals).
- `LFG` : Recherche de groupe casu/classe (Marvel Rivals).
- `LFStaff` : Recherche de staff (coach, manager, admin, etc.) pour Marvel Rivals.
- `LFCast` : Recherche de commentateurs/casters (Marvel Rivals).

## Format de message recommande
Ajoutez ces informations pour obtenir de meilleures reponses :
- Region : `EU`, `NA`, `LATAM`, `ASIA`
- Rang ou plage de rang
- Date + heure
- Fuseau horaire
- Contexte utile (format, role, map pool, etc.)

Exemple :
`LFS EU Diamond Mardi 21:00 CET - Scrim BO3`

## Effacer un message retransmis
Si vous supprimez votre message d'origine, le bot supprime les copies qu'il a
posees dans les autres salons partenaires.

Il ne peut le faire que tant qu'il garde la trace du relais, soit **sept jours**.
Passe ce delai le message d'origine peut toujours etre supprime, mais les copies
restent la ou elles sont : le bot ne sait plus a quel message elles se
rattachaient.

## Commandes slash
Pour tout le monde :
- `/help language:<English|Francais>`
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
- `/set-server-invite invite:<lien>` : definit un lien d'invitation personnalise pour ce serveur (prioritaire sur le lien auto-genere).
- `/reset-server-invite` : retire le lien personnalise (retour au lien auto-genere).

Moderation (serveurs de 50+ membres) :
- `/ban-user-of-this-server user:<user> reason:<reason>`
- `/ban-user-of-another-server username:<username> reason:<reason>`
- `/unban id_ban:<id>`

## Nouvelles commandes (v2)

Publiques :
- `/ping` : verifie la latence du bot.
- `/scrim <niveau>` : publie une recherche de scrim, **Marvel Rivals uniquement**.
- `/recrute <role>` : publie une recherche de joueurs ou staff, **Marvel Rivals uniquement**.
- `/link` : recoit en DM un code pour lier ton compte Discord au site BlueGenji.
- `/stats [joueur]` : affiche les stats 30j d'un joueur (toi par defaut).
- `/stats-site` : affiche la frequentation du site BlueGenji (visites totales et visiteurs uniques).

Admin :
- `/relay <channel>` : ajoute ou retire un salon de relais inter-serveurs.
- `/config <module>` : active/desactive un module (annonces, scrims, recrutement, notifications, stats).

## Support
Besoin d'aide, une suggestion ou un probleme ?
Contact : `elessiah`
