import fs from 'node:fs';
import path from 'node:path';
import {open} from 'sqlite';
import type {Database} from 'sqlite';
import sqlite3 from 'sqlite3';

import type {status, Query} from "../types.js";
import {ranks, services} from '../utils/globals.js';
import {toSQLiteDate} from '../utils/toSQLiteDatetime.js';
import {RECRUIT_ROLE_CHOICES, SCRIM_LEVEL_CHOICES, normalizeLegacyChoice} from '../config/searchChoices.js';
import {
    ACTIVITY_DAILY_TABLE,
    ADHESION_INTERVAL_TABLE,
    BAN_TABLE,
    BOT_OWNER_TABLE,
    BUSY_TIMEOUT_PRAGMA,
    CHANNEL_PARTNER_RANK_TABLE,
    CHANNEL_PARTNER_SERVICE_TABLE,
    CHANNEL_PARTNER_TABLE,
    DAILY_SNAPSHOT_TABLE,
    DPMSG_TABLE,
    DROP_USER_LINK,
    FEED_EVENT_TABLE,
    MESSAGE_SERVICE_TABLE,
    OGMSG_TABLE,
    PURGE_RETIRED_MODULES,
    RANKS_TABLE,
    RECRUTE_TABLE,
    REFEREE_ROLE_TABLE,
    ROLE_ADMIN_TABLE,
    SCRIM_TABLE,
    SECURE_DELETE_PRAGMA,
    SERVER_INVITE_TABLE,
    SERVER_MODULE_TABLE,
    SERVICE_TABLE,
    SITE_VISIT_TABLE,
} from './schema.js';

import type {
    Ranks,
    Service,
    ChannelPartner,
    ChannelPartnerService,
    joinOptions,
    whereConditions,
    ChannelPartnerRank,
    ServerInvite,
    RefereeRole
} from "./types.js";

let bdd: Bdd;

/**
 * Étape du schéma : libellé de la ligne d'erreur, instruction SQL seule ou
 * fonction qui en enchaîne plusieurs, réglages de la ligne d'erreur.
 */
type SchemaStep = readonly [label: string, step: string | (() => Promise<void>), options?: {withFullError?: boolean}];

/**
 * Emplacement de la base, quand `BDD_PATH` n'est pas défini.
 *
 * `./database.sqlite` — l'ancien repli — était relatif au **répertoire courant**,
 * et SQLite crée un fichier vide quand il ne le trouve pas. Un `.env` non lu, un
 * service lancé d'ailleurs, et le bot repartait sur une base neuve en signalant
 * simplement qu'il n'avait plus rien : c'est ainsi qu'un second fichier a vécu
 * des mois à la racine du projet, pendant que la vraie base était dans `data/`.
 * Le repli désigne donc **le même dossier que la configuration réelle**, celui
 * que la sauvegarde emporte.
 */
const DEFAULT_BDD_PATH = './data/database.sqlite';

/**
 * Chemin absolu de la base que le bot ouvre : `BDD_PATH`, sinon le repli.
 * Partagé avec la restauration et sa purge des copies de secours, qui
 * viseraient sinon un autre fichier que la base réelle.
 * @returns Le chemin absolu de la base.
 */
function resolveBddPath(): string {
  const configured = process.env.BDD_PATH?.trim();
  return path.resolve(configured && configured.length > 0 ? configured : DEFAULT_BDD_PATH);
}

/**
 * Retourne l'instance singleton de la base de données.
 * Crée et initialise la connexion SQLite si nécessaire.
 *
 * Le chemin **absolu** est journalisé à l'ouverture. Une ligne, et la question
 * « quelle base le bot lit-il au juste ? » cesse de se poser : elle a demandé un
 * `lsof` sur la production pour être tranchée.
 *
 * @returns Instance Bdd prête à être utilisée.
 */
async function getBddInstance(): Promise<Bdd> {
  if (!bdd) {
    const configured = process.env.BDD_PATH?.trim();
    const absolute = resolveBddPath();
    if (!fs.existsSync(absolute)) {
      // Pas un refus : une première installation doit pouvoir démarrer. Mais on
      // le **dit**, parce que c'est indiscernable d'une base perdue.
      console.warn(`[bdd] Aucun fichier à ${absolute} — création d'une base vide.`);
    }
    console.log(`[bdd] Base ouverte : ${absolute}${configured ? '' : ' (BDD_PATH non défini)'}`);
    bdd = await Bdd.create(absolute);
  }
  return bdd;
}

/**
 * Ferme l'instance singleton courante si elle existe, et attend que SQLite
 * relâche le fichier.
 *
 * La référence reste en place : un appel tardif (arrêt du bot en cours) reçoit
 * l'instance fermée et échoue, au lieu de rouvrir une connexion que
 * `process.exit` couperait.
 * @returns `true` si une instance était ouverte, sinon `false`.
 */
async function closeBddInstance(): Promise<boolean> {
  if (!bdd) {
    return false;
  }
  await bdd.close();
  return true;
}

/**
 * Ferme la connexion courante et oublie le singleton.
 *
 * `closeBddInstance()` laisse la référence en place : le prochain
 * `getBddInstance()` rendrait une instance fermée. La restauration d'une
 * sauvegarde a besoin d'en rouvrir une, d'où ce variant.
 * @returns `true` si une instance était ouverte, sinon `false`.
 */
async function resetBddInstance(): Promise<boolean> {
  if (!bdd) {
    return false;
  }
  const previous = bdd;
  bdd = undefined as unknown as Bdd;
  await previous.close();
  return true;
}

/**
 * Tables de **configuration** d'un serveur, avec leur colonne d'identifiant de
 * serveur : ce que `forgetGuild` efface et ce que `listConfiguredGuildIds`
 * relit. Une seule liste pour les deux — tenues à la main, elles divergeraient,
 * et un serveur figurant dans l'une seulement serait « oublié » chaque nuit sans
 * rien perdre, ou gardé sans limite. Les noms sont interpolés dans le SQL :
 * ce sont des constantes, vérifiées une fois au chargement du module (une
 * faute de frappe fait échouer le démarrage et les tests, pas un départ de
 * serveur).
 */
