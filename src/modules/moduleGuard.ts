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

export function isValidModule(key: string): key is ModuleKey {
  return (MODULE_KEYS as readonly string[]).includes(key);
}

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
