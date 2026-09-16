#!/usr/bin/env bash
#
# Sauvegarde chiffrée des bases BlueGenji vers OneDrive.
#
# Couvre les deux bases : le SQLite du bot et le MySQL du site. Le résultat est
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

# Repli aligné sur celui du bot (`src/bdd/Bdd.ts`) : un chemin de secours qui
# désigne une autre base que celle qui tourne sauvegarderait le mauvais
# fichier sans rien signaler. L'ancien pointait vers `/home/pi/...`, reste
# d'un hébergement sur Raspberry Pi qui n'existe plus.
: "${BDD_PATH:=./data/database.sqlite}"
: "${RCLONE_REMOTE:=onedrive}"
: "${REMOTE_DIR:=BlueGenji/backups}"
: "${AGE_RECIPIENTS_FILE:=$SCRIPT_DIR/backup-recipients.txt}"
: "${RETENTION_DAYS:=180}"
: "${STATUS_FILE:=/var/lib/bluegenji/backup-status.json}"
: "${MYSQL_DEFAULTS_FILE:=}"
: "${DB_DATABASE:=}"

STAMP="$(date +%Y-%m-%d)"
WORK_DIR="$(mktemp -d)"
ARCHIVE="$WORK_DIR/bluegenji-$STAMP.tar"
trap 'rm -rf "$WORK_DIR"' EXIT

# Le statut est écrit quoi qu'il arrive : une panne silencieuse est pire qu'une
# panne signalée, et c'est la seule trace que le bot saura relire.
STATUS_OK=false
STATUS_ERROR=""
STATUS_PARTS=""
STATUS_SIZE=0

write_status() {
  mkdir -p "$(dirname "$STATUS_FILE")"
  cat > "$STATUS_FILE" <<JSON
{
  "date": "$(date --iso-8601=seconds)",
  "ok": $STATUS_OK,
  "remote": "$RCLONE_REMOTE:$REMOTE_DIR/bluegenji-$STAMP.tar.age",
  "sizeBytes": $STATUS_SIZE,
  "parts": "$STATUS_PARTS",
  "error": "$STATUS_ERROR"
}
JSON
}

fail() {
  # Antislash et guillemet casseraient le JSON, et un JSON invalide ferait
  # afficher au bot « aucune sauvegarde » au lieu de la vraie cause de l'échec.
  STATUS_ERROR="$(printf '%s' "$1" | tr -d '\\"' | tr '\n' ' ')"
  write_status
  echo "[backup] ÉCHEC : $1" >&2
  exit 1
}

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

# --- 4. Envoi vers OneDrive ---------------------------------------------------
rclone copy "$ARCHIVE.age" "$RCLONE_REMOTE:$REMOTE_DIR" \
  --transfers 1 --retries 3 --low-level-retries 10 \
  || fail "envoi rclone vers $RCLONE_REMOTE:$REMOTE_DIR impossible"

# --- 5. Rétention -------------------------------------------------------------
# Un échec de purge ne doit pas invalider une sauvegarde déjà envoyée.
rclone delete "$RCLONE_REMOTE:$REMOTE_DIR" \
  --min-age "${RETENTION_DAYS}d" --include "bluegenji-*.tar.age" \
  || echo "[backup] purge des anciennes sauvegardes incomplète." >&2

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