const GUILD_CONFIG_TABLES: readonly (readonly [string, string])[] = [
  ["ServerInvite", "id_guild"],
  ["RefereeRole", "id_guild"],
  ["RoleAdmin", "guild_id"],
  ["ServerModule", "id_guild"],
  ["AdhesionInterval", "guild_id"],
];

/**
 * Refuse tout nom de table ou de colonne qui ne soit pas un identifiant nu :
 * garde-fou des rares requêtes qui interpolent un nom (les valeurs, elles,
 * restent toujours bindées).
 * @param name Nom à vérifier.
 * @returns Le nom, inchangé.
 * @throws Si le nom contient autre chose que lettres, chiffres et `_`.
 */
function assertSqlIdentifier(name: string): string {
  if (!/^[A-Za-z_]\w*$/.test(name)) {
    throw new Error(`Identifiant SQL refusé : ${name}`);
  }
  return name;
}

/** Salons relayés : lus par le rattrapage, retirés par `deleteGuildChannels`. */
const GUILD_CHANNEL_TABLE = ["ChannelPartner", "id_guild"] as const;

for (const [table, column] of [...GUILD_CONFIG_TABLES, GUILD_CHANNEL_TABLE]) {
  assertSqlIdentifier(table);
  assertSqlIdentifier(column);
}

/**
 * Tous les serveurs dont la base garde une configuration, bâti une fois à côté
 * de la vérification des noms qu'il interpole. Filtré après l'union : une clé
 * primaire `TEXT` admet `NULL` en SQLite, et `String(null)` ferait oublier
 * chaque nuit un serveur nommé "null".
 */
const CONFIGURED_GUILDS_SQL =
  "SELECT id FROM (" +
  [GUILD_CHANNEL_TABLE, ...GUILD_CONFIG_TABLES]
    .map(([table, column]) => `SELECT ${column} AS id FROM ${table}`)
    .join(" UNION ") +
  ") WHERE id IS NOT NULL AND id <> ''";

class Bdd {
    private readonly name: string;
    private Database: Database | null;

  /**
   * Initialise l'instance avec le chemin du fichier SQLite.
   * @param name Chemin de la base SQLite.
   */
  constructor(name = './database.sqlite') {
    this.name = name;
    this.Database = null;
  }

  /**
   * Crée une instance Bdd puis Exécute son initialisation SQL.
   * @param name Chemin de la base SQLite.
   * @returns Instance Bdd initialisée.
   */
  static async create(name = './database.sqlite'): Promise<Bdd> {
    const instance = new Bdd(name);
    await instance.init();
    return instance;
  }

  /**
   * Ferme la connexion SQLite associée à cette instance, sans attendre.
   */
  delete(): void {
    void this.close();
  }

  /**
   * Ferme la connexion SQLite et attend que le fichier soit relâché.
   *
   * `delete()` jette la promesse de fermeture : SQLite finalise ses requêtes et
   * checkpointe le WAL en arrière-plan, si bien que le fichier reste écrit
   * quelques instants après le retour. Toute opération qui remplace le fichier
   * — la restauration d'une sauvegarde — doit attendre ici.
   */
  async close(): Promise<void> {
    const database = this.Database;
    this.Database = null;
    await database?.close();
  }

  /**
   * Écrit un snapshot cohérent de la base dans un fichier séparé via `VACUUM INTO`.
   * Garantit une copie non corrompue même si des écritures sont en cours.
   * @param destPath Chemin du fichier de sauvegarde (écrasé s'il existe déjà).
   */
  async backupTo(destPath: string): Promise<void> {
    if (fs.existsSync(destPath)) {
      fs.unlinkSync(destPath);
    }
    await this.Database?.exec(`VACUUM INTO '${destPath.replaceAll("'", "''")}'`);
  }

  /**
   * Ouvre la connexion SQLite puis initialise/met à jour le schéma.
   */
  async init(): Promise<void> {
    this.Database = await open({
      filename: this.name,
      driver: sqlite3.Database,
    });
    await this.initDatabase();
  }

  /**
   * Joue une étape du schéma. Un échec est écrit sur la console sous `label`
   * et n'empêche pas les étapes suivantes : une table en défaut ne doit pas
   * priver le bot de toutes les autres.
   * @param label Préfixe de la ligne d'erreur.
   * @param step Étape à jouer.
   * @param options Réglages de la ligne d'erreur.
   * @param options.withFullError Ajoute l'erreur entière à la ligne, après son message.
   */
  private async schemaStep(label: string, step: () => Promise<void>, options: {withFullError?: boolean} = {}): Promise<void> {
    try {
      await step();
    } catch (e) {
      if (options.withFullError) {
        console.error(label, (e as TypeError).message, e);
      } else {
        console.error(label, (e as TypeError).message);
      }
    }
  }

