*For the English version, see [PolicyPrivacy.md](PolicyPrivacy.md).*

# Politique de Confidentialité — BlueGenji Bot

**Dernière mise à jour** : 1er octobre 2026

> Copie du texte publié sur [https://bluegenji-esport.fr/privacy-policy-bot](https://bluegenji-esport.fr/privacy-policy-bot), **qui fait foi** en cas de divergence. Ne modifiez pas ce fichier à la main : il est régénéré depuis le site (`lib/shared/bot-legal-content.ts` d'AppBlueGenji).

Cette politique vous informe des données que traite le bot Discord **BlueGenji Bot**, de leurs finalités, de leurs durées de conservation, de leurs destinataires et de vos droits (articles 13 et 14 du RGPD).

---

## 01. Responsable du traitement

Le responsable du traitement est l'association **Bluegenji Esport**, association loi 1901 dont le siège est situé au 4 impasse des Cyprès, 51210 Janvilliers, France. Elle a chargé **Keryan Houssin**, hébergeur technique du site, de recevoir les demandes relatives à vos données ; ce n'est pas un délégué à la protection des données au sens de l'article 37 du RGPD. Les moyens de les joindre figurent à la section Contact.

Le Bot est réservé aux personnes d'au moins 15 ans ([Conditions d'Utilisation](https://bluegenji-esport.fr/terms-of-service-bot)).

---

## 02. Données traitées et finalités

### Annonces relayées

Identifiant du message d'origine et de son auteur, date, identifiants des copies relayées et de leurs salons : ils servent à relayer l'annonce, à répercuter sa modification ou sa suppression, à appliquer le temps de recharge entre deux annonces, au compteur de messages de **/stats**, aux statistiques du tableau de bord du bot et, en cas d'exclusion, à retrouver et retirer les copies des annonces de l'exclu. **Le contenu du message n'est pas enregistré dans la base du Bot** : il est recopié, avec le nom de son auteur, dans les salons des serveurs partenaires, où leurs membres le lisent. Ces copies sont des messages Discord : supprimer l'annonce d'origine dans les 7 jours supprime aussi ses copies ; passé ce délai, elles restent jusqu'à leur suppression par les administrateurs du serveur qui les porte.

### Scrims et recrutement

Pour les commandes **/scrim** et **/recrute** : identifiant de l'auteur, jeu, niveau ou rôle recherché, serveur et date, qui alimentent les statistiques d'activité (commande **/stats**, qui ne montre à chacun que sa propre activité, et tableau de bord du bot). Au-delà de 30 jours, ces lignes sont repliées en simples nombres par jour, serveur et niveau (ou rôle), sans l'identifiant de l'auteur ; ces nombres sont conservés sans limite de durée, comme historique de l'activité du Bot. Le niveau et le rôle sont un texte libre, repris tel que l'auteur l'a saisi : n'y écrivez pas le pseudo de quelqu'un.

### Exclusions du relais

Identifiants de l'utilisateur exclu et du modérateur, date, et référence du message de journal qui porte le motif. Les identifiants de l'exclu et du modérateur et le motif sont publiés dans le salon de journal privé du staff ; le motif part aussi en message privé au titulaire du Bot, où il reste sans limite de durée. Une exclusion vaut pour **tout le réseau** de serveurs partenaires : c'est une modération communautaire, prononcée (**/ban-user-of-this-server**, **/ban-user-of-another-server**) et levée (**/unban**) par les administrateurs — et les titulaires du rôle d'administration du Bot — de tout serveur d'au moins 50 membres (comptes de bots compris) où le Bot est installé, ainsi que, depuis ces mêmes serveurs, par le titulaire du Bot et la présidence de l'association ; les serveurs de l'association sont dispensés de ce seuil (section « Modération du relais » des Conditions d'Utilisation). La commande **/ban-list** affiche donc la liste complète des exclusions du réseau (pseudos, motif, date, identifiant) aux administrateurs de tout serveur où le Bot est installé — y compris un serveur que l'on crée soi-même pour l'y inviter — et aux titulaires du rôle d'administration du Bot, pour qu'ils sachent qui ne peut plus publier par le Bot et pourquoi.

### Adhésions et rappels programmés

