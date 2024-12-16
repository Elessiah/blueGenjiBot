const sqlite = require('sqlite');
const sqlite3 = require('sqlite3');

let bdd;

async function getBddInstance() {
  if (!bdd) {
    bdd = await Bdd.create('./database.sqlite');
  }
  return bdd;
}

class Bdd {
  constructor(name='./database.sqlite') {
    this.name = name;
    this.Database = null;
  }

  static async create(name='./database.sqlite') {
    const instance = new Bdd(name);
    await instance.init();
    return instance;
  }

  async init() {
    this.Database = await sqlite.open({
      filename: this.name,
      driver: sqlite3.Database,
    });
    await this.initDatabase();
  }

  async initDatabase() {
    await this.Database.exec(
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
    await this.Database.exec(
        `CREATE TABLE IF NOT EXISTS DPMsg
        (
          id_msg
          TEXT,
          id_og
          TEXT,
          PRIMARY
          KEY
         (
          id_msg
         )
          );`
    );
    await this.Database.exec(
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
    await this.Database.exec(
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
    const services = ['lfs', 'ta', 'lfsub', 'lft', 'lfp', 'lfstaff', 'lfcast'];

    for (const service of services) {
      const ret = await this.get("Service", ["*"], {}, {name: service});
      if (!!ret && ret.length > 0)
        continue;
      console.log(
          `Adding "${service}" to the database...`
      );
      await this.Database.run('INSERT INTO Service (name) VALUES (?)', [service], function (err) {
        if (err) {
          console.error(`Error while adding "${service}":`, err.message);
        } else {
          console.log(`Successfully added "${service}".`);
        }
      });
    }
    await this.Database.exec(
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
  }

  async set(tableName, elemName, value) {
    if (typeof (elemName) !== typeof (value)) {
      console.log("The two parameters must be of the same type.");
      return null;
    }
    if (typeof (elemName) === typeof ("")) {
      elemName = [elemName];
      value = [value];
    } else if (typeof (elemName) !== typeof ([])) {
      console.log("The parameters must be a string or an array.");
      return null;
    }
    if (elemName.length !== value.length) {
      console.log("The two parameters must have the same length.");
      return null;
    }
    const names = "(" + elemName.join(", ") + ")";
    const values = "(" + value.join(", ") + ")";
    const query = `INSERT INTO ${tableName} ${names} VALUES ${values}`;
    await this.Database.run(query);
  }

  async get(tableName, values = ["*"], joinOptions = {}, whereConditions = {}) {
    //console.log("Get params: ", tableName, values, joinOptions, whereConditions);
    try {
      const stringValues = values.join(", ");
      let baseQuery = `SELECT ${stringValues}
                       FROM ${tableName}`;
      let joinClause = '';
      let whereClause = '';
      const ret = [];

      // Handle JOIN ON clauses
      if (joinOptions && Object.keys(joinOptions).length > 0) {
        for (const [joinTable, onCondition] of Object.entries(joinOptions)) {
          joinClause += ` JOIN ${joinTable} ON ${onCondition}`;
        }
      }

      // Handle WHERE conditions
      if (whereConditions && Object.keys(whereConditions).length > 0) {
        whereClause += ' WHERE ';
        const conditions = [];
        for (const [column, value] of Object.entries(whereConditions)) {
          conditions.push(`${column} = ?`);
          ret.push(value);
        }
        whereClause += conditions.join(' AND ');
      }

      const query = `${baseQuery}${joinClause}${whereClause}`;
      const ret_array = Object.values(ret);
      //console.log("Get_query", query, ret_array);
      return await this.Database.all(query, ret_array);
    } catch (err) {
      console.error("Error in get method:", err);
      throw err;
    }
  }

  async setNewPartnerChannel(id_channel, id_guild, service_name) {
    try {
      let exists = await this.get("ChannelPartner", ["*"], {}, {id_channel: id_channel});
      if (typeof (exists) === typeof undefined || exists.length === 0) {
        await this.set("ChannelPartner", ["id_channel", "id_guild"], [id_channel, id_guild]);
      }
      const ret_service = await this.get("Service", ["*"], {}, {name: service_name});
      const id_service = ret_service[0].id_service;
      exists = await this.get("ChannelPartnerService", ["*"], {}, {id_channel: id_channel, id_service: id_service});
      if (typeof (exists) !== typeof undefined && exists.length > 0)
        return {success: false, message: `Channel is already linked to "${service_name}".`};
      await this.set("ChannelPartnerService", ["id_channel", "id_service"], [id_channel, id_service]);
      return {success: true, message: 'AllWentFine'};
    } catch (err) {
      return {success: false, message: "I have encountered an error. Please contact elessiah\n" + err.message };
    }
  }

  async deleteChannelServices(channel_id) {
    try {
      const exists = await this.get("ChannelPartner", ["*"], {}, {id_channel: channel_id});
      if (typeof (exists) === typeof undefined || exists.length === 0)
        return {success: false, message: `Channel has no services to delete.`};
      let query = `DELETE
                   FROM ChannelPartnerService
                   WHERE id_channel = ?`;
      await this.Database.run(query, [channel_id]);
      query = `DELETE
               FROM ChannelPartner
               WHERE id_channel = ?`;
      await this.Database.run(query, [channel_id]);
      return {success: true, message: 'Services deleted.'};
    } catch (err) {
      console.log(err);
      return {success: false, message: 'Failed to delete channel services.'};
    }
  }

  async getChannelService(channel_id) {
    try {
      const services = await this.Database.get(`SELECT Service.name
                                                FROM ChannelPartner
                                                       JOIN ChannelPartnerService
                                                            ON ChannelPartner.id_channel = ChannelPartnerService.id_channel
                                                       JOIN Service
                                                            ON ChannelPartnerService.id_service = Service.id_service
                                                WHERE ChannelPartner.id_channel = ?`, channel_id);
      if (!!services)
        return ({success: true, message: services});
      return ({success: false, message: `Channel "${channel_id}" cannot be found.`});
    } catch (err) {
      return ({success: false, message: err.message || 'Une erreur inconnue est survenue.'});
    }
  }
}

module.exports = { Bdd, getBddInstance };