import { open } from 'sqlite';
// eslint-disable-next-line import/no-named-as-default
import sqlite3 from 'sqlite3';
import { ranks, services } from '../utils/globals.js';
let bdd;
async function getBddInstance() {
    if (!bdd) {
        bdd = await Bdd.create('./database.sqlite');
    }
    return bdd;
}
function closeBddInstance() {
    if (!bdd) {
        return false;
    }
    bdd.delete();
    return true;
}
class Bdd {
    name;
    Database;
    constructor(name = './database.sqlite') {
        this.name = name;
        this.Database = null;
    }
    static async create(name = './database.sqlite') {
        const instance = new Bdd(name);
        await instance.init();
        return instance;
    }
    delete() {
        void this.Database?.close();
    }
    async init() {
        this.Database = await open({
            filename: this.name,
            // eslint-disable-next-line import/no-named-as-default-member
            driver: sqlite3.Database,
        });
        await this.initDatabase();
    }
    async initDatabase() {
        try {
            await this.Database?.exec(`CREATE TABLE IF NOT EXISTS OGMsg
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
           );`);
        }
        catch (err) {
            console.error("OGMsg :", err.message);
        }
        try {
            await this.Database?.exec(`CREATE TABLE IF NOT EXISTS MessageService
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
           );`);
        }
        catch (err) {
            console.error("MessageService : ", err.message);
        }
        try {
            await this.Database?.exec(`CREATE TABLE IF NOT EXISTS DPMsg
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
           );`);
        }
        catch (err) {
            console.error("DPMsg : ", err.message);
        }
        try {
            await this.Database?.exec(`CREATE TABLE IF NOT EXISTS ChannelPartner
           (
             id_channel
               TEXT
               PRIMARY
                 KEY,
             id_guild
               TEXT
           );`);
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
        catch (err) {
            console.error("ChannelPartner : ", err.message);
        }
        try {
            await this.Database?.exec(`CREATE TABLE IF NOT EXISTS Service
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
           );`);
            for (const service of services) {
                const ret = await this.get("Service", ["*"], {}, { query: "name = ?", values: [service] });
                if (ret.length > 0) {
                    continue;
                }
                console.log(`Adding "${service}" to the database...`);
                await this.Database?.run('INSERT INTO Service (name) VALUES (?)', [service], function (err) {
                    if (err) {
                        console.error(`Error while adding "${service}":`, err.message);
                    }
                    else {
                        console.log(`Successfully added "${service}".`);
                    }
                });
            }
        }
        catch (err) {
            console.error("Service&Co", err.message);
        }
        try {
            await this.Database?.exec(`CREATE TABLE IF NOT EXISTS ChannelPartnerService
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
           );`);
        }
        catch (e) {
            console.error("ChannelPartnerService : ", e.message);
        }
        try {
            await this.Database?.exec(`CREATE TABLE IF NOT EXISTS Ban
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
           );`);
        }
        catch (e) {
            console.error("Ban : ", e.message);
        }
        try {
            await this.Database?.exec(`CREATE TABLE IF NOT EXISTS Ranks
           (
             id_rank INTEGER PRIMARY KEY AUTOINCREMENT,
             name    TEXT NOT NULL
           );`);
            for (const rank of ranks) {
                const ret = await this.get('Ranks', ["*"], {}, { query: "name = ?", values: [rank] });
                if (ret.length > 0) {
                    continue;
                }
                console.log(`Adding "${rank}" to the database...`);
                await this.Database?.run("INSERT INTO Ranks (name) VALUES (?)", [rank]);
            }
        }
        catch (e) {
            console.error("Error rank filter : ", e.message);
        }
        try {
            await this.Database?.exec(`CREATE TABLE IF NOT EXISTS ChannelPartnerRank
           (
               id_channel TEXT    NOT NULL,
               id_rank    INTEGER NOT NULL,
               PRIMARY KEY (id_channel, id_rank)
           );`);
        }
        catch (e) {
            console.error('ChannelPartnerRank: ', e.message);
        }
        try {
            await this.Database?.exec(`CREATE TABLE IF NOT EXISTS AdhesionInterval
            (
                id TEXT NOT NULL,
                message TEXT,
                channel_id TEXT,
                member_id TEXT,
                role_id TEXT,
                author_id TEXT,
                interval number
           );`);
        }
        catch (e) {
            console.error("AdhesionInterval error: ", e.message);
        }
    }
    async set(tableName, elemName, value) {
        // console.log("set", tableName, elemName, value);
        if (elemName.length !== value.length) {
            return { success: false, message: "ElemName and value must be the same length." };
        }
        const names = "(" + elemName.join(", ") + ")";
        const values = "(" + value.join(", ") + ")";
        const query = `INSERT INTO ${tableName} ${names} VALUES ${values}`;
        try {
            await this.Database?.run(query);
        }
        catch (e) {
            return { success: false, message: `Error while adding "${tableName}": ${e.message}` };
        }
        return { success: true, message: "Successfully added " };
    }
    async update(tableName, update, where) {
        const query_values = [];
        let query = `UPDATE ${tableName}
                 SET `;
        const set = [];
        for (const [column, value] of Object.entries(update)) {
            set.push(`${column} = ?`);
            query_values.push(value);
        }
        query += set.join(", ");
        query += ' WHERE ';
        const conditions = [];
        for (const [column, value] of Object.entries(where)) {
            conditions.push(`${column} = ?`);
            query_values.push(value);
        }
        query += conditions.join(' AND ');
        await this.Database?.run(query, query_values);
    }
    async get(tableName, values = ["*"], joinOptions, whereConditions, is_ascending, index_elem) {
        const stringValues = values.join(", ");
        const baseQuery = `SELECT ${stringValues} FROM ${tableName}`;
        const query = (await this.queryBuilder(baseQuery, joinOptions, whereConditions, is_ascending, index_elem));
        return this.Database.all(query.query, query.ret_array);
    }
    async rm(tableName, joinOptions, whereConditions) {
        const baseQuery = `DELETE FROM ${tableName} `;
        const query = (await this.queryBuilder(baseQuery, joinOptions, whereConditions));
        await this.Database?.run(query.query, query.ret_array);
    }
    async queryBuilder(baseQuery, joinOptions, whereConditions, is_ascending, index_elem) {
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
        if (whereConditions) {
            whereClause += ' WHERE ';
            ret.push(...whereConditions.values);
        }
        if (index_elem && index_elem.length > 0) {
            orderClause += `ORDER BY ${index_elem}`;
            if (is_ascending === true) {
                orderClause += ' ASC';
            }
            else if (is_ascending === false) {
                orderClause += ' DESC';
            }
            else {
                orderClause = "";
            }
        }
        const query = `${baseQuery}${joinClause}${whereClause}${orderClause}`;
        const ret_array = Object.values(ret);
        return ({ ret_array: ret_array, query: query });
    }
    async setNewPartnerChannel(id_channel, id_guild, service_name, region) {
        try {
            const channelPartners = await this.get("ChannelPartner", ["*"], {}, { query: "id_channel = ?", values: [id_channel] });
            if (channelPartners.length === 0) {
                const ret = await this.set("ChannelPartner", ["id_channel", "id_guild", "region"], [id_channel, id_guild, region]);
                if (!(ret.success)) {
                    return ret;
                }
            }
            const ret_service = await this.get("Service", ["*"], {}, { query: "name = ?", values: [service_name] });
            const id_service = ret_service[0].id_service;
            const channelPartnersServices = await this.get("ChannelPartnerService", ["*"], {}, { query: "id_channel = ? AND id_service = ?", values: [id_channel, id_service] });
            if (channelPartnersServices.length > 0) {
                return { success: false, message: `Channel is already linked to "${service_name}".` };
            }
            await this.set("ChannelPartnerService", ["id_channel", "id_service"], [id_channel, id_service]);
            return { success: true, message: 'AllWentFine' };
        }
        catch (err) {
            return { success: false, message: "I have encountered an error. Please contact elessiah\n" + err.message };
        }
    }
    async deleteChannelServices(channel_id) {
        try {
            const channelPartners = await this.get("ChannelPartner", ["*"], {}, { query: "id_channel = ?", values: [channel_id] });
            if (!channelPartners) {
                return { success: false, message: "Channel has no services to delete." };
            }
            let query = `DELETE
                   FROM ChannelPartnerService
                   WHERE id_channel = ?`;
            await this.Database?.run(query, [channel_id]);
            query = `DELETE
               FROM ChannelPartner
               WHERE id_channel = ?`;
            await this.Database?.run(query, [channel_id]);
            return { success: true, message: 'Services deleted.' };
        }
        catch (err) {
            console.error(`Erreur deleting channel service : ${err.message}`);
            return { success: false, message: 'Failed to delete channel services.' };
        }
    }
    async dropTable(table_name) {
        try {
            await this.Database?.run(`drop table ${table_name}`);
            return { success: true, message: 'Table dropped successfully.' };
        }
        catch (err) {
            return { success: false, message: 'Failed to drop table ' + table_name + '\nError: ' + err.message };
        }
    }
    async getCurrentTimestamp() {
        const ret = await this.Database?.all('SELECT CURRENT_TIMESTAMP');
        if (ret) {
            return (new Date(ret[0].CURRENT_TIMESTAMP));
        }
        else {
            return new Date(0);
        }
    }
    async partnerHasRanks(channel_id, ranks) {
        const ranksFilter = [];
        ranks.forEach((rank) => { ranksFilter.push(` Ranks.name='${rank}' `); });
        const queryFilter = ranksFilter.join(' OR ');
        if (!this.Database) {
            return false;
        }
        const request_result = await this.Database.all(`SELECT * FROM ChannelPartnerRank JOIN Ranks ON ChannelPartnerRank.id_rank = Ranks.id_rank
      WHERE ChannelPartnerRank.id_channel=${channel_id} AND (${queryFilter});`);
        return !(request_result.length === 0);
    }
}
export { Bdd, getBddInstance, closeBddInstance };
//# sourceMappingURL=Bdd.js.map