- **Adhésions à l'association** (commandes réservées aux serveurs de l'association) : quand l'adhésion d'un membre est validée, le Bot lui envoie en message privé la confirmation, et l'attestation d'adhésion si elle est jointe, sans la conserver ; il enregistre alors un rappel pour la date de péremption de l'adhésion — ce qui revient à garder, jusqu'à ce rappel, le fait que ce membre adhère à l'association et jusqu'à quand.
- **Rappels programmés** (mêmes commandes) : identifiant du membre ou du rôle visé et de l'auteur, message, date du prochain envoi et fréquence.

### Configuration des serveurs

Identifiants des serveurs, salons et rôles configurés, invitation du serveur, et identifiant de l'administrateur qui a posé l'invitation ou le rôle d'arbitrage.

### Messages du site BlueGenji

Le site transmet au Bot un identifiant ou un pseudo Discord et le message à remettre (code de connexion, rappel de match, alerte d'arbitrage, signalement ; avis de modération — signalement vous désignant, logo d'équipe masqué, retiré ou supprimé — ; demande d'adhésion à une équipe que vous gérez ; information sur les données) ; le Bot remet les messages personnels (code, rappel, avis de modération, demande d'adhésion, information) en message privé **sans les enregistrer**. Les alertes d'arbitrage et les signalements, qui ne nomment aucun joueur (noms d'équipe et liens de tournoi seulement), sont en outre publiés dans le salon de journal privé du staff ; les alertes d'arbitrage partent aussi en message privé aux membres du rôle d'arbitrage de chaque serveur qui en a défini un (**/set-referee-role**), les signalements à la direction de l'association. Ces traitements relèvent de la [politique de confidentialité du site](https://bluegenji-esport.fr/rgpd).

### Journaux

Le fil d'activité public de la page du bot ne contient aucun identifiant Discord ; il reprend le niveau ou le rôle saisi avec **/scrim** ou **/recrute**. Le salon de journal privé du staff et les journaux du serveur reçoivent le nom des serveurs qui ajoutent ou retirent le Bot, les erreurs de fonctionnement, qui peuvent citer un identifiant Discord, et le journal d'activité du site (inscriptions, matchs, tournois), rédigé par le site sans pseudo de joueur. Le Bot n'y écrit plus de pseudo de lui-même (les messages antérieurs à cette règle peuvent en citer) : le motif d'une exclusion, texte libre du modérateur, peut en citer un, et une erreur de remise d'un message privé peut mentionner le compte visé.

### Base légale

Ces traitements reposent sur l'**intérêt légitime** de l'association (article 6.1.f du RGPD) : faire fonctionner le relais entre serveurs partenaires, le modérer et en mesurer l'activité. Les messages du site reposent sur la base légale de leur traitement d'origine, indiquée dans le registre du site.

---

## 03. Durées de conservation

