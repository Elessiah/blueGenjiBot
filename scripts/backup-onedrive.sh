#!/usr/bin/env bash
#
# Sauvegarde chiffrée des bases BlueGenji vers le stockage distant.
#
# Le nom du fichier est historique (le cron de production l'appelle ainsi) : le
# stockage est celui du remote rclone configuré, quel que soit son fournisseur.
#
# Couvre les deux bases — le SQLite du bot et le MySQL du site — puis, si
# UPLOADS_DIR est renseigné, les images téléversées du site (miroir incrémental,
# hors archive : voir sync-uploads-onedrive.sh). Le résultat est
# déposé dans un fichier de statut que le bot relit pour son rapport hebdomadaire
# (voir src/backup/backupStatus.ts) : le script reste ainsi indépendant du bot,
# et une sauvegarde continue même si le process Discord est arrêté.
#
# Configuration : scripts/backup-onedrive.env (voir .env.example du même nom).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${BACKUP_CONFIG:-$SCRIPT_DIR/backup-onedrive.env}"

if [[ -f "$CONFIG_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$CONFIG_FILE"
fi
# shellcheck source=rclone-backend.sh
source "$SCRIPT_DIR/rclone-backend.sh"

# Repli aligné sur celui du bot (`src/bdd/Bdd.ts`) : un chemin de secours qui
# désigne une autre base que celle qui tourne sauvegarderait le mauvais
# fichier sans rien signaler. L'ancien pointait vers `/home/pi/...`, chemin
# en dur d'une ancienne installation : le bot et le site tournent toujours sur
# un Raspberry Pi (à Caen), mais rien ne garantit ce chemin-là.
: "${BDD_PATH:=./data/database.sqlite}"
: "${RCLONE_REMOTE:=onedrive}" # défaut historique ; la configuration le fixe
: "${REMOTE_DIR:=BlueGenji/backups}"
: "${AGE_RECIPIENTS_FILE:=$SCRIPT_DIR/backup-recipients.txt}"
# 30 jours : c'est la durée que la politique de confidentialité du site annonce
# (`BACKUP_RETENTION_DAYS`, appbluegenji `lib/shared/account-deletion-journal.ts`).
# La changer ici sans la changer là-bas rendrait la page fausse.
: "${RETENTION_DAYS:=30}"
: "${STATUS_FILE:=/var/lib/bluegenji/backup-status.json}"
# Historique des statuts, une ligne JSON par exécution : le rapport du lundi y
# relit les échecs depuis le précédent, que le dernier statut écraserait (deux
# sauvegardes par semaine).
: "${STATUS_HISTORY_FILE:=${STATUS_FILE%.json}-history.jsonl}"
: "${MYSQL_DEFAULTS_FILE:=}"
: "${DB_DATABASE:=}"
: "${UPLOADS_DIR:=}"

STAMP="$(date +%Y-%m-%d)"
WORK_DIR="$(mktemp -d)"
ARCHIVE="$WORK_DIR/bluegenji-$STAMP.tar"
# Marqueur de sauvegarde en cours, à côté du statut (`runningMarkerPath` du bot) :
# le rapport du lundi 4 h ne prend pas une sauvegarde du dimanche soir encore en
# cours pour une sauvegarde manquée. Une ligne par exécution en cours (date ISO de
# son départ, puis son PID), ajoutée au départ et retirée à la sortie, quelle
# qu'elle soit, sous verrou : deux exécutions qui se chevauchent (lancement manuel
# pendant le cron), dans un ordre ou dans l'autre, ne retirent jamais que leur
# propre ligne — le fichier disparaît avec la dernière. Une exécution tuée sans
# repasser par sa sortie (manque de mémoire, redémarrage) laisse sa ligne : la
# suivante l'efface en ajoutant la sienne, et le bot l'ignore (PID mort). Le verrou
# est pris sur le dossier du marqueur, sans fichier de verrou à côté ; sans `flock`
# (machine incomplète), l'écriture reste tentée.
RUNNING_FILE="$STATUS_FILE.running"
RUNNING_LINE="$(date --iso-8601=seconds) $$"
with_running_lock() {
  (
    if command -v flock >/dev/null 2>&1; then
      flock -w 10 9 || exit 1
    fi
    "$@"
  ) 9<"$(dirname "$RUNNING_FILE")"
}
# Une ligne dont le PID ne tourne plus (ni `/proc/<pid>`, ni `kill -0`) est effacée.
running_line_alive() {
  local pid="${1##* }"
  [[ "$pid" == "$1" || ! "$pid" =~ ^[0-9]+$ ]] && return 0
  [[ -d "/proc/$pid" ]] || kill -0 "$pid" 2>/dev/null
}
add_running_line() {
  if [[ -f "$RUNNING_FILE" ]]; then
    local line
    : > "$RUNNING_FILE.tmp.$$"
    while IFS= read -r line || [[ -n "$line" ]]; do
      [[ -z "$line" ]] && continue
      if running_line_alive "$line"; then printf '%s\n' "$line" >> "$RUNNING_FILE.tmp.$$"; fi
    done < "$RUNNING_FILE"
    mv "$RUNNING_FILE.tmp.$$" "$RUNNING_FILE"
  fi
  printf '%s\n' "$RUNNING_LINE" >> "$RUNNING_FILE"
}
remove_running_line() {
  [[ -f "$RUNNING_FILE" ]] || return 0
  grep -vxF -- "$RUNNING_LINE" "$RUNNING_FILE" > "$RUNNING_FILE.tmp.$$" || true
  if [[ -s "$RUNNING_FILE.tmp.$$" ]]; then
    mv "$RUNNING_FILE.tmp.$$" "$RUNNING_FILE"
  else
    rm -f "$RUNNING_FILE.tmp.$$" "$RUNNING_FILE"
  fi
}
release_running_marker() {
  with_running_lock remove_running_line 2>/dev/null || true
}
trap 'rm -rf "$WORK_DIR"; release_running_marker' EXIT
{ mkdir -p "$(dirname "$RUNNING_FILE")" && with_running_lock add_running_line; } 2>/dev/null \
  || echo "[backup] marqueur de sauvegarde en cours non écrit." >&2

# Chemin de l'historique écrit dans le statut : le bot relit celui-là au lieu de le
# recalculer. Un chemin qui casserait le JSON (guillemet, antislash, contrôle) n'y
# figure pas : le bot retombe alors sur son propre calcul, comme avant.
STATUS_HISTORY_JSON="$STATUS_HISTORY_FILE"
if [[ "$(printf '%s' "$STATUS_HISTORY_JSON" | tr -d '\000-\037\\"')" != "$STATUS_HISTORY_JSON" ]]; then
  STATUS_HISTORY_JSON=""
fi

# Le statut est écrit quoi qu'il arrive : une panne silencieuse est pire qu'une
# panne signalée, et c'est la seule trace que le bot saura relire.
STATUS_OK=false
STATUS_ERROR=""
STATUS_PARTS=""
STATUS_SIZE=0

# Lignes gardées dans l'historique : un peu plus de deux mois.
STATUS_HISTORY_LINES=20

write_status() {
  mkdir -p "$(dirname "$STATUS_FILE")" "$(dirname "$STATUS_HISTORY_FILE")"
  local now
  now="$(date --iso-8601=seconds)"
  cat > "$STATUS_FILE" <<JSON
{
  "date": "$now",
  "ok": $STATUS_OK,
  "remote": "$RCLONE_REMOTE:$REMOTE_DIR/bluegenji-$STAMP.tar.age",
  "sizeBytes": $STATUS_SIZE,
  "parts": "$STATUS_PARTS",
  "error": "$STATUS_ERROR",
  "historyFile": "$STATUS_HISTORY_JSON"
}
JSON
  # Au mieux : un historique qui ne s'écrit pas ne fait pas échouer la sauvegarde.
  # L'ajout et l'élagage forment un tout sous verrou (pris sur le dossier de
  # l'historique, sans fichier de verrou à côté) : deux exécutions qui se
  # chevauchent (lancement manuel pendant le cron) ne perdent aucune ligne
  # d'échec. Sans `flock` (machine incomplète), l'écriture reste tentée.
  {
    (
      if command -v flock >/dev/null 2>&1; then
        flock -w 30 8 || exit 1
      fi
      printf '{"date":"%s","ok":%s,"error":"%s"}\n' "$now" "$STATUS_OK" "$STATUS_ERROR" >> "$STATUS_HISTORY_FILE" \
        && tail -n "$STATUS_HISTORY_LINES" "$STATUS_HISTORY_FILE" > "$STATUS_HISTORY_FILE.tmp.$$" \
        && mv "$STATUS_HISTORY_FILE.tmp.$$" "$STATUS_HISTORY_FILE"
    ) 8<"$(dirname "$STATUS_HISTORY_FILE")"
  } || echo "[backup] historique des statuts non écrit." >&2
}

fail() {
  # Antislash, guillemet et caractères de contrôle (tabulation, retour chariot
  # d'une sortie rclone) casseraient le JSON, et un JSON invalide ferait
  # afficher au bot « aucune sauvegarde » au lieu de la vraie cause de l'échec
  # — ou retirerait l'échec de l'historique relu par le rapport du lundi.
  STATUS_ERROR="$(printf '%s' "$1" | tr '\n\r\t' '   ' | tr -d '\000-\037\\"')"
  write_status
  echo "[backup] ÉCHEC : $1" >&2
  exit 1
}

# Un nombre de jours, au moins 1 : 0 ou une valeur négative donnerait un seuil
# négatif à la purge, qui effacerait alors toutes les archives.
[[ "$RETENTION_DAYS" =~ ^[1-9][0-9]*$ ]] || fail "RETENTION_DAYS invalide ($RETENTION_DAYS) : un nombre de jours, au moins 1"
# Marge des purges sous la borne, la même que sync-uploads-onedrive.sh.
PURGE_MARGIN_HOURS=3

# --- 0. Dépendances -----------------------------------------------------------
# Vérifiées avant tout travail : un binaire manquant doit produire un statut
# lisible, pas un `command not found` qui sort du script sans rien écrire.
for binary in sqlite3 tar age rclone; do
  command -v "$binary" >/dev/null 2>&1 || fail "binaire manquant : $binary"
done

# --- 1. Snapshot SQLite -------------------------------------------------------
# `.backup` (et non une copie fichier) : la base est lue pendant que le bot écrit.
[[ -f "$BDD_PATH" ]] || fail "base SQLite introuvable ($BDD_PATH)"
sqlite3 "$BDD_PATH" ".backup '$WORK_DIR/database.sqlite'" \
  || fail "snapshot SQLite impossible"
STATUS_PARTS="sqlite"

# --- 2. Dump MySQL du site ----------------------------------------------------
# Optionnel : sans identifiants configurés, la sauvegarde du bot part quand même.
if [[ -n "$MYSQL_DEFAULTS_FILE" && -n "$DB_DATABASE" ]]; then
  [[ -f "$MYSQL_DEFAULTS_FILE" ]] || fail "fichier d'identifiants MySQL introuvable ($MYSQL_DEFAULTS_FILE)"
  # --single-transaction : dump cohérent sans verrouiller le site en écriture.
  mysqldump --defaults-extra-file="$MYSQL_DEFAULTS_FILE" \
    --single-transaction --quick --routines --events \
    "$DB_DATABASE" > "$WORK_DIR/appbluegenji.sql" \
    || fail "mysqldump a échoué sur $DB_DATABASE"
  STATUS_PARTS="$STATUS_PARTS+mysql"
else
  echo "[backup] MySQL non configuré — seule la base du bot est sauvegardée."
fi

# --- 3. Archive + chiffrement -------------------------------------------------
CONTENTS=(database.sqlite)
[[ -f "$WORK_DIR/appbluegenji.sql" ]] && CONTENTS+=(appbluegenji.sql)
tar -cf "$ARCHIVE" -C "$WORK_DIR" "${CONTENTS[@]}" \
  || fail "création de l'archive impossible"

[[ -f "$AGE_RECIPIENTS_FILE" ]] || fail "clé de chiffrement absente ($AGE_RECIPIENTS_FILE)"
age --encrypt --recipients-file "$AGE_RECIPIENTS_FILE" \
  --output "$ARCHIVE.age" "$ARCHIVE" \
  || fail "chiffrement age impossible"
rm -f "$ARCHIVE"

STATUS_SIZE="$(stat -c %s "$ARCHIVE.age")"

# --- 4. Envoi vers le stockage distant ---------------------------------------
rclone copy "$ARCHIVE.age" "$RCLONE_REMOTE:$REMOTE_DIR" \
  --transfers 1 --retries 3 --low-level-retries 10 \
  || fail "envoi rclone vers $RCLONE_REMOTE:$REMOTE_DIR impossible"

# --- 5. Rétention -------------------------------------------------------------
# Un échec de purge ne doit pas invalider une sauvegarde déjà envoyée.
# Suppression définitive : sur OneDrive, `--onedrive-hard-delete` évite la
# corbeille, qui garderait l'archive purgée 30 jours de plus — la durée annoncée
# serait fausse d'autant. Ailleurs (Nextcloud/WebDAV), aucune option n'y peut
# rien : corbeille et versions se coupent côté serveur (doc/backup-onedrive.md).
# Même seuil que la purge horaire (sync-uploads-onedrive.sh) : PURGE_MARGIN_HOURS
# heures sous RETENTION_DAYS jours, pour qu'aucune archive ne dépasse la durée
# annoncée, même quand un passage attend le verrou.
mapfile -t DELETE_FLAGS < <(provider_delete_flags "$RCLONE_REMOTE")
rclone delete "$RCLONE_REMOTE:$REMOTE_DIR" \
  --min-age "$((RETENTION_DAYS * 24 - PURGE_MARGIN_HOURS))h" --include "bluegenji-*.tar.age" \
  "${DELETE_FLAGS[@]}" \
  || echo "[backup] purge des anciennes sauvegardes incomplète." >&2

# --- 6. Images du site --------------------------------------------------------
# Après l'archive, et non avant : une panne du stockage côté images ne doit pas
# priver la sauvegarde des bases. L'échec est tout de même porté
# au statut — le cron horaire qui fait le gros du travail n'a, lui, aucun autre
# moyen d'être remarqué que ce rapport du lundi.
if [[ -n "$UPLOADS_DIR" ]]; then
  UPLOADS_LOG="$WORK_DIR/uploads.log"
  if BACKUP_CONFIG="$CONFIG_FILE" "$SCRIPT_DIR/sync-uploads-onedrive.sh" >"$UPLOADS_LOG" 2>&1; then
    STATUS_PARTS="$STATUS_PARTS+images"
    cat "$UPLOADS_LOG"
  else
    cat "$UPLOADS_LOG" >&2
    fail "bases envoyées, mais images non synchronisées : $(grep -m1 'ÉCHEC' "$UPLOADS_LOG" | sed 's/^\[uploads\] ÉCHEC : //' || echo 'cause inconnue')"
  fi
else
  echo "[backup] UPLOADS_DIR non configuré — images du site non sauvegardées."
fi

STATUS_OK=true
write_status
# Une archive de quelques centaines de kilo-octets s'affichait « 0 Mo », ce qui
# se lit comme un échec alors que la sauvegarde est bonne.
if [[ "$STATUS_SIZE" -ge 1048576 ]]; then
  SIZE_TEXT="$((STATUS_SIZE / 1048576)) Mo"
else
  SIZE_TEXT="$((STATUS_SIZE / 1024)) Ko"
fi
echo "[backup] Sauvegarde $STATUS_PARTS envoyée ($SIZE_TEXT)."