  /**
   * Étapes du schéma, dans l'ordre où elles sont jouées : un libellé (préfixe
   * de la ligne d'erreur, voir `schemaStep`), puis une instruction SQL seule
   * ou une étape qui en enchaîne plusieurs (migration, semis).
   * @returns La liste des étapes, liées à cette instance.
   */
  private schemaSteps(): SchemaStep[] {
    return [
      ["secure_delete error: ", SECURE_DELETE_PRAGMA],
      ["busy_timeout error: ", BUSY_TIMEOUT_PRAGMA],
      ["OGMsg :", OGMSG_TABLE],
      ["MessageService : ", MESSAGE_SERVICE_TABLE],
      ["DPMsg : ", DPMSG_TABLE],
      ["ChannelPartner : ", () => this.createChannelPartner()],
      ["Service&Co", () => this.createServices(), {withFullError: true}],
      ["ChannelPartnerService : ", CHANNEL_PARTNER_SERVICE_TABLE],
      ["Ban : ", () => this.createBan()],
      ["Error rank filter : ", () => this.createRanks()],
      ["ChannelPartnerRank: ", CHANNEL_PARTNER_RANK_TABLE],
      ["AdhesionInterval error: ", ADHESION_INTERVAL_TABLE],
      ["RoleAdmin error: ", ROLE_ADMIN_TABLE],
      ["ServerModule error: ", SERVER_MODULE_TABLE],
      ["FeedEvent error: ", FEED_EVENT_TABLE],
      ["DailySnapshot error: ", DAILY_SNAPSHOT_TABLE],
      ["Scrim error: ", SCRIM_TABLE],
      ["Recrute error: ", RECRUTE_TABLE],
      ["UserLink error: ", DROP_USER_LINK],
      ["ServerModule oauth cleanup error: ", PURGE_RETIRED_MODULES],
      ["ServerInvite error: ", SERVER_INVITE_TABLE],
      ["RefereeRole error: ", REFEREE_ROLE_TABLE],
      ["SiteVisit error: ", SITE_VISIT_TABLE],
      ["ActivityDaily error: ", ACTIVITY_DAILY_TABLE],
      ["BotOwner error: ", BOT_OWNER_TABLE],
    ];
  }

  /**
   * Crée les tables nécessaires et injecte les données statiques manquantes.
   * Chaque étape est indépendante (voir `schemaStep`).
   */
  async initDatabase(): Promise<void> {
    for (const [label, step, options] of this.schemaSteps()) {
      const run = typeof step === "string"
        ? async () => { await this.Database?.exec(step); }
        : step;
      await this.schemaStep(label, run, options);
    }
  }

  /**
   * Table `ChannelPartner`, et sa colonne `region` sur une base antérieure.
   */
  private async createChannelPartner(): Promise<void> {
    await this.Database?.exec(CHANNEL_PARTNER_TABLE);
    await this.Database?.exec(`
        PRAGMA table_info(ChannelPartner);
      `);

    const columnExists = await this.Database?.get(`
        SELECT 1
        FROM pragma_table_info('ChannelPartner')
        WHERE name = 'region'
      `);

    if (!columnExists) {
      await this.Database?.exec(`
          ALTER TABLE ChannelPartner
            ADD COLUMN region INTEGER DEFAULT 0 CHECK (region BETWEEN 0 AND 5);
        `);
    }
  }

  /**
   * Table `Service`, puis chaque service de `services` qui n'y est pas encore.
   */
  private async createServices(): Promise<void> {
    await this.Database?.exec(SERVICE_TABLE);

    for (const service of services) {
      const ret: Service[] = await this.get("Service", ["*"], {}, {query: "name = ?", values: [service]}) as Service[];
      if (ret.length > 0) {
        continue;
      }
      console.log(
          `Adding "${service}" to the database...`
      );
      await this.Database?.run('INSERT INTO Service (name) VALUES (?)', [service], function (err: TypeError) {
        if (err) {
          console.error(`Error while adding "${service}":`, err.message);
        } else {
          console.log(`Successfully added "${service}".`);
        }
      });
    }
  }

  /**
   * Table `Ban`, et ses colonnes de messages du journal sur une base antérieure.
   */
  private async createBan(): Promise<void> {
    await this.Database?.exec(BAN_TABLE);
    // Messages du journal qui décrivent l'exclusion, effacés à sa levée
    // (`/unban`) : le motif en message privé au propriétaire, et l'avis
    // « un joueur a été exclu » au salon. `NULL` pour une exclusion
    // antérieure à ces colonnes — seul son motif au salon (`id_reason`)
    // peut alors être effacé.
    for (const column of ["id_reason_owner", "id_notice_admin"]) {
      const exists = await this.Database?.get(
        "SELECT 1 FROM pragma_table_info('Ban') WHERE name = ?",
        [column],
      );
      if (!exists) {
        await this.Database?.exec(`ALTER TABLE Ban ADD COLUMN ${column} TEXT`);
      }
    }
  }

  /**
   * Table `Ranks`, puis chaque rang de `ranks` qui n'y est pas encore.
   */
  private async createRanks(): Promise<void> {
    await this.Database?.exec(RANKS_TABLE);
    for (const rank of ranks) {
      const ret: Ranks[] = await this.get('Ranks', ["*"], {}, {query: "name = ?", values: [rank]}) as Ranks[];
      if (ret.length > 0)
        {continue;}
      console.log(`Adding "${rank}" to the database...`);
      await this.Database?.run("INSERT INTO Ranks (name) VALUES (?)", [rank]);
    }
  }


    /**
     * insère une ligne dans la table cible.
     * @param tableName Nom de la table.
     * @param elemName Colonnes à renseigner.
     * @param value Valeurs à insérer dans le même ordre que `elemName`.
     * @returns Objet `status` (`success=true` si insertion réussie, sinon `success=false` avec message SQL).
     */
    async set(tableName: string,
            elemName: unknown[],
            value: unknown[]) : Promise<status> {
    // console.log("set", tableName, elemName, value);
    if (elemName.length !== value.length) {
      return {success: false, message: "ElemName and value must be the same length."};
    }
    const names = "(" + elemName.join(", ") + ")";
    const strValues = "(" + value.map(v => (v === null || v === undefined) ? "NULL" : "?").join(", ") + ")";
    const query = `INSERT INTO ${tableName} ${names} VALUES ${strValues}`;
    try {
      await this.Database?.run(query, value.filter(v => v !== null && v !== undefined));
    } catch (e) {
      return {success: false, message: `Error while adding "${tableName}": ${(e as TypeError).message}`};
    }
    return {success: true, message: "Successfully added "};
  }

