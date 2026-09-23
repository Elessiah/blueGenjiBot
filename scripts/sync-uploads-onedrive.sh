#!/usr/bin/env bash
#
# Synchronisation des images téléversées du site vers OneDrive.
#
# Couvre `public/uploads` d'appbluegenji : avatars, logos d'équipe, logos de
# partenaires, photos de bénévoles, illustrations de tournoi. Ces fichiers ne
# sont ni dans le dump MySQL (la base ne garde que leur chemin) ni dans l'archive
# chiffrée : sans eux, une base restaurée pointe vers des images disparues.
#
# Pourquoi un script à part, et pas une étape de l'archive hebdomadaire :
#   - les images sont servies publiquement par le site, il n'y a rien à chiffrer ;
#   - `rclone sync` n'envoie que ce qui a changé, donc le script peut tourner
#     souvent (cron horaire) — une image téléversée lundi n'attend pas une
#     semaine sa première copie, et chaque passage ne coûte presque rien ;
#   - archiver le dossier entier chaque semaine dupliquerait les mêmes fichiers
#     pendant les 180 jours de rétention.
#
# Un fichier supprimé ou remplacé côté site n'est pas perdu d'un coup : rclone
# le déplace dans `deleted/<horodatage>/`, purgé après UPLOADS_RETENTION_DAYS.
# C'est ce qui permet de restaurer un dump ancien avec les images qu'il désigne.
#
# Appelé seul par cron, ou par backup-onedrive.sh, qui en reporte l'échec dans
# le statut hebdomadaire. Code de sortie non nul sur tout échec d'envoi.
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
: "${UPLOADS_DIR:=}"
: "${UPLOADS_REMOTE_DIR:=BlueGenji/uploads}"
: "${RETENTION_DAYS:=180}"
# Même rétention que les archives par défaut : un dump restauré doit retrouver
# les images qu'il référence. À raccourcir si l'on veut que les images d'un
# compte supprimé disparaissent plus vite de OneDrive.
: "${UPLOADS_RETENTION_DAYS:=$RETENTION_DAYS}"
: "${UPLOADS_LOCK_FILE:=/tmp/bluegenji-uploads-sync.lock}"

log() { echo "[uploads] $*"; }
die() { echo "[uploads] ÉCHEC : $*" >&2; exit 1; }

[[ -n "$UPLOADS_DIR" ]] || die "UPLOADS_DIR non renseigné dans $CONFIG_FILE"
[[ -d "$UPLOADS_DIR" ]] || die "dossier des images introuvable ($UPLOADS_DIR)"
for binary in rclone flock; do
  command -v "$binary" >/dev/null 2>&1 || die "binaire manquant : $binary"
done

# Le cron horaire et la sauvegarde du lundi peuvent se croiser : deux `sync`
# simultanés vers le même dossier se marcheraient dessus. On attend le premier
# (il ne dure que quelques secondes en régime normal) plutôt que d'abandonner,
# sinon la sauvegarde hebdomadaire annoncerait un échec qui n'en est pas un.
exec 9>"$UPLOADS_LOCK_FILE"
flock -w 600 9 || die "une autre synchronisation tient le verrou depuis plus de 10 min"

CURRENT="$RCLONE_REMOTE:$UPLOADS_REMOTE_DIR/current"
DELETED_ROOT="$RCLONE_REMOTE:$UPLOADS_REMOTE_DIR/deleted"
STAMP="$(date +%Y-%m-%dT%H%M%S)"

# --min-age 1m : le site écrit ses images sans renommage atomique, un fichier en
# cours d'écriture serait copié tronqué. Ignoré ce passage-ci, il part au suivant
# — et un fichier exclu par filtre n'est jamais supprimé du distant.
rclone sync "$UPLOADS_DIR" "$CURRENT" \
  --backup-dir "$DELETED_ROOT/$STAMP" \
  --min-age 1m \
  --transfers 4 --retries 3 --low-level-retries 10 \
  || die "synchronisation vers $CURRENT impossible"

# --- Rétention des fichiers supprimés ----------------------------------------
# Pas de `rclone delete --min-age` ici : un fichier déplacé garde sa date de
# modification d'origine, si bien qu'une image vieille de deux ans supprimée hier
# serait purgée aussitôt. L'âge se lit sur le nom du dossier, qui date le retrait.
# Un échec de purge n'invalide pas une synchronisation réussie.
CUTOFF="$(date -d "-${UPLOADS_RETENTION_DAYS} days" +%Y-%m-%d)"
if DELETED_DIRS="$(rclone lsf --dirs-only "$DELETED_ROOT" 2>/dev/null)"; then
  while IFS= read -r dir; do
    dir="${dir%/}"
    [[ "$dir" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T ]] || continue
    if [[ "${dir:0:10}" < "$CUTOFF" ]]; then
      rclone purge "$DELETED_ROOT/$dir" \
        || echo "[uploads] purge de deleted/$dir incomplète." >&2
    fi
  done <<< "$DELETED_DIRS"
fi

log "Images synchronisées vers $CURRENT."
