/*
 * Instructions SQL du schéma, jouées dans l'ordre par `Bdd.initDatabase`
 * (liste `SCHEMA_STEPS`). Chaque texte est repris à l'octet près de sa
 * version d'origine, retours à la ligne et indentation compris : SQLite garde
 * le texte d'un `CREATE TABLE` dans `sqlite_master`, et `initDatabaseSql.test.ts`
 * en fixe l'empreinte.
 */

/**
 * Une ligne effacée ou réécrite (auteur anonymisé, table `UserLink`
 * supprimée, serveur oublié) laisserait sinon ses octets dans les pages
 * libérées du fichier — et la sauvegarde, qui copie les pages telles
 * quelles, les emporterait. Réglage de connexion, rejoué à chaque ouverture.
 * `ON` plutôt que `FAST` : `FAST` ne réécrit pas les pages rendues à la
 * liste libre, justement celles d'une table supprimée. Le coût (quelques
 * écritures de plus par purge de relais) est négligeable sur cette base.
 */
export const SECURE_DELETE_PRAGMA = "PRAGMA secure_delete = ON";

/**
 * Une écriture qui trouve la base verrouillée (sauvegarde en cours)
 * attend jusqu'à 5 s au lieu d'échouer aussitôt : les reprises des
 * appelants ne font alors plus dix échecs en rafale.
 */
export const BUSY_TIMEOUT_PRAGMA = "PRAGMA busy_timeout = 5000";

/** Table `OGMsg` (sans effet si elle existe déjà). */
export const OGMSG_TABLE = `CREATE TABLE IF NOT EXISTS OGMsg
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
           );`;

/** Table `MessageService` (sans effet si elle existe déjà). */
export const MESSAGE_SERVICE_TABLE = `CREATE TABLE IF NOT EXISTS MessageService
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
           );`;

/** Table `DPMsg` (sans effet si elle existe déjà). */
export const DPMSG_TABLE = `CREATE TABLE IF NOT EXISTS DPMsg
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
           );`;

/** Table `ChannelPartner` (sans effet si elle existe déjà). */
export const CHANNEL_PARTNER_TABLE = `CREATE TABLE IF NOT EXISTS ChannelPartner
           (
             id_channel
               TEXT
               PRIMARY
                 KEY,
             id_guild
               TEXT
           );`;

/** Table `Service` (sans effet si elle existe déjà). */
export const SERVICE_TABLE = `CREATE TABLE IF NOT EXISTS Service
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
           );`;

/** Table `ChannelPartnerService` (sans effet si elle existe déjà). */
export const CHANNEL_PARTNER_SERVICE_TABLE = `CREATE TABLE IF NOT EXISTS ChannelPartnerService
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
           );`;

/** Table `Ban` (sans effet si elle existe déjà). */
export const BAN_TABLE = `CREATE TABLE IF NOT EXISTS Ban
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
                 CURRENT_TIMESTAMP,
             id_reason_owner TEXT,
             id_notice_admin TEXT
           );`;

/** Table `Ranks` (sans effet si elle existe déjà). */
export const RANKS_TABLE = `CREATE TABLE IF NOT EXISTS Ranks
           (
             id_rank INTEGER PRIMARY KEY AUTOINCREMENT,
             name    TEXT NOT NULL
           );`;

/** Table `ChannelPartnerRank` (sans effet si elle existe déjà). */
export const CHANNEL_PARTNER_RANK_TABLE = `CREATE TABLE IF NOT EXISTS ChannelPartnerRank
           (
               id_channel TEXT    NOT NULL,
               id_rank    INTEGER NOT NULL,
               PRIMARY KEY (id_channel, id_rank)
           );`;

/** Table `AdhesionInterval` (sans effet si elle existe déjà). */
export const ADHESION_INTERVAL_TABLE = `CREATE TABLE IF NOT EXISTS AdhesionInterval
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
           );`;

/** Table `RoleAdmin` (sans effet si elle existe déjà). */
export const ROLE_ADMIN_TABLE = `CREATE TABLE IF NOT EXISTS RoleAdmin
          (
            guild_id TEXT NOT NULL PRIMARY KEY,
            role_id TEXT NOT NULL
          );
        `;

/** Table `ServerModule` (sans effet si elle existe déjà). */
export const SERVER_MODULE_TABLE = `CREATE TABLE IF NOT EXISTS ServerModule
          (
            id_guild TEXT NOT NULL,
            module_key TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            PRIMARY KEY (id_guild, module_key)
          );
        `;

/** Table `FeedEvent` (sans effet si elle existe déjà). */
export const FEED_EVENT_TABLE = `CREATE TABLE IF NOT EXISTS FeedEvent
          (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts DATETIME DEFAULT CURRENT_TIMESTAMP,
            type TEXT NOT NULL,
            source TEXT,
            target TEXT,
            summary TEXT NOT NULL
          );
        `;

