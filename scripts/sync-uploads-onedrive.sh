#!/usr/bin/env bash
#
# Miroir des images téléversées du site vers OneDrive.
#
# Couvre `public/uploads` d'appbluegenji : avatars, logos d'équipe, logos de
# partenaires, photos de bénévoles, illustrations de tournoi. Ces fichiers ne
# sont ni dans le dump MySQL (la base ne garde que leur chemin) ni dans l'archive
# chiffrée : sans eux, une base restaurée pointe vers des images disparues.
#
# Pourquoi un script à part, et pas une étape de l'archive hebdomadaire :
#   - `rclone sync` n'envoie que ce qui a changé, donc le script peut tourner
#     souvent (cron horaire) — une image téléversée lundi n'attend pas une
#     semaine sa première copie, et chaque passage ne coûte presque rien ;
#   - archiver le dossier entier chaque semaine dupliquerait les mêmes fichiers
#     pendant les 180 jours de rétention.
#
# **Un miroir, pas un historique** : un fichier supprimé du site l'est aussi de
# OneDrive au passage suivant, et définitivement (`--onedrive-hard-delete`,
# sans détour par la corbeille OneDrive, qui le garderait encore 30 jours).
# C'est ce qui rend effective la suppression d'un avatar ou d'un compte — une
# copie conservée « au cas où » serait précisément la donnée qu'on nous a
# demandé d'effacer. Contrepartie assumée : une image supprimée par erreur ne se
# récupère pas ici, et un dump ancien restauré peut désigner des images parties.
#
# Appelé seul par cron, ou par backup-onedrive.sh, qui en reporte l'échec dans
# le statut hebdomadaire. Code de sortie non nul sur tout échec.
#
# Configuration : scripts/backup-onedrive.env (même fichier que la sauvegarde).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${BACKUP_CONFIG:-$SCRIPT_DIR/backup-onedrive.env}"

if [[ -f "$CONFIG_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$CONFIG_FILE"
fi

: "${RCLONE_REMOTE:=onedrive}"
# Remote propre aux images, par défaut celui des archives. Y mettre un remote
# `crypt` (enveloppant `onedrive:`) suffit à chiffrer les images sans rien
# changer d'autre : la synchronisation reste incrémentale.
: "${UPLOADS_RCLONE_REMOTE:=$RCLONE_REMOTE}"
: "${UPLOADS_DIR:=}"
: "${UPLOADS_REMOTE_DIR:=BlueGenji/uploads}"
: "${UPLOADS_LOCK_FILE:=/tmp/bluegenji-uploads-sync.lock}"

log() { echo "[uploads] $*"; }
die() { echo "[uploads] ÉCHEC : $*" >&2; exit 1; }

[[ -n "$UPLOADS_DIR" ]] || die "UPLOADS_DIR non renseigné dans $CONFIG_FILE"
[[ -d "$UPLOADS_DIR" ]] || die "dossier des images introuvable ($UPLOADS_DIR)"
for binary in rclone flock; do
  command -v "$binary" >/dev/null 2>&1 || die "binaire manquant : $binary"
done

# Garde-fou du miroir : un dossier vide (chemin changé au redéploiement, disque
# non monté, `public/uploads` recréé par un build) ferait tout effacer du
# distant — et définitivement. Un site en service a toujours au moins une image.
if [[ -z "$(find "$UPLOADS_DIR" -type f -print -quit)" ]]; then
  die "aucun fichier dans $UPLOADS_DIR — synchronisation refusée, elle viderait la sauvegarde"
fi

# Le cron horaire et la sauvegarde du lundi peuvent se croiser : deux `sync`
# simultanés vers le même dossier se marcheraient dessus. On attend le premier
# (il ne dure que quelques secondes en régime normal) plutôt que d'abandonner,
# sinon la sauvegarde hebdomadaire annoncerait un échec qui n'en est pas un.
exec 9>"$UPLOADS_LOCK_FILE"
flock -w 600 9 || die "une autre synchronisation tient le verrou depuis plus de 10 min"

DEST="$UPLOADS_RCLONE_REMOTE:$UPLOADS_REMOTE_DIR"

# --min-age 1m : le site écrit ses images sans renommage atomique, un fichier en
# cours d'écriture serait copié tronqué. Ignoré ce passage-ci, il part au suivant
# — et un fichier exclu par filtre n'est jamais supprimé du distant.
rclone sync "$UPLOADS_DIR" "$DEST" \
  --min-age 1m \
  --onedrive-hard-delete \
  --transfers 4 --retries 3 --low-level-retries 10 \
  || die "synchronisation vers $DEST impossible"

log "Images synchronisées vers $DEST."
