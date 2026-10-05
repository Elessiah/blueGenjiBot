/**
 * Durées de conservation des données personnelles que le bot garde en base
 * (la purge des messages relayés elle-même vit dans
 * `messages/manageMsgExpiration.ts` ; ce module ne fait que la rattraper).
 *
 * Sept ménages, joués au démarrage, chaque nuit par la tâche `cron`
 * existante et après une restauration de la base — aucun ordonnanceur de plus :
 *
 * - **messages relayés** : la purge à 7 jours (`manageMsgExpiration`) n'était
 *   entraînée que par un nouveau relais ; une semaine sans relais la laissait
 *   dormir. La nuit la rattrape ;
 * - **scrims et recherches** : au-delà de `ACTIVITY_AUTHOR_RETENTION_DAYS`,
 *   repliés en nombres par jour, serveur et niveau (ou rôle), sans auteur —
 *   et, avant cela, leurs niveaux et rôles saisis en texte libre avant les
 *   choix fermés ramenés à ces choix ou à « non précisé »
 *   (`normalizeLegacyActivityDetails`, idempotent) ;
 * - **serveurs quittés pendant un arrêt** : Discord n'envoie `guildDelete` qu'à
 *   un bot connecté. Un serveur quitté pendant que le bot était arrêté — ou
 *   dont l'oubli a échoué à mi-chemin — garderait sinon sa configuration sans
 *   limite, alors que plus personne sur ce serveur ne peut la retirer ;
 * - **salons relayés supprimés pendant un arrêt** : même raison pour
 *   `channelDelete`. Le salon restait relayé en base et chaque relais vers lui
 *   échouait ;
 * - **fil d'activité** (`FeedEvent`) : au-delà de `FEED_EVENT_RETENTION_DAYS` ;
 * - **journal privé du staff** : au-delà de `STAFF_LOG_RETENTION_DAYS`, sauf
 *   les messages d'une exclusion en cours (`privacy/staffLogRetention.ts`) ;
 * - **copies de secours d'une restauration** : au-delà de
 *   `ROLLBACK_RETENTION_DAYS` (`backup/restoreDatabase.ts`).
 */

import { DiscordAPIError, type Client, type Guild } from "discord.js";
import { RESTJSONErrorCodes } from "discord-api-types/v10";

import { getBddInstance, type Bdd } from "../bdd/Bdd.js";
import { manageMsgExpiration } from "../messages/manageMsgExpiration.js";
import { reportError } from "../safe/processGuards.js";
import { sendLog } from "../safe/sendLog.js";

import { purgeOldRollbacks } from "../backup/restoreDatabase.js";
import { purgeOldFeedEvents } from "../feed/feedBus.js";
import { purgeStaffLogs } from "./staffLogRetention.js";
import { ACTIVITY_AUTHOR_RETENTION_DAYS, FEED_EVENT_RETENTION_DAYS } from "./retentionPeriods.js";

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
 * La base appartient-elle à l'application connectée (`BotOwner`) ?
 *
 * L'application (celle de `CLIENT_ID`), pas l'utilisateur du bot : sur une
 * application ancienne les deux identifiants diffèrent, et c'est celui de
 * l'application que l'exploitant reconnaît dans `BotOwner`. Sans elle, rien :
 * revendiquer la base avec l'identifiant de l'utilisateur la fermerait ensuite
 * à l'application elle-même.
 * @param client Client Discord.
 * @returns `true`/`false`, ou `null` quand rien ne peut être conclu.
 */
async function ownsDatabase(client: Client): Promise<boolean | null> {
  const applicationId = client.application?.id;
  if (!applicationId) { return null; }
  return (await getBddInstance()).claimOwnerApplication(applicationId);
}

/**
 * `guildDelete` : efface un serveur quitté, **si** la base appartient à
 * l'application connectée. Un bot lancé avec un autre jeton sur cette base
 * (développement) et retiré d'un serveur où le bot de production reste
 * effacerait sinon la configuration de ce dernier : les tables sont indexées
 * par serveur, pas par application.
 * @param client Client Discord.
 * @param guildId Serveur quitté.
 * @returns `true` si le serveur a été effacé, `false` si la garde l'a empêché.
 * @throws Comme `eraseGuild`.
 */
