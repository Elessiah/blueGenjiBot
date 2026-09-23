#!/usr/bin/env bash
#
# Miroir chiffré des images téléversées du site, et de son journal des
# suppressions, vers OneDrive.
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
#     pendant toute la rétention.
#
# **Un miroir, pas un historique** : un fichier supprimé du site l'est aussi de
# OneDrive au passage suivant, et définitivement (`--onedrive-hard-delete`,
# sans détour par la corbeille OneDrive, qui le garderait encore 30 jours ;
# `--onedrive-no-versions`, sans quoi un fichier réécrit garde ses anciennes
# versions). C'est ce qui rend effective la suppression d'un avatar ou d'un
# compte. Contrepartie assumée : une image supprimée par erreur ne se récupère
# pas ici, et un dump ancien restauré peut désigner des images parties.
#
# **Chiffré** : un avatar est une donnée personnelle — masqué ou non sur le site —
# et un OneDrive personnel n'offre aucun contrat de sous-traitance. Le remote des
# images doit donc être un remote `crypt` ; le script refuse d'envoyer en clair
# sauf si UPLOADS_ALLOW_PLAINTEXT=true.
#
# Le **journal des suppressions** du site (data/account-deletions.jsonl, une
# ligne par compte supprimé) part avec, sur le même remote : c'est lui qui
# permet de rejouer les suppressions après la restauration d'une archive, y
# compris quand la machine elle-même a été perdue (`npm run replay:deletions`
# côté site).
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
: "${UPLOADS_RCLONE_REMOTE:=$RCLONE_REMOTE}"
: "${UPLOADS_DIR:=}"
: "${UPLOADS_REMOTE_DIR:=uploads}"
: "${UPLOADS_ALLOW_PLAINTEXT:=false}"
: "${DELETION_JOURNAL_REMOTE_DIR:=deletions}"
: "${UPLOADS_LOCK_FILE:=/tmp/bluegenji-uploads-sync.lock}"
# Mêmes défauts que backup-onedrive.sh : la purge horaire des archives en dépend.
: "${REMOTE_DIR:=BlueGenji/backups}"
: "${RETENTION_DAYS:=30}"

log() { echo "[uploads] $*"; }
die() { echo "[uploads] ÉCHEC : $*" >&2; exit 1; }

[[ -n "$UPLOADS_DIR" ]] || die "UPLOADS_DIR non renseigné dans $CONFIG_FILE"
[[ -d "$UPLOADS_DIR" ]] || die "dossier des images introuvable ($UPLOADS_DIR)"
for binary in rclone flock; do
  command -v "$binary" >/dev/null 2>&1 || die "binaire manquant : $binary"
done

# Le journal vit à côté de l'app : <app>/public/uploads → <app>/data/…, sauf
# réglage explicite (qui doit alors suivre ACCOUNT_DELETION_JOURNAL_PATH du site).
: "${DELETION_JOURNAL_PATH:=$(dirname "$(dirname "${UPLOADS_DIR%/}")")/data/account-deletions.jsonl}"

# --- Chiffrement ---------------------------------------------------------------
# `rclone listremotes --long` rend « nom: type » ; seul un remote `crypt` chiffre.
REMOTE_TYPE="$(rclone listremotes --long 2>/dev/null \
  | awk -v name="$UPLOADS_RCLONE_REMOTE:" '$1 == name { print $2 }')"
[[ -n "$REMOTE_TYPE" ]] || die "remote rclone inconnu : $UPLOADS_RCLONE_REMOTE"
if [[ "$REMOTE_TYPE" != "crypt" && "$UPLOADS_ALLOW_PLAINTEXT" != "true" ]]; then
  die "le remote $UPLOADS_RCLONE_REMOTE n'est pas chiffré (type $REMOTE_TYPE) — voir doc/backup-onedrive.md, ou UPLOADS_ALLOW_PLAINTEXT=true"
fi

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

ONEDRIVE_FLAGS=(--onedrive-hard-delete --onedrive-no-versions)
DEST="$UPLOADS_RCLONE_REMOTE:$UPLOADS_REMOTE_DIR"

# --min-age 1m : le site écrit ses images sans renommage atomique, un fichier en
# cours d'écriture serait copié tronqué. Ignoré ce passage-ci, il part au suivant
# — et un fichier exclu par filtre n'est jamais supprimé du distant.
rclone sync "$UPLOADS_DIR" "$DEST" \
  --min-age 1m \
  "${ONEDRIVE_FLAGS[@]}" \
  --transfers 4 --retries 3 --low-level-retries 10 \
  || die "synchronisation vers $DEST impossible"

# --- Journal des suppressions --------------------------------------------------
# Miroir lui aussi : le site l'élague, la copie distante doit l'être avec lui.
# Pas de --min-age : le site l'écrit par renommage, jamais à moitié.
JOURNAL_DEST="$UPLOADS_RCLONE_REMOTE:$DELETION_JOURNAL_REMOTE_DIR/account-deletions.jsonl"
if [[ -f "$DELETION_JOURNAL_PATH" ]]; then
  rclone copyto "$DELETION_JOURNAL_PATH" "$JOURNAL_DEST" \
    "${ONEDRIVE_FLAGS[@]}" --retries 3 \
    || die "envoi du journal des suppressions impossible ($JOURNAL_DEST)"
else
  # Aucune suppression consignée (ou journal retiré) : rien ne doit rester en face.
  rclone deletefile "$JOURNAL_DEST" "${ONEDRIVE_FLAGS[@]}" >/dev/null 2>&1 || true
fi

# --- Rétention des archives ----------------------------------------------------
# La purge de backup-onedrive.sh ne tourne que le lundi : une archive créée un
# lundi y a 28 jours au quatrième passage (gardée), 35 au cinquième — au-delà des
# RETENTION_DAYS que le site annonce. Refaite ici chaque heure, la borne tient à
# une heure près, même quand la sauvegarde du lundi échoue avant sa purge. Un
# échec de purge ne fait pas échouer la synchronisation.
rclone delete "$RCLONE_REMOTE:$REMOTE_DIR" \
  --min-age "${RETENTION_DAYS}d" --include "bluegenji-*.tar.age" \
  --onedrive-hard-delete \
  || echo "[uploads] purge des anciennes archives incomplète." >&2

log "Images et journal des suppressions synchronisés vers $UPLOADS_RCLONE_REMOTE."