  /**
   * Met à jour des lignes dans une table selon une clause `WHERE`.
   * @param tableName Nom de la table.
   * @param update Paires colonne/valeur à modifier.
   * @param where Paires colonne/valeur de filtrage.
   */
  async update(tableName: string,
               update: Record<string, unknown>,
               where: Record<string, unknown>) : Promise<void> {
    const query_values: unknown[] = [];
    let query = `UPDATE ${tableName}
                 SET `;
    const set: string[] = [];
    for (const [column, value] of Object.entries(update)) {
      set.push(`${column} = ?`);
      query_values.push(value);
    }
    query += set.join(", ");

    query += ' WHERE ';
    const conditions: string[] = [];
    for (const [column, value] of Object.entries(where)) {
      conditions.push(`${column} = ?`);
      query_values.push(value);
    }
    query += conditions.join(' AND ');
    await this.Database?.run(query, query_values);
  }

  /**
   * Lit des lignes avec options de JOIN, WHERE et ORDER BY.
   * @param tableName Table principale.
   * @param values Colonnes à retourner (`*` par défaut).
   * @param joinOptions Jointures SQL à appliquer.
   * @param whereConditions Clause `WHERE` paramétrée.
   * @param is_ascending Sens du tri (`true` ASC, `false` DESC).
   * @param index_elem Colonne de tri pour `ORDER BY`.
   * @returns Tableau typé des lignes correspondant à la requête (tableau vide si aucun résultat).
   */
  async get(tableName: string,
            values: string[] = ["*"],
            joinOptions?: joinOptions,
            whereConditions?: whereConditions,
            is_ascending?: boolean,
            index_elem?: string): Promise<unknown[]> {
      const stringValues: string = values.join(", ");
      const baseQuery = `SELECT ${stringValues} FROM ${tableName}`;
      const query: Query = (await this.queryBuilder(baseQuery, joinOptions, whereConditions, is_ascending, index_elem));
      return this.Database!.all(query.query, query.ret_array);
  }

  /**
   * Supprime des lignes d'une table selon les filtres fournis.
   * @param tableName Table principale.
   * @param joinOptions Jointures éventuelles.
   * @param whereConditions Clause `WHERE` paramétrée.
   */
  async rm(tableName: string,
           joinOptions?: joinOptions,
           whereConditions?: whereConditions): Promise<void> {
    const baseQuery = `DELETE FROM ${tableName} `;
    const query: Query = (await this.queryBuilder(baseQuery, joinOptions, whereConditions));
    await this.Database?.run(query.query, query.ret_array);
  }

  /**
   * Construit la requête SQL finale et sa liste de paramètres.
   * @param baseQuery Base de requête (`SELECT ...` ou `DELETE ...`).
   * @param joinOptions Jointures SQL à ajouter.
   * @param whereConditions Clause `WHERE` et ses valeurs.
   * @param is_ascending Sens de tri pour `ORDER BY`.
   * @param index_elem Colonne utilisée pour le tri.
   * @returns Objet contenant `query` (SQL final) et `ret_array` (valeurs bindées), prêt à être exécuté.
   */
  async queryBuilder(baseQuery: string,
                     joinOptions?: joinOptions,
                     whereConditions?: whereConditions,
                     is_ascending?: boolean,
                     index_elem?: string): Promise<Query> {
    let joinClause: string = '';
    let whereClause: string = '';
    let orderClause: string = '';
    const ret: unknown[] = [];

    // Handle JOIN ON clauses
    if (joinOptions && Object.keys(joinOptions).length > 0) {
      for (const [joinTable, onCondition] of Object.entries(joinOptions)) {
        joinClause += ` JOIN ${joinTable} ON ${onCondition}`;
      }
    }

    // Handle WHERE conditions
      if (whereConditions) {
          whereClause = " WHERE " + whereConditions.query;
          ret.push(...whereConditions.values);
      }

    if (index_elem && index_elem.length > 0) {
      orderClause += ` ORDER BY ${index_elem}`;
      if (is_ascending === true) {
        orderClause += ' ASC';
      } else if (is_ascending === false) {
        orderClause += ' DESC';
      } else {
        orderClause = "";
      }
    }

    const query = `${baseQuery}${joinClause}${whereClause}${orderClause}`;
    const ret_array = Object.values(ret);
    return ({ ret_array: ret_array, query: query });
  }

  /**
   * Associe un salon partenaire à un service et à une région.
   * Crée le salon si nécessaire puis enregistre le lien service.
   * @param id_channel Identifiant du salon.
   * @param id_guild Identifiant du serveur.
   * @param service_name Nom du service à associer.
   * @param region Code région à stocker.
   * @returns Objet `status` indiquant succès/échec de l'association, avec message explicite en cas d'erreur.
   */
  async setNewPartnerChannel(id_channel: string,
                             id_guild: string,
                             service_name: string,
                             region: number): Promise<status> {
    try {
      const channelPartners: ChannelPartner[] = await this.get("ChannelPartner", ["*"], {}, {query: "id_channel = ?", values: [id_channel]}) as ChannelPartner[];
      if (channelPartners.length === 0) {
        const ret = await this.set("ChannelPartner", ["id_channel", "id_guild", "region"], [id_channel, id_guild, region]);
        if (!(ret.success))
          {return ret;}
      }
      const ret_service = await this.get("Service", ["*"], {}, {query: "name = ?", values: [service_name]}) as Service[];
      const id_service = ret_service[0].id_service;
      const channelPartnersServices: ChannelPartnerService[] = await this.get("ChannelPartnerService", ["*"], {}, {query: "id_channel = ? AND id_service = ?", values: [id_channel, id_service]}) as ChannelPartnerService[];
      if (channelPartnersServices.length > 0)
        {return {success: false, message: `Channel is already linked to "${service_name}".`};}
      await this.set("ChannelPartnerService", ["id_channel", "id_service"], [id_channel, id_service]);
      return {success: true, message: 'AllWentFine'};
    } catch (err) {
      return {success: false, message: "I have encountered an error. Please contact elessiah\n" + (err as TypeError).message};
    }
  }