export async function eraseLeftGuild(client: Client, guildId: string): Promise<boolean> {
  if ((await ownsDatabase(client)) !== true) { return false; }
  await eraseGuild(guildId);
  return true;
}

/**
 * Oublie les serveurs configurés en base que le bot n'a plus rejoints.
 *
 * Le cache ne perd un serveur que sur `guildDelete` : un retrait survenu
 * pendant une coupure du gateway qui n'a pas pu reprendre sa session reste
 * au cache jusqu'au redémarrage — d'où la promesse « au redémarrage suivant »
 * des textes, la passe de nuit n'étant qu'un rattrapage de plus.
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
  // Un processus par shard ne voit que ses serveurs : il prendrait ceux des
  // autres pour quittés. Le bot ne se partitionne pas ; s'il le fait un jour,
  // le rattrapage se tait plutôt que d'effacer la moitié du réseau.
  if ((client.shard?.count ?? 1) > 1) { return null; }
  const bdd = await getBddInstance();
  const owned = await ownsDatabase(client);
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
      // Le serveur nommé : un échec qui se répète chaque nuit doit dire lequel.
      await reportError(client, `forgetDepartedGuilds (serveur ${guildId})`, error);
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
 * Discord a-t-il dit que ce salon **n'existe plus** ?
 *
 * Seul `UnknownChannel` autorise l'effacement : un accès retiré (`MissingAccess`),
 * une limite de débit ou une coupure réseau lèvent aussi, et ne disent rien de
 * l'existence du salon — dans le doute, la ligne reste.
 * @param client Client Discord connecté.
 * @param channelId Salon absent du cache.
 * @returns `true` seulement sur un refus explicite « salon inconnu ».
 */
async function channelIsGone(client: Client, channelId: string): Promise<boolean> {
  try {
    await client.channels.fetch(channelId);
    return false;
  } catch (error) {
    return error instanceof DiscordAPIError && Number(error.code) === RESTJSONErrorCodes.UnknownChannel;
  }
}

/**
 * Retire les salons relayés des serveurs **rejoints** que Discord ne connaît
 * plus : supprimés pendant que le bot était arrêté, ils n'ont déclenché aucun
 * `channelDelete`. Les serveurs quittés relèvent de `forgetDepartedGuilds`.
 *
 * Mêmes gardes que lui : client prêt (c'est `clientReady` qui remplit les
 * caches de salons) et base appartenant à l'application connectée. Un serveur
 * marqué indisponible est sauté (son cache de salons ne le décrit pas), et un
 * salon absent du cache n'est effacé qu'après une relecture chez Discord qui
 * répond « salon inconnu » (`channelIsGone`) — le cache ne garde pas les fils
 * archivés, et toute autre erreur laisse la ligne en place.
 * @param client Client Discord connecté.
 * @returns Identifiants des salons retirés, ou `null` si le rattrapage n'a pas
 *          été joué (client pas prêt, application inconnue, autre application).
 */
export async function forgetDeletedChannels(client: Client): Promise<string[] | null> {
  if (!client.isReady()) { return null; }
  if ((await ownsDatabase(client)) !== true) { return null; }
  const bdd = await getBddInstance();
  const removed: string[] = [];
  for (const guild of client.guilds.cache.values()) {
    if (!guild.available) { continue; }
    removed.push(...await forgetGuildDeletedChannels(client, bdd, guild));
  }
  if (removed.length > 0) {
    await sendLog(client, `${removed.length} salon(s) relayé(s) supprimé(s) pendant un arrêt : retiré(s) de la base.`);
  }
  return removed;
}

/**
 * Retire les salons relayés d'un serveur rejoint que Discord ne connaît plus
 * (voir `forgetDeletedChannels`). Un retrait en échec est journalisé.
 * @param client Client Discord connecté.
 * @param bdd Base du bot.
 * @param guild Serveur disponible.
 * @returns Identifiants des salons retirés.
 */
