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
  constructor(name) {
    this.name = name;
    this.Database = null;
  }

  static async create(name) {
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
    console.log("OGMsg");
    await this.Database.exec(
        `CREATE TABLE IF NOT EXISTS OGMsg
        (
          id_msg
          INTEGER,
          id_author
          INTEGER,
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
    console.log("DPMsg");
    await this.Database.exec(
        `CREATE TABLE IF NOT EXISTS DPMsg
        (
          id_msg
          INTEGER,
          id_og
          INTEGER,
          PRIMARY
          KEY
         (
          id_msg
         )
          );`
    );
    console.log("ChannelPartner");
    await this.Database.exec(
        `CREATE TABLE IF NOT EXISTS ChannelPartner
         (
           id_channel
           INTEGER
           PRIMARY
           KEY
         );`
    );
    console.log("Service");
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
    const services = ['lfs', 'lfc', 'lfsub', 'lft', 'lfp', 'lfstaff', 'lfcast'];

    for (const service of services) {
      await this.Database.run('INSERT INTO Service (name) VALUES (?)', [service], function (err) {
        if (err) {
          console.error(`Error while adding "${service}":`, err.message);
        } else {
          console.log(`Successfully added "${service}".`);
        }
      });
    }
    console.log("ChannelPartnerService");
    await this.Database.exec(
        `CREATE TABLE IF NOT EXISTS ChannelPartnerService
        (
          id_channel
          INTEGER
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

  async isTableExist(tableName) {
    const result = await this.Database.get(
        `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
        tableName
    );
    return !!result;
  }

  async get(tableName, elemName, elemValue) {
    try {
      const result = await this.Database.get(
          `SELECT * FROM ${tableName} WHERE ${elemName} = ?`,
          elemValue
      );
      return result;
    } catch (err) {
      console.error(`Failed to retrieve data from ${tableName}:`, err);
      return null;
    }
  }

  async setNewOGMsg(id_msg, id_author) {
    try {
      await this.Database.run(
          `INSERT INTO OGMsg (id_msg, id_author) VALUES (?, ?)`,
          id_msg,
          id_author
      );
    } catch (err) {
      console.error("Failed to insert into OGMsg:", err);
    }
  }

  async setNewDPMsg(id_msg, id_og) {
    try {
      await this.Database.run(
          `INSERT INTO DPMsg (id_msg, id_og) VALUES (?, ?)`,
          id_msg,
          id_og
      );
    } catch (err) {
      console.error("Failed to insert into DPMsg:", err);
    }
  }

  async setNewPartnerChannel(id_channel, service_name) {
    console.log("setNewPartnerChannel");
    try {
      // Vérifie si le channel existe
      console.log("1");
      const exists = await this.Database.get('SELECT 1 FROM ChannelPartner WHERE (id_channel) = (?)', id_channel);

      // Si le channel n'existe pas, l'ajoute
      console.log("exists : ", exists);
      if (!(!!exists)) {
        console.log("2: ", id_channel);
        await this.Database.exec('INSERT INTO ChannelPartner (id_channel) VALUES (?)', id_channel);
      }

      // Récupère le service
      console.log("3");
      let id_service = await this.Database.get('SELECT id_service FROM Service WHERE name = ?', service_name);
      if (!id_service) {
        return { success: false, message: `Service "${service_name}" not found.` };
      }

      id_service = id_service.id_service

      // Associe le channel avec le service
      console.log("Id_service : ", id_service);
      console.log("4");
      await this.Database.exec(
          'INSERT INTO ChannelPartnerService (id_channel, id_service) VALUES (?, ?)',
          id_channel,
          id_service
      );

      return { success: true, message: 'AllWentFine' };
    } catch (err) {
      console.error("Error encounter in setNewPartnerChannel :", err);
      return { success: false, message: err.message || 'An error has occurred.' };
    }
  }

  async getPartnerChannelsFromServiceName(service_name) {
    const id_service = await this.Database.get('SELECT id_service FROM Service WHERE name = ?', service_name);
      if (!id_service) {
        return {success: false, message: `Service "${service_name}" cannot be found.`};
      }
    return (this.getPartnerChannelsFromServiceId(id_service))
  }

  async getPartnerChannelsFromServiceId(service_id) {
    try {
      const channels_id = await this.Database.get(`SELECT ChannelPartner.id_channel
                                                   FROM ChannelPartner
                                                          JOIN ChannelPartnerService
                                                               ON ChannelPartner.id_channel = ChannelPartnerService.id_channel
                                                   WHERE ChannelPartnerService.id_service = ?`, service_id);
      return ({success: true, message: channels_id});
    } catch (err) {
      return ({success: false, message: err.message || 'Une erreur inconnue est survenue.'});
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