  /**
   * Retire tous les services d'un salon puis supprime le salon partenaire.
   * @param channel_id Identifiant du salon.
   * @returns Objet `status` indiquant si la dissociation/suppression du salon partenaire a réussi.
   */
  async deleteChannelServices(channel_id: string): Promise<status> {
    try {
      const channelPartners: ChannelPartner[] = await this.get("ChannelPartner", ["*"], {}, {query: "id_channel = ?", values: [channel_id]}) as ChannelPartner[];
      if (!channelPartners)
          {return {success: false, message: "Channel has no services to delete."};}
      let query: string = `DELETE
                   FROM ChannelPartnerService
                   WHERE id_channel = ?`;
      await this.Database?.run(query, [channel_id]);
      query = `DELETE
               FROM ChannelPartner
               WHERE id_channel = ?`;
      await this.Database?.run(query, [channel_id]);
      return {success: true, message: 'Services deleted.'};
    } catch (err) {
      console.error(`Erreur deleting channel service : ${(err as TypeError).message}`);
      return {success: false, message: 'Failed to delete channel services.'};
    }
  }

  /**
   * Supprime une table SQL.
   * @param table_name Nom de la table à supprimer.
   * @returns Objet `status` avec `success=true` si la table est supprimée, sinon `success=false` et message d'erreur.
   */
  async dropTable(table_name: string): Promise<status> {
    try {
      await this.Database?.run(`drop table ${table_name}`);
      return {success: true, message: 'Table dropped successfully.'};
    } catch (err) {
      return {success: false, message: 'Failed to drop table ' + table_name + '\nError: ' + (err as TypeError).message};
    }
  }

  /**
   * Récupère l'horodatage courant retourné par SQLite.
   *
   * **Attention : la `Date` rendue n'est pas l'instant courant.**
   * `CURRENT_TIMESTAMP` est une chaîne `YYYY-MM-DD HH:MM:SS` en **UTC**, et
   * `new Date()` relit cette forme-là dans le fuseau **de la machine** : la
   * valeur rendue est donc en retard du décalage local (deux heures à Paris en
   * été, une en hiver).
   *
   * Ce décalage est **volontairement conservé**, parce que le seul appelant
   * restant s'en sert bien. `checkCooldown` relit la colonne `date` d'une ligne
   * exactement de la même façon : les deux côtés sont décalés du même nombre
   * d'heures, et leur **différence** est juste. Corriger cette fonction seule
   * rendrait un instant vrai face à une date fausse, et le cooldown de deux
   * heures ne s'appliquerait plus jamais.
   *
   * Autrement dit : cette valeur ne vaut que **comparée à une autre colonne lue
   * pareil**. Elle ne doit jamais devenir un instant absolu — pas de
   * `toISOString()`, pas de comparaison à une date construite ailleurs. C'est
   * ce qu'avait fait la purge des messages, où le décalage ne s'annulait plus
   * (voir `messages/manageMsgExpiration.ts`) : un seuil de date se calcule en
   * SQL, là où les deux côtés parlent le même format.
   *
   * @returns L'horodatage de la base lu comme une heure locale, ou epoch en fallback.
   */
  async getCurrentTimestamp(): Promise<Date> {
    const ret: {CURRENT_TIMESTAMP: number}[] = await this.Database?.all('SELECT CURRENT_TIMESTAMP') as {CURRENT_TIMESTAMP: number}[];
    if (ret) {
        return (new Date(ret[0].CURRENT_TIMESTAMP));
    } else {
        return new Date(0);
    }
  }

  /**
   * Vérifie si un salon partenaire possède au moins un rang de la liste.
   * @param channel_id Identifiant du salon partenaire.
   * @param ranks Noms de rangs à vérifier.
   * @returns `true` dès qu'au moins un rang demandé est lié au salon; sinon `false`.
   */
  async partnerHasRanks(channel_id: string,
                        ranks: Array<string>): Promise<boolean> {
    if (ranks.length === 0) {
        return true;
    }
    if (!this.Database) {
        return false;
    }
    const placeholders: string = ranks.map(() => '?').join(', ');
    const request_result: ChannelPartnerRank[] = await this.Database.all(
      `SELECT * FROM ChannelPartnerRank JOIN Ranks ON ChannelPartnerRank.id_rank = Ranks.id_rank
       WHERE ChannelPartnerRank.id_channel = ? AND Ranks.name IN (${placeholders})`,
      [channel_id, ...ranks]);
    return request_result.length > 0;
  }

  /**
   * Récupère le lien d'invitation personnalisé associé à un serveur.
   * @param guildId Identifiant du serveur.
   * @returns URL d'invitation custom, ou `null` si aucune n'est configurée.
   */
  async getServerInvite(guildId: string): Promise<string | null> {
    const rows: ServerInvite[] = await this.get("ServerInvite", ["invite_url"], {}, {query: "id_guild = ?", values: [guildId]}) as ServerInvite[];
    if (rows.length === 0) {
      return null;
    }
    return rows[0].invite_url;
  }

  /**
   * Enregistre ou met à jour le lien d'invitation personnalisé d'un serveur.
   * @param guildId Identifiant du serveur.
   * @param inviteUrl Lien d'invitation à stocker (déjà validé/normalisé par l'appelant).
   * @param setBy Identifiant de l'utilisateur ayant défini le lien.
   * @returns Objet `status` indiquant le succès de l'insertion/mise à jour.
   */
  async setServerInvite(guildId: string,
                        inviteUrl: string,
                        setBy: string): Promise<status> {
    try {
      const existing: ServerInvite[] = await this.get("ServerInvite", ["id_guild"], {}, {query: "id_guild = ?", values: [guildId]}) as ServerInvite[];
      if (existing.length === 0) {
        return await this.set("ServerInvite", ["id_guild", "invite_url", "set_by", "updated_at"], [guildId, inviteUrl, setBy, toSQLiteDate(new Date())]);
      }
      await this.update("ServerInvite", {invite_url: inviteUrl, set_by: setBy, updated_at: toSQLiteDate(new Date())}, {id_guild: guildId});
      return {success: true, message: "Server invite updated."};
    } catch (e) {
      return {success: false, message: `Error while setting server invite: ${(e as TypeError).message}`};
    }
  }

