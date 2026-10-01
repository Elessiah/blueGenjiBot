#!/usr/bin/env bash
#
# Fonctions partagées par backup-onedrive.sh et sync-uploads-onedrive.sh :
# reconnaître le stockage réel derrière un remote rclone, pour ne passer les
# options propres à un fournisseur qu'au fournisseur qui les comprend.
#
# Les noms de fichiers des scripts (`*-onedrive.*`) sont historiques : le
# stockage distant est indifférent (OneDrive, Nextcloud/WebDAV, …), et le cron
# de production les appelle sous ces noms. Fichier destiné à être sourcé.

# Remotes qui enveloppent un autre remote (option `remote = autre:chemin`).
RCLONE_WRAPPER_TYPES=" crypt alias chunker compress hasher "

# rclone_backend NOM — écrit le type du stockage réel derrière le remote NOM,
# en descendant les enveloppes (crypt → onedrive, par exemple). Code de sortie
# non nul si le remote est inconnu.
rclone_backend() {
  local name="${1%%:*}" type underlying _depth
  for _depth in 1 2 3 4 5; do
    type="$(rclone listremotes --long 2>/dev/null \
      | awk -v name="$name:" '$1 == name { print $2 }')"
    [[ -n "$type" ]] || return 1
    if [[ "$RCLONE_WRAPPER_TYPES" != *" $type "* ]]; then
      echo "$type"
      return 0
    fi
    underlying="$(rclone config show "$name" 2>/dev/null \
      | awk -F ' = ' '$1 == "remote" { print $2; exit }')"
    if [[ -z "$underlying" ]]; then
      echo "$type"
      return 0
    fi
    # Un chemin sans « nom: » désigne un dossier local.
    if [[ "$underlying" != *:* ]]; then
      echo "local"
      return 0
    fi
    name="${underlying%%:*}"
  done
  return 1
}

# provider_delete_flags NOM — écrit, une par ligne, les options qui rendent une
# suppression définitive chez le fournisseur du remote NOM. Seul OneDrive en a
# (corbeille et historique de versions évités par option) ; ailleurs rien n'est
# passé. Sur Nextcloud/WebDAV, corbeille et versions se coupent côté serveur
# (applications « Deleted files » et « Versions ») : voir doc/backup-onedrive.md.
#
# Fournisseur non identifié (configuration chiffrée sans mot de passe sous
# cron, remote défini par variables d'environnement, remote inconnu) : aucune
# option n'est passée, mais un avertissement part sur la sortie d'erreur — les
# appelants lisent la sortie par `mapfile < <(…)`, qui masque le code de sortie,
# et un OneDrive non reconnu enverrait sinon ses suppressions à la corbeille
# sans que rien ne le dise.
provider_delete_flags() {
  local backend
  if ! backend="$(rclone_backend "$1")"; then
    echo "[backup] AVERTISSEMENT : fournisseur du remote $1 non identifié — aucune option de suppression définitive passée ; vérifier que corbeille et versions sont coupées côté stockage." >&2
    return 0
  fi
  if [[ "$backend" == "onedrive" ]]; then
    printf '%s\n' --onedrive-hard-delete --onedrive-no-versions
  fi
}