- **Suivi des annonces relayées** (identifiants, date) : 7 jours ; il est effacé au premier relais qui suit cette échéance, et au plus tard dans la nuit ou au redémarrage du Bot. Les copies publiées dans les salons partenaires restent sur Discord (section 02).
- **Scrims et recrutement** : 30 jours avec l'identifiant de l'auteur ; lors du ménage de la nuit qui suit (ou d'un redémarrage du Bot), l'identifiant de l'auteur est effacé et les lignes sont repliées en nombres par jour, serveur et niveau (ou rôle), gardés sans limite de durée comme historique de l'activité du Bot.
- **Exclusions** : l'enregistrement de l'exclusion, jusqu'à sa levée ; les avis publiés au salon de journal privé du staff et le motif copié en message privé au titulaire du Bot restent après la levée, sans suppression automatique à ce jour.
- **Configuration des serveurs** (salons relayés et leurs filtres de rang, invitation et rôle d'arbitrage avec l'identifiant de qui les a posés, rôle d'administration du Bot, modules activés) : jusqu'à son retrait par les administrateurs, au plus tard jusqu'au départ du Bot du serveur, qui l'efface. Un départ survenu pendant une interruption du Bot, que Discord ne lui signale pas, est rattrapé à son redémarrage.
- **Adhésions et rappels programmés** : jusqu'au dernier envoi du rappel (pour une adhésion, sa date de péremption) ou sa suppression, au plus tard jusqu'au départ du Bot du serveur où ils ont été enregistrés, qui les efface — départ survenu pendant une interruption compris, rattrapé au redémarrage.
- **Salon de journal privé du staff** : aucune suppression automatique à ce jour.
- **Journaux du serveur** : selon leur rotation automatique.
- **Sauvegardes** : la base du Bot est sauvegardée chaque semaine, chiffrée, et chaque copie est supprimée définitivement au bout de 30 jours au plus.

---

## 04. Destinataires

- Le staff de l'association, pour la modération et l'administration du Bot.
- Le titulaire du Bot (son hébergeur technique), qui reçoit en message privé les motifs d'exclusion.
- L'utilisateur exclu, à qui le Bot remet le motif de son exclusion en message privé quand il publie une annonce (message portant un service) dans un salon relayé.
- Les membres du salon où **/scrim** ou **/recrute** est utilisée : la commande y répond publiquement, et Discord y affiche qui l'a utilisée.
- Les membres des serveurs partenaires, qui lisent les annonces relayées.
- Les membres du rôle d'arbitrage de chaque serveur qui en a défini un, pour les alertes d'arbitrage du site.
- Les administrateurs de tout serveur où le Bot est installé, et les titulaires du rôle d'administration du Bot que chaque serveur désigne (**/set-bot-admin**), qui peuvent lire la liste des exclusions (commande **/ban-list**, réponse visible du seul demandeur).
- L'hébergeur technique, Keryan Houssin, qui fournit la machine sur laquelle tourne le Bot (un Raspberry Pi, à Caen) : sous-traitant.
- Discord, plateforme sur laquelle le Bot fonctionne.
- Hetzner Online GmbH (Allemagne), qui stocke les sauvegardes, chiffrées avant envoi avec des clés que Hetzner ne détient pas, dans l'Union européenne : sous-traitant ultérieur, par l'hébergeur technique.
- Microsoft, qui héberge la messagerie personnelle (Outlook.com) de l'hébergeur technique, par où passent, non chiffrées par l'association et lisibles par Microsoft, toute demande relative à vos données que vous envoyez par courriel à l'hébergeur technique et la réponse que celui-ci vous adresse par courriel.
- L'opérateur téléphonique de l'hébergeur technique, si vous l'appelez ou lui laissez un SMS ou un message vocal au sujet de vos données.
- Aucune donnée n'est vendue, ni cédée à d'autres destinataires que ceux listés ici.

---

## 05. Transferts hors de l'Union européenne

- **Discord** (États-Unis) : décision d'adéquation (UE) 2023/1795 de la Commission européenne du 10 juillet 2023 (EU-U.S. Data Privacy Framework).
- **Microsoft** : transfert possible vers les États-Unis, Microsoft ne garantissant pas le lieu de stockage d'un compte personnel ; une demande envoyée par courriel à l'hébergeur technique, et sa réponse par courriel, lui parviennent non chiffrées par l'association, donc lisibles par Microsoft — décision d'adéquation (UE) 2023/1795 de la Commission européenne du 10 juillet 2023 (EU-U.S. Data Privacy Framework).
- Depuis le 1er octobre 2026, les sauvegardes sont envoyées chez Hetzner, en Allemagne : elles ne font l'objet d'aucun transfert hors de l'Union.

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

- Personne à contacter pour vos demandes relatives à vos données : **Keryan Houssin**, hébergeur technique du site — courriel et téléphone dans la [politique de confidentialité du site](https://bluegenji-esport.fr/rgpd#exercer-vos-droits). Ce n'est pas un délégué à la protection des données au sens de l'article 37 du RGPD : l'association reste responsable du traitement. Ce traitement (base légale, données, durée de conservation) est décrit dans la politique de confidentialité du site ; ses destinataires et transferts figurent aussi aux sections 04 et 05 de la présente politique
- Formulaire **« Signaler un problème »** en bas de chaque page du site (catégorie « RGPD » pour vos données)
- Courriel et téléphone de l'association : voir les [mentions légales](https://bluegenji-esport.fr/mentions-legales)

---

## Hébergement

Le bot et le site tournent sur la même machine, un Raspberry Pi, à Caen, fournie et administrée par leur hébergeur technique, Keryan Houssin. Ses coordonnées complètes figurent dans les mentions légales du site.

[Voir la section Hébergement des mentions légales](https://bluegenji-esport.fr/mentions-legales#hebergement)