  /**
   * Supprime le lien d'invitation personnalisé d'un serveur (retour au lien auto-généré).
   * @param guildId Identifiant du serveur.
   * @returns `true` si un lien existait et a été supprimé; sinon `false`.
   */
  async removeServerInvite(guildId: string): Promise<boolean> {
    const existing: ServerInvite[] = await this.get("ServerInvite", ["id_guild"], {}, {query: "id_guild = ?", values: [guildId]}) as ServerInvite[];
    if (existing.length === 0) {
      return false;
    }
    await this.rm("ServerInvite", {}, {query: "id_guild = ?", values: [guildId]});
    return true;
  }

  /**
   * Récupère le rôle arbitre configuré pour un serveur.
   * @param guildId Identifiant du serveur.
   * @returns Identifiant du rôle, ou `null` si aucun n'est configuré.
   */
  async getRefereeRole(guildId: string): Promise<string | null> {
    const rows: RefereeRole[] = await this.get("RefereeRole", ["id_role"], {}, {query: "id_guild = ?", values: [guildId]}) as RefereeRole[];
    if (rows.length === 0) {
      return null;
    }
    return rows[0].id_role;
  }

  /**
   * Enregistre ou met à jour le rôle arbitre d'un serveur.
   * @param guildId Identifiant du serveur.
   * @param roleId Identifiant du rôle Discord à alerter.
   * @param setBy Identifiant de l'utilisateur ayant défini le rôle.
   * @returns Objet `status` indiquant le succès de l'insertion/mise à jour.
   */
  async setRefereeRole(guildId: string,
                       roleId: string,
                       setBy: string): Promise<status> {
    try {
      const existing: RefereeRole[] = await this.get("RefereeRole", ["id_guild"], {}, {query: "id_guild = ?", values: [guildId]}) as RefereeRole[];
      if (existing.length === 0) {
        return await this.set("RefereeRole", ["id_guild", "id_role", "set_by", "updated_at"], [guildId, roleId, setBy, toSQLiteDate(new Date())]);
      }
      await this.update("RefereeRole", {id_role: roleId, set_by: setBy, updated_at: toSQLiteDate(new Date())}, {id_guild: guildId});
      return {success: true, message: "Referee role updated."};
    } catch (e) {
      return {success: false, message: `Error while setting referee role: ${(e as TypeError).message}`};
    }
  }

  /**
   * Supprime le rôle arbitre d'un serveur (plus aucun DM de signalement).
   * @param guildId Identifiant du serveur.
   * @returns `true` si un rôle était configuré et a été supprimé; sinon `false`.
   */
  async removeRefereeRole(guildId: string): Promise<boolean> {
    const existing: RefereeRole[] = await this.get("RefereeRole", ["id_guild"], {}, {query: "id_guild = ?", values: [guildId]}) as RefereeRole[];
    if (existing.length === 0) {
      return false;
    }
    await this.rm("RefereeRole", {}, {query: "id_guild = ?", values: [guildId]});
    return true;
  }

  /**
   * Efface la configuration propre à un serveur que le bot vient de quitter :
   * le lien d'invitation et le rôle arbitre (qui gardent tous deux `set_by`,
   * l'identifiant de l'administrateur qui les a posés), le rôle
   * d'administration du bot, les modules et les rappels d'adhésion — tout ce
   * que `GUILD_CONFIG_TABLES` énumère. Les salons relayés et leurs filtres de
   * rang sont l'affaire de `deleteGuildChannels` ; `eraseGuild` enchaîne les
   * deux. Pas de transaction : la connexion est partagée par tous les
   * gestionnaires, un `BEGIN` y engloberait (et un `ROLLBACK` y défairait) les
   * écritures qu'ils font entre deux `await`. Chaque suppression est
   * idempotente ; la première qui échoue interrompt la suite et remonte à
   * l'appelant.
   * @param guildId Identifiant du serveur quitté.
   * @returns Nombre de lignes supprimées, par table.
   */
  async forgetGuild(guildId: string): Promise<Record<string, number>> {
    const database = this.Database;
    if (!database) { return {}; }
    const removed: Record<string, number> = {};
    for (const [table, column] of GUILD_CONFIG_TABLES) {
      const result = await database.run(
        `DELETE FROM ${table} WHERE ${column} = ?`,
        [guildId],
      );
      removed[table] = result.changes ?? 0;
    }
    return removed;
  }

  /**
   * Retire un salon relayé : ses filtres de rang, puis ses services et le
   * salon partenaire lui-même (`deleteChannelServices`).
   *
   * Unique retrait d'un salon, partagé par `/relay`, `/reset-channel` et
   * `channelDelete` (`_resetChannel`) et par le retrait de tous les salons d'un
   * serveur (`deleteGuildChannels`) : une table **par salon** ajoutée demain se
   * range ici. Les filtres d'abord, ordre d'origine : tant que la ligne
   * `ChannelPartner` reste, un retrait interrompu se retrouve et se rejoue
   * (le rattrapage d'un serveur quitté relit cette table).
   * @param channelId Identifiant du salon.
   * @returns Un `status`, jamais une exception : l'échec des filtres comme
   *          celui des services se lit sur `success`.
   */
  async deleteChannel(channelId: string): Promise<status> {
    try {
      await this.rm("ChannelPartnerRank", {}, {query: "id_channel = ?", values: [channelId]});
    } catch (err) {
      return {success: false, message: `Échec du retrait des filtres de rang : ${(err as Error).message}`};
    }
    return this.deleteChannelServices(channelId);
  }

