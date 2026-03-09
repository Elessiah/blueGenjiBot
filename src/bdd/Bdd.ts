import {open} from 'sqlite';
import type {Database} from 'sqlite';
// eslint-disable-next-line import/no-named-as-default
import sqlite3 from 'sqlite3';

import type {status, Query} from "../types.js";
import {ranks, services} from '../utils/globals.js';

import type {
    Ranks,
    Service,
    ChannelPartner,
    ChannelPartnerService,
    joinOptions,
    whereConditions,
    ChannelPartnerRank
} from "./types.js";
import e from "express";

let bdd: Bdd;

/**
 * Retourne l'instance singleton de la base de données.
 * Crée et initialise la connexion SQLite si nécessaire.
 * @returns Instance Bdd prête à être utilisée.
 */
async function getBddInstance(): Promise<Bdd> {
  if (!bdd) {
    bdd = await Bdd.create('./database.sqlite');
  }
  return bdd;
}

/**
 * Ferme l'instance singleton courante si elle existe.
 * @returns `true` si une instance était ouverte, sinon `false`.
 */
function closeBddInstance(): boolean {
  if (!bdd)
    {return false;}
  bdd.delete();
  return true;
}

class Bdd {
    private name: string;
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
   * Ferme la connexion SQLite associée à cette instance.
   */
  delete(): void {
    void this.Database?.close();
  }

  /**
   * Ouvre la connexion SQLite puis initialise/met à jour le schéma.
   */
  async init(): Promise<void> {
    this.Database = await open({
      filename: this.name,
        // eslint-disable-next-line import/no-named-as-default-member
      driver: sqlite3.Database,
    });
    await this.initDatabase();
  }