async function forgetGuildDeletedChannels(client: Client, bdd: Bdd, guild: Guild): Promise<string[]> {
  const rows = await bdd.get(
    "ChannelPartner",
    ["id_channel"],
    {},
    { query: "id_guild = ? AND id_channel IS NOT NULL", values: [guild.id] },
  ) as { id_channel: string }[];
  const removed: string[] = [];
  for (const { id_channel: channelId } of rows) {
    if (guild.channels.cache.has(channelId)) { continue; }
    if (!(await channelIsGone(client, channelId))) { continue; }
    // `deleteChannel` ne lève pas : son échec se lit sur `success`.
    const ret = await bdd.deleteChannel(channelId);
    if (ret.success) {
      removed.push(channelId);
    } else {
      await sendLog(client, `forgetDeletedChannels: retrait du salon ${channelId} échoué : ${ret.message}`);
    }
  }
  return removed;
}

/**
 * Les sept ménages, dans l'ordre. Chacun signale son propre échec sans priver
 * les autres de passer ; la fonction ne lève jamais.
 * @param client Client Discord connecté.
 */
export function runDataRetention(client: Client): Promise<void> {
  // Une passe à la fois : démarrage, nuit et restauration peuvent se croiser.
  // Un appel pendant une passe la rejoint, puis en relance une (la
  // restauration a pu ramener des lignes que la passe en cours a déjà lues).
  if (running) {
    rerunRequested = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        rerunRequested = false;
        await runDataRetentionOnce(client);
      } while (rerunRequested);
    } finally {
      running = null;
    }
  })();
  return running;
}

let running: Promise<void> | null = null;
let rerunRequested = false;

/**
 * Une passe des sept ménages (voir `runDataRetention`).
 * @param client Client Discord connecté.
 */
async function runDataRetentionOnce(client: Client): Promise<void> {
  let relays = "échec";
  try {
    await manageMsgExpiration(client);
    relays = "jouée";
  } catch (error) {
    await reportError(client, "manageMsgExpiration", error);
  }
  // Avant le repli : les lignes repliées cette nuit le sont déjà ramenées.
  let legacy = "échec";
  try {
    legacy = String(await (await getBddInstance()).normalizeLegacyActivityDetails());
  } catch (error) {
    await reportError(client, "normalizeLegacyActivityDetails", error);
  }
  const anonymized = await anonymizeOldActivity(client);
  let forgotten: string = "échec";
  try {
    const result = await forgetDepartedGuilds(client);
    forgotten = result === null ? "non joué" : String(result.length);
  } catch (error) {
    await reportError(client, "forgetDepartedGuilds", error);
  }
  let channels: string = "échec";
  try {
    const result = await forgetDeletedChannels(client);
    channels = result === null ? "non joué" : String(result.length);
  } catch (error) {
    await reportError(client, "forgetDeletedChannels", error);
  }
  let feed: string = "échec";
  try {
    feed = String(await purgeOldFeedEvents(FEED_EVENT_RETENTION_DAYS));
  } catch (error) {
    await reportError(client, "purgeOldFeedEvents", error);
  }
  let staffLogs: string = "échec";
  try {
    const result = await purgeStaffLogs(client);
    staffLogs = result === null ? "non joué" : String(result);
  } catch (error) {
    await reportError(client, "purgeStaffLogs", error);
  }
  // Ne lève jamais.
  const rollbacks = await purgeOldRollbacks();
  // Une ligne par passage dans les journaux du serveur (pm2) : une nuit à
  // zéro se distingue ainsi d'un ménage qui n'a pas tourné. Aucun identifiant.
  console.log(
    `[data-retention] purge des relais : ${relays}, textes libres ramenés aux choix : ${legacy}, auteurs anonymisés : ${anonymized ?? "échec"}, ` +
      `serveurs oubliés : ${forgotten}, salons retirés : ${channels}, évènements du fil purgés : ${feed}, ` +
      `messages du journal du staff purgés : ${staffLogs}, copies de restauration purgées : ${rollbacks}`,
  );
}