  /**
   * Retire tous les salons relayés d'un serveur, un par un (`deleteChannel`).
   *
   * Partagé par `/reset-all` (`_resetServer`) et l'oubli d'un serveur quitté
   * (`eraseGuild`). Un salon en échec n'arrête pas les suivants, et son
   * identifiant est nommé dans le message.
   * @param guildId Identifiant du serveur.
   * @returns `success` si tous les salons sont retirés (sinon les messages
   *          d'échec, un par ligne) et `found`, le nombre de salons trouvés —
   *          zéro dit « rien à retirer ».
   */
  async deleteGuildChannels(guildId: string): Promise<status & { found: number }> {
    const [channelTable, guildColumn] = GUILD_CHANNEL_TABLE;
    const channels = await this.get(channelTable, ["id_channel"], {}, {query: `${guildColumn} = ?`, values: [guildId]}) as {id_channel: string}[];
    let message = "";
    // Une clé `TEXT` admet `NULL` : `id_channel = NULL` ne désigne rien, la
    // ligne serait déclarée retirée sans l'être. Retirée ici par le serveur.
    if (channels.some(({id_channel}) => id_channel === null)) {
      try {
        await this.rm(channelTable, {}, {query: `${guildColumn} = ? AND id_channel IS NULL`, values: [guildId]});
      } catch (err) {
        message += `(salon sans identifiant): ${(err as Error).message}\n`;
      }
    }
    for (const {id_channel} of channels.filter(({id_channel}) => id_channel !== null)) {
      // `deleteChannel` ne lève pas : son échec se lit sur `success`.
      const ret: status = await this.deleteChannel(id_channel);
      if (!ret.success) {
        message += `${id_channel}: ${ret.message}\n`;
      }
    }
    return message.length === 0
      ? {success: true, message: "", found: channels.length}
      : {success: false, message, found: channels.length};
  }

  /**
   * Identifiants de tous les serveurs dont la base garde une configuration.
   *
   * Sert à rattraper, au démarrage, les serveurs quittés pendant que le bot
   * était arrêté (Discord n'envoie alors aucun `guildDelete`) et un
   * `forgetGuild` resté partiel : ce sont les tables mêmes qu'il vide
   * (`GUILD_CONFIG_TABLES`, une seule liste pour les deux), plus les salons
   * relayés que `deleteGuildChannels` retire.
   * @returns Identifiants distincts, dans un ordre quelconque.
   */
  async listConfiguredGuildIds(): Promise<string[]> {
    // Base fermée (restauration en cours) : lever plutôt que rendre une liste
    // vide, qui passerait pour une passe sans rien à oublier.
    const database = this.Database;
    if (!database) { throw new Error("Base fermée : serveurs configurés illisibles."); }
    const rows = await database.all(
      CONFIGURED_GUILDS_SQL,
    ) as { id: string }[];
    return rows.map((row) => String(row.id));
  }

  /**
   * Revendique la base pour une application Discord, ou vérifie qu'elle lui
   * appartient déjà.
   *
   * La première application qui démarre sur une base l'enregistre ; ensuite,
   * seule celle-là est reconnue. Pour confier la base à une autre application
   * (changement d'application Discord du bot), vider la table à la main :
   * `DELETE FROM BotOwner` — la suivante à démarrer la revendique.
   * @param applicationId Identifiant de l'application connectée (`client.application.id`, celui de `CLIENT_ID`).
   * @returns `true` si la base appartient à cette application (ou vient de lui
   *          être attribuée), `false` si elle en a une autre, `null` si la
   *          connexion est fermée (restauration en cours) : rien à conclure.
   */
  async claimOwnerApplication(applicationId: string): Promise<boolean | null> {
    const database = this.Database;
    if (!database) { return null; }
    // Les deux instructions sur la même connexion, capturée à l'entrée : une
    // restauration qui la remplace entre les deux ferait lever (signalé par
    // l'appelant), jamais conclure à tort « une autre application ».
    await database.run("INSERT OR IGNORE INTO BotOwner (id, application_id) VALUES (1, ?)", [applicationId]);
    const rows = await database.all("SELECT application_id FROM BotOwner WHERE id = 1") as { application_id: string }[];
    if (rows.length === 0) { return null; }
    return rows[0].application_id === applicationId;
  }

  /**
   * Replie les scrims et les recherches plus vieux que `days` jours en
   * compteurs journaliers anonymes (`ActivityDaily`), puis supprime les lignes.
   *
   * `Scrim.id_author` et `Recrute.id_author` sont des identifiants Discord :
   * datés et rattachés à un serveur, ils font un historique d'activité par
   * personne. Seul `/stats` (30 jours, soi-même) a besoin de l'auteur. Effacer
   * l'auteur en gardant la ligne ne suffisait pas : l'identifiant
   * auto-incrémenté garde l'ordre des commandes, et la n-ième ligne d'un
   * serveur un jour donné redonne la n-ième réponse publique « <joueur> a
   * utilisé /scrim ». Il ne reste donc qu'un **nombre** par jour, serveur et
   * niveau (ou rôle) — ce que lisent le graphe d'activité et les compteurs.
   * Une ligne sans date (la colonne l'admet) ne peut prouver son âge : elle
   * est repliée sous un jour vide.
   *
   * Repli et suppression dans une seule transaction, sur un seuil calculé une
   * fois et sur une connexion à part : sans elle, un arrêt entre les deux
   * compterait deux fois les lignes.
   * @param days Âge au-delà duquel les lignes sont repliées.
   * @returns Nombre de lignes repliées, par table.
   */
  async anonymizeActivityAuthors(days: number): Promise<{ Scrim: number; Recrute: number }> {
    // Base fermée (restauration en cours) : lever plutôt que rendre 0, que le
    // journal lirait comme une nuit sans rien à effacer.
    if (!this.Database) { throw new Error("Base fermée : anonymisation non jouée."); }
    // Connexion dédiée et brève : une transaction sur la connexion partagée
    // engloberait (et un `ROLLBACK` déferait) les écritures que les autres
    // gestionnaires y glissent entre deux `await`. Seuil lié, jamais inliné.
    const fold = await open({ filename: this.name, driver: sqlite3.Database });
    try {
      await fold.exec("PRAGMA busy_timeout = 5000");
      await fold.exec("PRAGMA secure_delete = ON");
      const [{ cutoff }] = await fold.all("SELECT DATETIME('now', ?) AS cutoff", [`-${days} days`]) as { cutoff: string }[];
      const old = "(date IS NULL OR date < ?)";
      await fold.exec("BEGIN IMMEDIATE");
      try {
        const [counts] = await fold.all(
          `SELECT (SELECT COUNT(*) FROM Scrim WHERE ${old}) AS scrim, (SELECT COUNT(*) FROM Recrute WHERE ${old}) AS recrute`,
          [cutoff, cutoff],
        ) as { scrim: number; recrute: number }[];
        await fold.run(
          `INSERT INTO ActivityDaily (kind, day, id_guild, detail, count)
             SELECT 'scrim', COALESCE(DATE(date), ''), COALESCE(id_guild, ''), COALESCE(level, ''), COUNT(*)
             FROM Scrim WHERE ${old} GROUP BY 2, 3, 4
             ON CONFLICT(kind, day, id_guild, detail) DO UPDATE SET count = count + excluded.count`,
          [cutoff],
        );
        await fold.run(
          `INSERT INTO ActivityDaily (kind, day, id_guild, detail, count)
             SELECT 'recrute', COALESCE(DATE(date), ''), COALESCE(id_guild, ''), COALESCE(role, ''), COUNT(*)
             FROM Recrute WHERE ${old} GROUP BY 2, 3, 4
             ON CONFLICT(kind, day, id_guild, detail) DO UPDATE SET count = count + excluded.count`,
          [cutoff],
        );
        await fold.run(`DELETE FROM Scrim WHERE ${old}`, [cutoff]);
        await fold.run(`DELETE FROM Recrute WHERE ${old}`, [cutoff]);
        await fold.exec("COMMIT");
        return { Scrim: Number(counts.scrim), Recrute: Number(counts.recrute) };
      } catch (error) {
        await fold.exec("ROLLBACK").catch(() => {});
        throw error;
      }
    } finally {
      await fold.close();
    }
  }

