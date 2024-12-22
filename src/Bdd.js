const sqlite = require('sqlite');
const sqlite3 = require('sqlite3');
const sendLog = require("./safe/sendLog");

let bdd;

async function getBddInstance() {
  if (!bdd) {
    bdd = await Bdd.create('./database.sqlite');
  }
  return bdd;
}

class Bdd {
  constructor(name = './database.sqlite') {
    this.name = name;
    this.Database = null;
  }

  static async create(name = './database.sqlite') {
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
    try {
      await this.dropTable('DPMsg');
    } catch (err) {
      console.log(err);
    }
    try {
      await this.dropTable('OGMsg');
    } catch (err) {
      console.log(err);
    }
    try {
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
    } catch (err) {
      console.log("OGMsg :", err);
    }
    try {
      await this.Database.exec(
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
      console.log("MessageService : ", err);
    }
    try {
      await this.Database.exec(
          `CREATE TABLE IF NOT EXISTS DPMsg
          (
            id_msg
            TEXT,
            id_channel
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
    } catch (err) {
      console.log("DPMsg : ", err);
    }
    try {
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
    } catch (err) {
      console.log("ChannelPartner : ", err);
    }
    try {
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
    } catch (err) {
      console.log("Service&Co", err);
    }
    try {
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
    } catch (e) {
      console.log("ChannelPartnerService : ", e);
    }
  }

  async set(tableName, elemName, value) {
    if (typeof (elemName) !== typeof ([])) {
      elemName = [elemName];
    }
    if (typeof (value) !== typeof ([])) {
      value = [value];
    }
    if (elemName.length !== value.length) {
      return {success: false, message: "ElemName and value must be the same length."};
    }
    const names = "(" + elemName.join(", ") + ")";
    const values = "(" + value.join(", ") + ")";
    const query = `INSERT INTO ${tableName} ${names} VALUES ${values}`;
    try {
      this.Database.run(query);
    } catch (e) {
      return {success: false, message: `Error while adding "${tableName}": ${e.message}`};
    }
    return {success: true, message: "Successfully added "};
  }

  async get(tableName,
            values = ["*"],
            joinOptions = {},
            whereConditions = {},
            is_ascending = null,
            index_elem = "") {
    //console.log("Get params: ", tableName, values, joinOptions, whereConditions);
    try {
      const stringValues = values.join(", ");
      let baseQuery = `SELECT ${stringValues}
                       FROM ${tableName}`;
      let joinClause = '';
      let whereClause = '';
      let orderClause = '';
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

      if (index_elem.length > 0) {
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
      //console.log("Get_query", query, ret_array);
      return await this.Database.all(query, ret_array);
    } catch (err) {
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
      return {success: false, message: "I have encountered an error. Please contact elessiah\n" + err.message};
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

  async dropTable(table_name) {
    try {
      await this.Database.run(`drop table ${table_name}`);
      return {success: true, message: 'Table dropped successfully.'};
    } catch (err) {
      return {success: false, message: 'Failed to drop table ' + table_name};
    }
  }

  async getCurrentTimestamp(){
    const ret = await this.Database.all('SELECT CURRENT_TIMESTAMP');
    return (ret[0].CURRENT_TIMESTAMP);
  }
}

module.exports = { Bdd, getBddInstance };