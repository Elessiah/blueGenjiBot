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

import { ACTIVITY_AUTHOR_RETENTION_DAYS } from "@/privacy/retentionPeriods.js";

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
  // Deux étapes indépendantes (l'ordre n'importe pas) : chacune est tentée
  // même si l'autre échoue.
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
 * Oublie les serveurs configurés en base que le bot n'a plus rejoints.
 *
 * Deux gardes avant tout effacement, irréversible : le client doit être prêt
 * (avant `clientReady`, Discord n'a encore livré aucun serveur et le cache
 * vide effacerait la configuration de tous ; prêt, un cache vide veut bien
 * dire que le bot n'est plus sur aucun serveur), et la base doit appartenir à l'application connectée
 * (`claimOwnerApplication`) — un bot lancé avec un autre jeton sur cette base,
 * un bot de développement par exemple, a un cache qui ne la décrit pas. Un serveur
 * momentanément indisponible (panne Discord) reste dans le cache, marqué
 * `available: false` : il n'est donc pas oublié.
 * @param client Client Discord connecté (`client.guilds.cache` rempli).
 * @returns Identifiants des serveurs oubliés, ou `null` si le rattrapage n'a
 *          pas été joué (client pas prêt, application inconnue, base fermée ou
 *          appartenant à une autre application) — à distinguer d'une passe
 *          qui n'a rien trouvé.
 */
export async function forgetDepartedGuilds(client: Client): Promise<string[] | null> {
  const joined = client.guilds.cache;
  if (!client.isReady()) { return null; }
  // L'application (celle de `CLIENT_ID`), pas l'utilisateur du bot : sur une
  // application ancienne les deux identifiants diffèrent, et c'est celui de
  // l'application que l'exploitant reconnaît dans `BotOwner`.
  // Sans elle, rien : revendiquer la base avec l'identifiant de l'utilisateur
  // la fermerait ensuite à l'application elle-même.
  const applicationId = client.application?.id;
  if (!applicationId) { return null; }
  const bdd = await getBddInstance();
  const owned = await bdd.claimOwnerApplication(applicationId);
  if (owned === null) { return null; }
  if (!owned) {
    await sendLog(
      client,
      "Rattrapage des serveurs quittés ignoré : cette base appartient à une autre application Discord " +
        "(si le bot a changé d'application, vider la table BotOwner).",
    );
    return null;
  }
  const departed = (await bdd.listConfiguredGuildIds()).filter((id) => !joined.has(id));
  const forgotten: string[] = [];
  for (const guildId of departed) {
    // Relu avant chaque effacement : entre la liste et ici, des `await` ont
    // pu laisser le bot être réinvité sur ce serveur (et y être reconfiguré).
    if (client.guilds.cache.has(guildId)) { continue; }
    try {
      await eraseGuild(guildId);
      forgotten.push(guildId);
    } catch (error) {
      await reportError(client, "forgetDepartedGuilds", error);
    }
  }
  if (forgotten.length > 0) {
    // Pas « pendant un arrêt » : après une restauration, ce sont aussi des
    // serveurs quittés depuis longtemps, que la sauvegarde avait ramenés.
    await sendLog(client, `${forgotten.length} serveur(s) que le bot ne rejoint plus : configuration effacée.`);
  }
  return forgotten;
}

/**
 * Les trois ménages, dans l'ordre. Chacun signale son propre échec sans priver
 * les autres de passer ; la fonction ne lève jamais.
 * @param client Client Discord connecté.
 */
export async function runDataRetention(client: Client): Promise<void> {
  let relays = "échec";
  try {
    // Base fermée : `Bdd.rm` n'y ferait rien sans le dire.
    if (!(await getBddInstance()).isOpen()) { throw new Error("Base fermée : purge des relais non jouée."); }
    await manageMsgExpiration(client);
    relays = "jouée";
  } catch (error) {
    await reportError(client, "manageMsgExpiration", error);
  }
  const anonymized = await anonymizeOldActivity(client);
  let forgotten: string = "échec";
  try {
    const result = await forgetDepartedGuilds(client);
    forgotten = result === null ? "non joué" : String(result.length);
  } catch (error) {
    await reportError(client, "forgetDepartedGuilds", error);
  }
  // Une ligne par passage dans les journaux du serveur (pm2) : une nuit à
  // zéro se distingue ainsi d'un ménage qui n'a pas tourné. Aucun identifiant.
  console.log(
    `[data-retention] purge des relais : ${relays}, auteurs anonymisés : ${anonymized ?? "échec"}, ` +
      `serveurs oubliés : ${forgotten}`,
  );
}
