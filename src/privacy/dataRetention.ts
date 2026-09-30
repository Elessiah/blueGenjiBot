/**
 * Durées de conservation des données personnelles que le bot garde en base
 * (la purge des messages relayés elle-même vit dans
 * `messages/manageMsgExpiration.ts` ; ce module ne fait que la rattraper).
 *
 * Trois ménages, joués au démarrage, chaque nuit par la tâche `cron`
 * existante et après une restauration de la base — aucun ordonnanceur de plus :
 *
 * - **messages relayés** : la purge à 7 jours (`manageMsgExpiration`) n'était
 *   entraînée que par un nouveau relais ; une semaine sans relais la laissait
 *   dormir. La nuit la rattrape ;
 * - **auteurs des scrims et des recherches** : effacés au-delà de
 *   `ACTIVITY_AUTHOR_RETENTION_DAYS`, les lignes restant pour les compteurs ;
 * - **serveurs quittés pendant un arrêt** : Discord n'envoie `guildDelete` qu'à
 *   un bot connecté. Un serveur quitté pendant que le bot était arrêté — ou
 *   dont l'oubli a échoué à mi-chemin — garderait sinon sa configuration sans
 *   limite, alors que plus personne sur ce serveur ne peut la retirer.
 */

import type { Client } from "discord.js";

import { getBddInstance } from "@/bdd/Bdd.js";
import { manageMsgExpiration } from "@/messages/manageMsgExpiration.js";
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
 * Efface tout ce que la base garde d'un serveur quitté : sa configuration
 * (`forgetGuild`), puis ses salons relayés et leurs services.
 *
 * Unique chemin d'oubli, partagé par `guildDelete` et le rattrapage du
 * démarrage : deux copies divergeraient à la prochaine table ajoutée. Le
 * serveur n'est pas relu chez Discord — il n'y est plus joignable, et
 * `_resetServer`, qui le relit pour journaliser son nom, échouait justement là.
 * Un échec de la configuration ne prive pas le serveur du retrait de ses
 * salons relayés — qui cesseraient sinon d'être visés par des relais
 * voués à l'échec : les deux sont tentés, puis la première erreur remonte.
 * Ce qui reste est repris par le rattrapage suivant.
 * @param guildId Identifiant du serveur quitté.
 * @throws La première erreur rencontrée, une fois les deux étapes tentées.
 */
export async function eraseGuild(guildId: string): Promise<void> {
  const bdd = await getBddInstance();
  let failure: unknown = null;
  // La configuration d'abord : les filtres de rang se retrouvent par les
  // salons partenaires, retirés ensuite.
  try {
    await bdd.forgetGuild(guildId);
  } catch (error) {
    failure = error;
  }
  try {
    const removal = await bdd.deleteGuildChannels(guildId);
    if (!removal.success) { throw new Error(removal.message); }
  } catch (error) {
    failure ??= error;
  }
  if (failure !== null) { throw failure; }
}

/**
 * Quand les serveurs à oublier sont plus nombreux que ce seuil **et** forment
 * la majorité des serveurs configurés, le rattrapage n'en oublie que ce nombre
 * par passage. Un effacement irréversible ne se fie pas entièrement à un cache
 * qui décrit peut-être un autre bot (jeton de développement lancé sur la base
 * de production) : le dégât est borné à quelques serveurs, signalé, et un
 * vrai arriéré se résorbe tout de même en quelques nuits.
 */
export const MAX_SILENT_GUILD_FORGETS = 3;

/**
 * Oublie les serveurs configurés en base que le bot n'a plus rejoints.
 *
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
  const configured = await bdd.listConfiguredGuildIds();
  const departed = configured.filter((id) => !joined.has(id));
  const suspicious = departed.length > MAX_SILENT_GUILD_FORGETS && departed.length * 2 > configured.length;
  if (suspicious) {
    await sendLog(
      client,
      `Rattrapage des serveurs quittés limité à ${MAX_SILENT_GUILD_FORGETS} : ${departed.length} serveur(s) ` +
        `sur ${configured.length} absents du cache. Vérifier le jeton du bot si ce nombre surprend.`,
    );
  }
  const batch = suspicious ? departed.slice(0, MAX_SILENT_GUILD_FORGETS) : departed;
  const forgotten: string[] = [];
  for (const guildId of batch) {
    try {
      await eraseGuild(guildId);
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
 * Les trois ménages, dans l'ordre. Chacun signale son propre échec sans priver
 * les autres de passer ; la fonction ne lève jamais.
 * @param client Client Discord connecté.
 */
export async function runDataRetention(client: Client): Promise<void> {
  try {
    await manageMsgExpiration(client);
  } catch (error) {
    await reportError(client, "manageMsgExpiration", error);
  }
  await anonymizeOldActivity(client);
  try {
    await forgetDepartedGuilds(client);
  } catch (error) {
    await reportError(client, "forgetDepartedGuilds", error);
  }
}
