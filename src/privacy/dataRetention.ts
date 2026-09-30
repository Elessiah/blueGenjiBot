/**
 * Durées de conservation des données personnelles que le bot garde en base,
 * hors messages relayés (voir `messages/manageMsgExpiration.ts`).
 *
 * Deux ménages, tous deux joués au démarrage puis chaque nuit par la tâche
 * `cron` existante — aucun ordonnanceur de plus :
 *
 * - **auteurs des scrims et des recherches** : effacés au-delà de
 *   `ACTIVITY_AUTHOR_RETENTION_DAYS`, les lignes restant pour les compteurs ;
 * - **serveurs quittés pendant un arrêt** : Discord n'envoie `guildDelete` qu'à
 *   un bot connecté. Un serveur quitté pendant que le bot était arrêté — ou
 *   dont l'oubli a échoué à mi-chemin — garderait sinon sa configuration sans
 *   limite, alors que plus personne sur ce serveur ne peut la retirer.
 */

import type { Client } from "discord.js";

import { getBddInstance } from "@/bdd/Bdd.js";
import { reportError } from "@/safe/processGuards.js";
import { sendLog } from "@/safe/sendLog.js";

/**
 * Âge au-delà duquel l'auteur d'un scrim ou d'une recherche est effacé.
 * C'est la fenêtre de `/stats`, seul lecteur de l'auteur.
 */
export const ACTIVITY_AUTHOR_RETENTION_DAYS = 30;

/**
 * Efface l'auteur des scrims et recherches plus vieux que la durée de
 * conservation. N'échoue jamais bruyamment : l'erreur est signalée.
 * @param client Client Discord, pour le signalement d'erreur.
 * @returns Nombre de lignes anonymisées, ou `null` si le ménage a échoué.
 */
export async function anonymizeOldActivity(client: Client): Promise<number | null> {
  try {
    const bdd = await getBddInstance();
    const removed = await bdd.anonymizeActivityAuthors(ACTIVITY_AUTHOR_RETENTION_DAYS);
    return removed.Scrim + removed.Recrute;
  } catch (error) {
    await reportError(client, "anonymizeOldActivity", error);
    return null;
  }
}

/**
 * Oublie les serveurs configurés en base que le bot n'a plus rejoints.
 *
 * Même effacement que `guildDelete` (`forgetGuild` puis retrait des salons
 * relayés), sans relire le serveur chez Discord : il n'y est plus joignable.
 * Refuse d'agir sur un cache vide — un démarrage où Discord n'a encore livré
 * aucun serveur effacerait sinon la configuration de tous. Un serveur
 * momentanément indisponible (panne Discord) reste dans le cache, marqué
 * `available: false` : il n'est donc pas oublié.
 * @param client Client Discord connecté (`client.guilds.cache` rempli).
 * @returns Identifiants des serveurs oubliés.
 */
export async function forgetDepartedGuilds(client: Client): Promise<string[]> {
  const joined = client.guilds.cache;
  if (joined.size === 0) { return []; }
  const bdd = await getBddInstance();
  const departed = (await bdd.listConfiguredGuildIds()).filter((id) => !joined.has(id));
  const forgotten: string[] = [];
  for (const guildId of departed) {
    try {
      // La configuration d'abord : les filtres de rang se retrouvent par les
      // salons partenaires, retirés ensuite.
      await bdd.forgetGuild(guildId);
      const channels = await bdd.raw<{ id_channel: string }>(
        "SELECT id_channel FROM ChannelPartner WHERE id_guild = ?",
        [guildId],
      );
      for (const { id_channel } of channels) {
        const ret = await bdd.deleteChannelServices(id_channel);
        if (!ret.success) { throw new Error(ret.message); }
      }
      forgotten.push(guildId);
    } catch (error) {
      await reportError(client, "forgetDepartedGuilds", error);
    }
  }
  if (forgotten.length > 0) {
    await sendLog(client, `${forgotten.length} serveur(s) quitté(s) pendant un arrêt du bot : configuration effacée.`);
  }
  return forgotten;
}

/**
 * Les deux ménages, dans l'ordre. Chacun signale son propre échec sans priver
 * l'autre de passer.
 * @param client Client Discord connecté.
 */
export async function runDataRetention(client: Client): Promise<void> {
  await anonymizeOldActivity(client);
  try {
    await forgetDepartedGuilds(client);
  } catch (error) {
    await reportError(client, "forgetDepartedGuilds", error);
  }
}
