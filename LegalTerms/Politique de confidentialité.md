*For the English version, see [PolicyPrivacy.md](PolicyPrivacy.md).*

# Politique de Confidentialité — BlueGenji Bot

**Dernière mise à jour** : 30 septembre 2026

> Copie du texte publié sur [https://bluegenji-esport.fr/privacy-policy-bot](https://bluegenji-esport.fr/privacy-policy-bot), **qui fait foi** en cas de divergence. Ne modifiez pas ce fichier à la main : il est régénéré depuis le site (`lib/shared/bot-legal-content.ts` d'AppBlueGenji).

Cette politique vous informe des données que traite le bot Discord **BlueGenji Bot**, de leurs finalités, de leurs durées de conservation, de leurs destinataires et de vos droits (articles 13 et 14 du RGPD).

---

## 01. Responsable du traitement

Le responsable du traitement est l'association **Bluegenji Esport**, association loi 1901 dont le siège est situé au 4 impasse des Cyprès, 51210 Janvilliers, France. Elle n'a pas désigné de délégué à la protection des données (désignation non obligatoire). Les moyens de la joindre figurent à la section Contact.

Le Bot est réservé aux personnes d'au moins 15 ans ([Conditions d'Utilisation](https://bluegenji-esport.fr/terms-of-service-bot)).

---

## 02. Données traitées et finalités

### Annonces relayées

Identifiant du message d'origine et de son auteur, date, identifiants des copies relayées et de leurs salons : ils servent à relayer l'annonce, à répercuter sa modification ou sa suppression et à appliquer le temps de recharge entre deux annonces. **Le contenu du message n'est pas enregistré dans la base du Bot** : il est recopié, avec le nom de son auteur, dans les salons des serveurs partenaires, où leurs membres le lisent. Ces copies sont des messages Discord : supprimer l'annonce d'origine dans les 7 jours supprime aussi ses copies ; passé ce délai, elles restent jusqu'à leur suppression par les administrateurs du serveur qui les porte.

### Scrims et recrutement

Pour les commandes **/scrim** et **/recrute** : identifiant de l'auteur, jeu, niveau ou rôle recherché, serveur et date, qui alimentent les statistiques d'activité (commande **/stats** et tableau de bord du bot).

### Exclusions du relais

Identifiants de l'utilisateur exclu et du modérateur, date, et référence du message de journal qui porte le motif. Les pseudos de l'exclu et du modérateur et le motif sont publiés dans le salon de journal privé du staff, et la commande **/ban-list** affiche la liste complète des exclusions (pseudos, motif, date, identifiant) aux administrateurs de tout serveur où le Bot est installé et aux titulaires du rôle d'administration du Bot.

### Commande /link, adhésions et rappels programmés

- **Commande /link** : identifiant Discord, code à six chiffres valable 10 minutes et son échéance. Le site ne propose à ce jour aucun endroit où saisir ce code : la commande ne relie donc aucun compte.
- **Adhésions à l'association** (commandes réservées aux serveurs de l'association) : quand l'adhésion d'un membre est validée, le Bot lui envoie en message privé la confirmation, et l'attestation d'adhésion si elle est jointe, sans la conserver ; il enregistre alors un rappel pour la date de péremption de l'adhésion — ce qui revient à garder, jusqu'à ce rappel, le fait que ce membre adhère à l'association et jusqu'à quand.
- **Rappels programmés** (mêmes commandes) : identifiant du membre ou du rôle visé et de l'auteur, message, date du prochain envoi et fréquence.

### Configuration des serveurs

Identifiants des serveurs, salons et rôles configurés, invitation du serveur, et identifiant de l'administrateur qui a posé l'invitation ou le rôle d'arbitrage.

### Messages du site BlueGenji

Le site transmet au Bot un identifiant ou un pseudo Discord et le message à remettre (code de connexion, rappel de match, alerte d'arbitrage, signalement ; avis de modération — signalement vous désignant, logo d'équipe masqué, retiré ou supprimé — ; demande d'adhésion à une équipe que vous gérez ; information sur les données) ; le Bot remet les messages personnels (code, rappel, avis de modération, demande d'adhésion, information) en message privé **sans les enregistrer**. Les alertes d'arbitrage et les signalements, qui ne nomment aucun joueur (noms d'équipe et liens de tournoi seulement), sont en outre publiés dans le salon de journal privé du staff ; les alertes d'arbitrage partent aussi en message privé aux membres du rôle d'arbitrage de chaque serveur qui en a défini un (**/set-referee-role**), les signalements à la direction de l'association. Ces traitements relèvent de la [politique de confidentialité du site](https://bluegenji-esport.fr/rgpd).

### Journaux

Le fil d'activité public de la page du bot ne contient aucun identifiant de personne. Le salon de journal privé du staff et les journaux du serveur reçoivent le nom des serveurs qui ajoutent ou retirent le Bot, les erreurs de fonctionnement, qui peuvent citer un pseudo ou un identifiant Discord, et le journal d'activité du site (inscriptions, matchs, tournois), rédigé par le site sans pseudo de joueur.

### Base légale

Ces traitements reposent sur l'**intérêt légitime** de l'association (article 6.1.f du RGPD) : faire fonctionner le relais entre serveurs partenaires, le modérer et en mesurer l'activité. Les messages du site reposent sur la base légale de leur traitement d'origine, indiquée dans le registre du site.

---

## 03. Durées de conservation