/** Table `DailySnapshot` (sans effet si elle existe déjà). */
export const DAILY_SNAPSHOT_TABLE = `CREATE TABLE IF NOT EXISTS DailySnapshot
          (
            date TEXT PRIMARY KEY,
            servers_count INTEGER NOT NULL DEFAULT 0,
            channels_count INTEGER NOT NULL DEFAULT 0,
            messages_count INTEGER NOT NULL DEFAULT 0,
            relays_count INTEGER NOT NULL DEFAULT 0
          );
        `;

/** Table `Scrim` (sans effet si elle existe déjà). */
export const SCRIM_TABLE = `CREATE TABLE IF NOT EXISTS Scrim
          (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            id_author TEXT NOT NULL,
            game TEXT NOT NULL,
            level TEXT NOT NULL,
            id_guild TEXT,
            date DATETIME DEFAULT CURRENT_TIMESTAMP
          );
        `;

/** Table `Recrute` (sans effet si elle existe déjà). */
export const RECRUTE_TABLE = `CREATE TABLE IF NOT EXISTS Recrute
          (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            id_author TEXT NOT NULL,
            role TEXT NOT NULL,
            id_guild TEXT,
            date DATETIME DEFAULT CURRENT_TIMESTAMP
          );
        `;

/**
 * `/link` a été retirée : elle promettait une liaison que le site n'a
 * jamais su recevoir, et sa table ne gardait plus que des identifiants
 * Discord et des codes expirés. La supprimer efface les lignes des
 * bases qui tournent ; aucune ne sera plus jamais écrite.
 */
export const DROP_USER_LINK = "DROP TABLE IF EXISTS UserLink";

/**
 * Modules retirés : `oauth` n'existait que pour `/link`, `notifications`
 * et `stats` n'étaient relus par aucune commande. Leurs préférences,
 * qu'aucun code ne relit plus, partent avec eux.
 */
export const PURGE_RETIRED_MODULES = "DELETE FROM ServerModule WHERE module_key IN ('oauth', 'notifications', 'stats')";

/** Table `ServerInvite` (sans effet si elle existe déjà). */
export const SERVER_INVITE_TABLE = `CREATE TABLE IF NOT EXISTS ServerInvite
          (
            id_guild TEXT PRIMARY KEY,
            invite_url TEXT NOT NULL,
            set_by TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );
        `;

/**
 * Role arbitre d'un serveur : destinataires des signalements de probleme
 * pousses par l'app web sur /internal/notify/referees. Une ligne par
 * serveur, definie par la commande /set-referee-role.
 */
export const REFEREE_ROLE_TABLE = `CREATE TABLE IF NOT EXISTS RefereeRole
          (
            id_guild TEXT PRIMARY KEY,
            id_role TEXT NOT NULL,
            set_by TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );
        `;

/**
 * Instantane de frequentation du site, pousse par l'app web sur
 * /internal/site-visits. Une seule ligne (id = 1) : le bot ne conserve
 * que la derniere mesure, l'historique restant du cote du site.
 */
export const SITE_VISIT_TABLE = `CREATE TABLE IF NOT EXISTS SiteVisit
          (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            total_visits INTEGER NOT NULL DEFAULT 0,
            unique_visitors INTEGER NOT NULL DEFAULT 0,
            visits_24h INTEGER NOT NULL DEFAULT 0,
            unique_24h INTEGER NOT NULL DEFAULT 0,
            visits_7d INTEGER NOT NULL DEFAULT 0,
            unique_7d INTEGER NOT NULL DEFAULT 0,
            visits_30d INTEGER NOT NULL DEFAULT 0,
            unique_30d INTEGER NOT NULL DEFAULT 0,
            identified_visitors INTEGER NOT NULL DEFAULT 0,
            first_visit_at DATETIME,
            last_visit_at DATETIME,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );
        `;

/**
 * Scrims et recherches de plus de 30 jours, repliés en nombres : ni
 * auteur, ni ordre, ni heure (voir `anonymizeActivityAuthors`).
 */
export const ACTIVITY_DAILY_TABLE = `CREATE TABLE IF NOT EXISTS ActivityDaily
          (
            kind TEXT NOT NULL,
            day TEXT NOT NULL,
            id_guild TEXT NOT NULL DEFAULT '',
            detail TEXT NOT NULL DEFAULT '',
            count INTEGER NOT NULL,
            PRIMARY KEY (kind, day, id_guild, detail)
          );
        `;

/**
 * Application Discord propriétaire de cette base (une ligne). Le
 * rattrapage des serveurs quittés s'y fie avant tout effacement : un bot
 * lancé avec un autre jeton sur cette base verrait un cache qui ne la
 * décrit pas, et oublierait tout le réseau.
 */
export const BOT_OWNER_TABLE = `CREATE TABLE IF NOT EXISTS BotOwner
          (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            application_id TEXT NOT NULL
          );
        `;