  /**
   * Ramène aux choix fermés les niveaux et rôles saisis en texte libre avant
   * blueGenjiBot#37, dans `Scrim.level`, `Recrute.role` et les nombres par
   * jour (`ActivityDaily.detail`, où ils survivaient sans limite).
   *
   * Une valeur qui désigne exactement un choix (casse et accents mis à part)
   * le devient ; toute autre — un pseudo, une phrase — rejoint la catégorie
   * « non précisé » (`''`), celle que le repli donne déjà à une ligne sans
   * valeur (`normalizeLegacyChoice`). Dans `ActivityDaily`, deux lignes qui
   * tombent sur la même clé sont **fusionnées** (comptes additionnés) : rien
   * ne se perd du total. Idempotent — une fois tout ramené, la passe ne
   * trouve plus rien —, d'où sa place dans le ménage de chaque nuit, qui
   * rattrape aussi une base restaurée d'avant la règle.
   *
   * Une transaction sur une connexion à part, comme le repli, et
   * `secure_delete` : le texte libre ne doit pas survivre dans les pages
   * libérées du fichier.
   * @returns Nombre de valeurs distinctes réécrites, toutes tables confondues.
   */
  async normalizeLegacyActivityDetails(): Promise<number> {
    if (!this.Database) { throw new Error("Base fermée : normalisation non jouée."); }
    const targets = [
      { kind: 'scrim', table: 'Scrim', column: 'level', choices: SCRIM_LEVEL_CHOICES },
      { kind: 'recrute', table: 'Recrute', column: 'role', choices: RECRUIT_ROLE_CHOICES },
    ] as const;
    const db = await open({ filename: this.name, driver: sqlite3.Database });
    try {
      await db.exec("PRAGMA busy_timeout = 5000");
      await db.exec("PRAGMA secure_delete = ON");
      await db.exec("BEGIN IMMEDIATE");
      try {
        let rewritten = 0;
        for (const target of targets) {
          // Table et colonne viennent de la liste ci-dessus, jamais d'une saisie.
          const rows = await db.all(
            `SELECT DISTINCT ${target.column} AS value FROM ${target.table}`,
          ) as { value: string | null }[];
          for (const { value } of rows) {
            const next = normalizeLegacyChoice(target.choices, value);
            if (value === next) { continue; }
            await db.run(
              `UPDATE ${target.table} SET ${target.column} = ? WHERE ${target.column} IS ?`,
              [next, value],
            );
            rewritten++;
          }
          const details = await db.all(
            "SELECT DISTINCT detail FROM ActivityDaily WHERE kind = ?",
            [target.kind],
          ) as { detail: string }[];
          for (const { detail } of details) {
            const next = normalizeLegacyChoice(target.choices, detail);
            if (detail === next) { continue; }
            await db.run(
              `INSERT INTO ActivityDaily (kind, day, id_guild, detail, count)
                 SELECT kind, day, id_guild, ?, count FROM ActivityDaily WHERE kind = ? AND detail = ?
                 ON CONFLICT(kind, day, id_guild, detail) DO UPDATE SET count = count + excluded.count`,
              [next, target.kind, detail],
            );
            await db.run("DELETE FROM ActivityDaily WHERE kind = ? AND detail = ?", [target.kind, detail]);
            rewritten++;
          }
        }
        await db.exec("COMMIT");
        return rewritten;
      } catch (error) {
        await db.exec("ROLLBACK").catch(() => {});
        throw error;
      }
    } finally {
      await db.close();
    }
  }

  /**
   * Exécute une requête SQL paramétrée brute (escape hatch pour analytics, GROUP BY, agrégats).
   * @param query Requête SQL avec placeholders `?`.
   * @param values Valeurs à binder (défaut: []).
   * @returns Tableau typé des résultats.
   */
  async raw<T = unknown>(query: string, values: unknown[] = []): Promise<T[]> {
    if (!this.Database) { return []; }
    return this.Database.all(query, values) as Promise<T[]>;
  }
}

export { Bdd, getBddInstance, closeBddInstance, resetBddInstance, resolveBddPath };