- **Suivi des annonces relayées** (identifiants, date) : 7 jours ; il est effacé lors du premier relais qui suit cette échéance. Rien n'est effacé au redémarrage du Bot. Les copies publiées dans les salons partenaires restent sur Discord (section 02).
- **Scrims et recrutement** : aucune suppression automatique à ce jour ; ces données sont conservées jusqu'à une demande d'effacement.
- **Exclusions** : jusqu'à la levée de l'exclusion.
- **Commande /link** : le code expire au bout de 10 minutes ; la ligne qui le porte n'est pas supprimée automatiquement à ce jour.
- **Configuration des serveurs** : les salons relayés, jusqu'à leur retrait par les administrateurs ou le départ du Bot du serveur ; l'invitation et le rôle d'arbitrage (avec l'identifiant de qui les a posés) et le rôle d'administration du Bot, jusqu'à leur retrait par les administrateurs — ils restent si le Bot quitte le serveur, sans suppression automatique à ce jour.
- **Adhésions et rappels programmés** : jusqu'au dernier envoi du rappel (pour une adhésion, sa date de péremption) ou sa suppression.
- **Salon de journal privé du staff** : aucune suppression automatique à ce jour.
- **Journaux du serveur** : selon leur rotation automatique.
- **Sauvegardes** : la base du Bot est sauvegardée chaque semaine, chiffrée, et chaque copie est supprimée définitivement au bout de 30 jours au plus.

---

## 04. Destinataires

- Le staff de l'association, pour la modération et l'administration du Bot.
- Les membres des serveurs partenaires, qui lisent les annonces relayées.
- Les membres du rôle d'arbitrage de chaque serveur qui en a défini un, pour les alertes d'arbitrage du site.
- Les administrateurs de tout serveur où le Bot est installé, et les titulaires du rôle d'administration du Bot que chaque serveur désigne (**/set-bot-admin**), qui peuvent lire la liste des exclusions (commande **/ban-list**, réponse visible du seul demandeur).
- Tout utilisateur du Bot, par la commande **/stats**, peut voir combien d'annonces un autre utilisateur a publiées (messages relayés, scrims, recherches) ; la réponse n'est visible que de celui qui la demande, et le compteur de messages ne porte que sur ceux dont le suivi est encore conservé (section 03).
- L'hébergeur technique, Keryan Houssin, qui fournit la machine sur laquelle tourne le Bot (un Raspberry Pi, à Caen) : sous-traitant.
- Discord, plateforme sur laquelle le Bot fonctionne.
- Microsoft, qui stocke sur le OneDrive personnel de l'hébergeur technique les sauvegardes, chiffrées avant envoi avec une clé que Microsoft ne détient pas.
- Aucune donnée n'est vendue, ni cédée à d'autres destinataires que ceux listés ici.

---

## 05. Transferts hors de l'Union européenne

- **Discord** (États-Unis) : décision d'adéquation (UE) 2023/1795 de la Commission européenne du 10 juillet 2023 (EU-U.S. Data Privacy Framework).
- **Microsoft** : transfert possible vers les États-Unis, Microsoft ne garantissant pas le lieu de stockage d'un compte personnel ; il ne reçoit que des données chiffrées — décision d'adéquation (UE) 2023/1795 de la Commission européenne du 10 juillet 2023 (EU-U.S. Data Privacy Framework).

---

## 06. Vos droits

Vous disposez sur vos données des droits suivants :

- **Accès** : savoir quelles données le Bot conserve sur vous et en obtenir une copie.
- **Rectification** : faire corriger une donnée inexacte.
- **Effacement** : faire supprimer vos données ; certaines fonctions du Bot peuvent alors ne plus vous être rendues.
- **Limitation** : faire geler l'utilisation d'une donnée le temps d'examiner une contestation.
- **Opposition** : vous opposer, pour des raisons tenant à votre situation particulière, à un traitement fondé sur l'intérêt légitime.

Le droit à la portabilité ne s'applique pas : ces traitements reposent sur l'intérêt légitime, non sur un consentement ou un contrat. Pour exercer vos droits, utilisez les moyens de la section Contact ; une réponse vous est apportée dans un délai d'un mois.

Si vous estimez que vos droits ne sont pas respectés, vous pouvez adresser une réclamation à la [CNIL](https://www.cnil.fr/fr/plaintes).

---

## 07. Sécurité

- La base du Bot vit sur la machine de l'hébergeur technique, dont l'accès est réservé au responsable technique (authentification par clé SSH).
- Les échanges entre le site et le Bot restent sur cette machine et sont protégés par un jeton.
- Les sauvegardes sont chiffrées sur cette machine avant tout envoi.

Aucune mesure ne rend un système infaillible : en cas de violation de données présentant un risque pour vous, l'association est tenue de la notifier à la CNIL et, si le risque est élevé, aux personnes concernées (articles 33 et 34 du RGPD).

---

## 08. Modifications de cette politique

Cette politique peut évoluer avec le Bot. La version en vigueur est celle publiée sur cette page, avec sa date de mise à jour ; les changements importants sont annoncés sur le [serveur Discord de l'association](https://discord.gg/GB9ESEBZFW).

---

## 09. Contact

Pour toute question sur vos données ou pour exercer vos droits :

- Formulaire **« Signaler un problème »** en bas de chaque page du site (catégorie « RGPD » pour vos données)
- **Discord** : elessiah (hébergeur technique de l'association)
- Courriel et téléphone de l'association : voir les [mentions légales](https://bluegenji-esport.fr/mentions-legales)

---

## Hébergement

Le bot et le site tournent sur la même machine, un Raspberry Pi, à Caen, fournie et administrée par leur hébergeur technique, Keryan Houssin. Ses coordonnées complètes figurent dans les mentions légales du site.

[Voir la section Hébergement des mentions légales](https://bluegenji-esport.fr/mentions-legales#hebergement)
