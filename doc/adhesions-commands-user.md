# Documentation utilisateur - Commandes d'adhesions

## Portee
Les commandes de cette page sont disponibles uniquement sur les serveurs BlueGenji (serveurs `BlueGenji eSport` et `BlueRivals`).

## Vue d'ensemble
- `/get-adhesion`: envoie les fichiers d'adhesion (immediatement), avec possibilite de programmer un rappel.
- `/show-rappel-adhesion`: affiche les rappels programmes.
- `/delete-rappel-adhesion`: supprime un rappel programme par son identifiant.
- `/load-adhesion-files`: met a jour les fichiers d'adhesion utilises par le bot.
- `/adhesion-valide`: notifie un membre que son adhesion est validee et programme sa date de peremption.
- `/adhesion-perimee`: notifie un membre que son adhesion est perimee.

## 1) /get-adhesion
Envoie les documents d'adhesion (et de statut d'association) avec un message.

Options:
- `message` (texte, optionnel): message d'accompagnement.
- `channel` (salon, optionnel): salon cible.
- `membre` (utilisateur, optionnel): membre cible en message prive.
- `role` (role, optionnel): envoi en message prive a tous les membres du role.
- `interval` (texte, optionnel): intervalle en jours pour un envoi automatique.

Comportement:
- Si aucune cible n'est fournie, le bot envoie les fichiers en message prive a l'auteur de la commande.
- Si l'auteur n'a pas les permissions admin du bot, les envois vers `channel`/`membre`/`role` sont ignores et le bot envoie en prive a l'auteur.
- Si `interval` est defini a une valeur > 0 et que l'auteur n'a pas les permissions, la programmation est refusee.
- En cas de programmation, le prochain envoi est prevu a 10:00 (heure Europe/Paris) apres le nombre de jours indique.

Exemples:
- `/get-adhesion`
- `/get-adhesion message:"Bienvenue chez BlueGenji"`
- `/get-adhesion channel:#adhesions message:"Documents officiels"`
- `/get-adhesion role:@Membres interval:30`

## 2) /show-rappel-adhesion
Affiche les rappels automatiques d'adhesion programmes.

Comportement:
- Affichage ephemere (visible uniquement par l'auteur).
- Pagination par boutons (precedent/suivant/fermer).
- Chaque rappel affiche: ID, cible(s), intervalle, date du prochain envoi.

## 3) /delete-rappel-adhesion
Supprime un rappel programme.

Option:
- `id-rappel` (entier, requis): identifiant du rappel a supprimer.

Conseil:
- Recuperer d'abord l'ID via `/show-rappel-adhesion`.

Exemple:
- `/delete-rappel-adhesion id-rappel:12`

## 4) /load-adhesion-files
Charge/remplace les fichiers sources utilises par le bot pour les envois d'adhesion.

Options:
- `adhesion` (fichier, optionnel): nouveau fichier du bulletin d'adhesion.
- `status` (fichier, optionnel): nouveau fichier du statut d'association.

Droits:
- Reserve au dev et au président de l'association.

Comportement:
- Si un ancien fichier existe, il est remplace.
- Vous pouvez charger seulement `adhesion`, seulement `status`, ou les deux.
- Si aucun fichier n'est fourni, le bot repond "Pas de fichier a charger".

## 5) /adhesion-valide
Informe un membre que son adhesion est validee, puis programme automatiquement un message de peremption a la date indiquee.

Options:
- `user` (utilisateur, requis): membre concerne.
- `date-peremption` (texte, requis): format `DD/MM/YYYY`.
- `adhesion` (fichier, optionnel): fichier joint au message "valide".
- `message-valide` (texte, optionnel): personnalisation du message de validation.
- `message-perimee` (texte, optionnel): personnalisation du message de peremption future.

Droits:
- Necessite les permissions admin du bot (ou OWNER/PRESIDENT).

Comportement:
- Le message "valide" est envoye immediatement en message prive au membre.
- Le message "perimee" est programme pour la date de peremption (envoi unique).

Exemple:
- `/adhesion-valide user:@Pseudo date-peremption:31/12/2026`

## 6) /adhesion-perimee
Informe un membre que son adhesion est perimee.

Options:
- `user` (utilisateur, requis): membre concerne.
- `message` (texte, optionnel): message personnalise.

Comportement:
- Envoi immediat en message prive.
- Si `message` est vide, un message par defaut est utilise.

Exemple:
- `/adhesion-perimee user:@Pseudo`
- `/adhesion-perimee user:@Pseudo message:"Votre adhesion est expiree, merci de la renouveler."`

## Fonctionnement des rappels automatiques
- Le bot verifie les rappels a chaque demarrage.
- Ensuite, verification quotidienne a 10:00 (Europe/Paris).
- Quand une cible (salon/role/membre) n'existe plus, elle est retiree du rappel.
- Si un rappel n'a plus aucune cible, il est supprime.

## Bonnes pratiques
- Mettre a jour les fichiers via `/load-adhesion-files` avant tout envoi massif.
- Tester d'abord avec `/get-adhesion` sans cible pour verifier le contenu en message prive.
- Utiliser `/show-rappel-adhesion` regulierement pour nettoyer les rappels obsoletes.
