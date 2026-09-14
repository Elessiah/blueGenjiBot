/**
 * Activation/desactivation par serveur des modules fonctionnels du bot (annonces, scrims, ...).
 *
 * Chaque serveur decide independamment ce qu'il utilise : `/config` (cote
 * commande) et `/internal/servers/:id/modules` (cote app web) passent tous
 * deux par ce module pour lire et ecrire l'etat. Absence de ligne en base
 * vaut "active" (voir `isModuleEnabled`) : un module nouvellement ajoute doit
 * marcher partout sans migration retroactive de chaque serveur existant.
 */

import { getBddInstance } from "@/bdd/Bdd.js";

export const MODULE_KEYS = [
  "annonces",
  "scrims",
  "recrutement",
  "notifications",
  "oauth",
  "stats",
] as const;
export type ModuleKey = typeof MODULE_KEYS[number];

/**
 * Verifie qu'une chaine correspond a une cle de module connue.
 * @param key Valeur a verifier (typiquement issue d'une option de commande ou d'un param d'URL).
 * @returns `true` si `key` est une des clefs de `MODULE_KEYS` (garde de type associee).
 */
export function isValidModule(key: string): key is ModuleKey {
  return (MODULE_KEYS as readonly string[]).includes(key);
}

/**
 * Indique si un module est actif pour un serveur donne.
 *
 * `oauth` est toujours actif (voir l'en-tete du module) ; une erreur de
 * lecture repond aussi `true` par defaut — un module qui echoue a verifier son
 * etat doit continuer a fonctionner plutot que de se couper silencieusement
 * pour tous les serveurs a la moindre panne de base.
 *
 * @param guildId Serveur concerne.
 * @param moduleKey Module a verifier.
 * @returns `true` si le module est actif (ou si aucune preference n'a ete enregistree).
 */
export async function isModuleEnabled(
  guildId: string,
  moduleKey: ModuleKey
): Promise<boolean> {
  if (moduleKey === "oauth") {
    return true;
  }
  try {
    const bdd = await getBddInstance();
    const rows = (await bdd.get(
      "ServerModule",
      ["enabled"],
      {},
      {
        query: "id_guild = ? AND module_key = ?",
        values: [guildId, moduleKey],
      }
    )) as { enabled: number }[];
    if (rows.length === 0) {
      return true;
    }
    return rows[0].enabled === 1;
  } catch {
    return true;
  }
}

/**
 * Active ou desactive un module pour un serveur.
 *
 * No-op pour `oauth`, qui ne peut pas etre desactive (voir l'en-tete du
 * module).
 *
 * @param guildId Serveur concerne.
 * @param moduleKey Module a basculer.
 * @param enabled Nouvel etat souhaite.
 */
export async function setModuleEnabled(
  guildId: string,
  moduleKey: ModuleKey,
  enabled: boolean
): Promise<void> {
  if (moduleKey === "oauth") {
    return;
  }
  const bdd = await getBddInstance();
  await bdd.raw(
    "INSERT INTO ServerModule (id_guild, module_key, enabled) VALUES (?, ?, ?) ON CONFLICT(id_guild, module_key) DO UPDATE SET enabled = excluded.enabled",
    [guildId, moduleKey, enabled ? 1 : 0]
  );
}

/**
 * Liste l'etat de tous les modules connus pour un serveur, y compris ceux sans ligne en base.
 * @param guildId Serveur concerne.
 * @returns Un etat pour chaque `ModuleKey`, `oauth` toujours a `true` et les autres a `true` par defaut en l'absence de preference enregistree.
 */
export async function listModules(
  guildId: string
): Promise<Array<{ key: ModuleKey; enabled: boolean }>> {
  const bdd = await getBddInstance();
  const rows = (await bdd.get(
    "ServerModule",
    ["module_key", "enabled"],
    {},
    {
      query: "id_guild = ?",
      values: [guildId],
    }
  )) as { module_key: string; enabled: number }[];
  const map = new Map(rows.map((r) => [r.module_key, r.enabled === 1]));
  return MODULE_KEYS.map((k) => ({
    key: k,
    enabled: k === "oauth" ? true : map.get(k) ?? true,
  }));
}