  /**
   * Crée les tables nécessaires et injecte les données statiques manquantes.
   */
  async initDatabase(): Promise<void> {
    try {
      await this.Database?.exec(
          `CREATE TABLE IF NOT EXISTS OGMsg
           (
             id_msg
               TEXT,
             id_author
               TEXT,
             date
               DATETIME
               DEFAULT
                 CURRENT_TIMESTAMP,
             PRIMARY
               KEY
               (
                id_msg
                 )
           );`
      );
    } catch (err) {
      console.error("OGMsg :", (err as TypeError).message);
    }
    try {
      await this.Database?.exec(
          `CREATE TABLE IF NOT EXISTS MessageService
           (
             id_msg
               text,
             id_service
               INTEGER,
             PRIMARY
               KEY
               (
                id_msg,
                id_service
                 )
           );`
      );
    } catch (err) {
      console.error("MessageService : ", (err as TypeError).message);
    }
    try {
      await this.Database?.exec(
          `CREATE TABLE IF NOT EXISTS DPMsg
           (
             id_msg
               TEXT,
             id_channel
               TEXT,
             id_og
               TEXT,
             date
               DATETIME
               DEFAULT
                 CURRENT_TIMESTAMP,
             PRIMARY
               KEY
               (
                id_msg
                 )
           );`
      );
    } catch (err) {
      console.error("DPMsg : ", (err as TypeError).message);
    }
    try {
      await this.Database?.exec(
          `CREATE TABLE IF NOT EXISTS ChannelPartner
           (
             id_channel
               TEXT
               PRIMARY
                 KEY,
             id_guild
               TEXT
           );`
      );
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
    } catch (err) {
      console.error("ChannelPartner : ", (err as TypeError).message);
    }
    try {
      await this.Database?.exec(
          `CREATE TABLE IF NOT EXISTS Service
           (
             id_service
               INTEGER
               PRIMARY
                 KEY
               AUTOINCREMENT,
             name
               TEXT
               NOT
                 NULL
           );`
      );

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
    } catch (err) {
      console.error("Service&Co", (err as TypeError).message, err);
    }
    try {
      await this.Database?.exec(
          `CREATE TABLE IF NOT EXISTS ChannelPartnerService
           (
             id_channel
               TEXT
               NOT
                 NULL,
             id_service
               INTEGER
               NOT
                 NULL,
             PRIMARY
               KEY
               (
                id_channel,
                id_service
                 )
           );`
      );
    } catch (e) {
      console.error("ChannelPartnerService : ", (e as TypeError).message);
    }
    try {
      await this.Database?.exec(
          `CREATE TABLE IF NOT EXISTS Ban
           (
             id_user
               TEXT
               PRIMARY
                 KEY,
             id_moderator
               TEXT
               NOT
                 NULL,
             id_reason
               TEXT
               NOT
                 NULL,
             date
               DATETIME
               DEFAULT
                 CURRENT_TIMESTAMP
           );`
      );
    } catch (e) {
      console.error("Ban : ", (e as TypeError).message);
    }
    try {
      await this.Database?.exec(
          `CREATE TABLE IF NOT EXISTS Ranks
           (
             id_rank INTEGER PRIMARY KEY AUTOINCREMENT,
             name    TEXT NOT NULL
           );`
      );
      for (const rank of ranks) {
        const ret: Ranks[] = await this.get('Ranks', ["*"], {}, {query: "name = ?", values: [rank]}) as Ranks[];
        if (ret.length > 0)
          {continue;}
        console.log(`Adding "${rank}" to the database...`);
        await this.Database?.run("INSERT INTO Ranks (name) VALUES (?)", [rank]);
      }
    } catch (e) {
      console.error("Error rank filter : ", (e as TypeError).message);
    }
    try {
      await this.Database?.exec(
          `CREATE TABLE IF NOT EXISTS ChannelPartnerRank
           (
               id_channel TEXT    NOT NULL,
               id_rank    INTEGER NOT NULL,
               PRIMARY KEY (id_channel, id_rank)
           );`
      );
    } catch (e) {
      console.error('ChannelPartnerRank: ', (e as TypeError).message);
    }
    try {
      await this.Database?.exec(
          `CREATE TABLE IF NOT EXISTS AdhesionInterval
            (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                message TEXT NOT NULL ,
                guild_id TEXT NOT NULL,
                channel_id TEXT,
                member_id TEXT,
                role_id TEXT,
                author_id TEXT NOT NULL,
                interval_days INTEGER NOT NULL,
                iteration INTEGER NOT NULL DEFAULT -1,
                nextTransmission DATETIME DEFAULT CURRENT_TIMESTAMP
           );`
      );
    } catch (e) {
      console.error("AdhesionInterval error: ", (e as TypeError).message);
    }
    try {
      await this.Database?.exec(
        `CREATE TABLE IF NOT EXISTS RoleAdmin
          ( 
            guild_id TEXT NOT NULL PRIMARY KEY,
            role_id TEXT NOT NULL
          );
        `
      );
    } catch (e) {
      console.error("RoleAdmin error: ", (e as TypeError).message);
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
    const strValues = "(" + value.map(v => v === null ? "NULL" : "?").join(",") + ")";
    const query = `INSERT INTO ${tableName} ${names} VALUES ${strValues}`;
    try {
      await this.Database?.run(query, value.filter(v => v !== null));
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
      orderClause += `ORDER BY ${index_elem}`;
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
   * @returns Date courante de la base, ou epoch en fallback.
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
    const ranksFilter: Array<string> = [];
    ranks.forEach((rank) => {ranksFilter.push(` Ranks.name='${rank}' `)});
    const queryFilter: string = ranksFilter.join(' OR ');
    if (!this.Database) {
        return false;
    }
    const request_result: ChannelPartnerRank[] = await this.Database.all(`SELECT * FROM ChannelPartnerRank JOIN Ranks ON ChannelPartnerRank.id_rank = Ranks.id_rank
      WHERE ChannelPartnerRank.id_channel=${channel_id} AND (${queryFilter});`);
    return !(request_result.length === 0);
  }
}

export { Bdd, getBddInstance, closeBddInstance };


