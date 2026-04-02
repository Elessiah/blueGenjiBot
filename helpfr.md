# BlueGenjiBot - Aide

## A quoi sert le bot
BlueGenjiBot connecte des serveurs partenaires via des services partages.
Si vous postez dans un salon assigne avec le bon prefixe, votre message est retransmis aux autres serveurs partenaires utilisant le meme service.

## Services (prefixes)
- `LFS` : Recherche de scrim.
- `TA` : Annonce de tournoi.
- `LFSub` : Recherche de remplacant.
- `LFT` : Recherche d'equipe competitive.
- `LFP` : Recherche de joueurs pour une equipe competitive.
- `LFG` : Recherche de groupe (casu/classe).
- `LFStaff` : Recherche de staff (coach, manager, admin, etc.).
- `LFCast` : Recherche de commentateurs/casters.

## Format de message recommande
Ajoutez ces informations pour obtenir de meilleures reponses :
- Region : `EU`, `NA`, `LATAM`, `ASIA`
- Rang ou plage de rang
- Date + heure
- Fuseau horaire
- Contexte utile (format, role, map pool, etc.)

Exemple :
`LFS EU Diamond Mardi 21:00 CET - Scrim BO3`

## Commandes slash
Pour tout le monde :
- `/help language:<English|Francais>`
- `/list-partner service:<service>`
- `/display-channel-filter-region channel:<channel>`
- `/display-channel-filter-rank channel:<channel>`
- `/ban-list`
- `/show-bot-admin`

Admins du serveur :
- `/assign-channel channel:<channel> service:<service> region-filter:<region> [rank-min] [rank-max]`
- `/edit-channel-filter-region channel:<channel> region:<region>`
- `/edit-channel-filter-rank channel:<channel> rank-min:<rank> rank-max:<rank>`
- `/reset-channel channel:<channel>`
- `/reset-all`
- `/set-bot-admin role:<role>`

Moderation (serveurs de 50+ membres) :
- `/ban-user-of-this-server user:<user> reason:<reason>`
- `/ban-user-of-another-server username:<username> reason:<reason>`
- `/unban id_ban:<id>`

## Support
Besoin d'aide, une suggestion ou un probleme ?
Contact : `elessiah`
