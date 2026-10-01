# Main.js

## General

It's the main file of the project. For the moment it manages all the
client listeners.

## Client

The client represent the bot. The intents are very important because they allow the bot
to receive the server events(*Guilds*), manage the message(*GuildMessage*) and access to 
the content of the message(*MessageContent*).

`client.login()` link the program to the bot register in the Discord Developper Portal.

A getter has been set `getClientInstance` but for the moment there is no usage. It's export at the end of the file in case of need.

## Listeners

### InteractionCreate

Is called when a command of the application is sent.

After verification of the parameter, the function get from command's array. If the command is find in it the handler of the command is called.
*(Read `src/commands`)*.

### MessageCreate

Is called when a message is sent in a channel where the bot has access.

After excluding the no-human message, we check if the channel where message has been send is link to any service by 
asking the database. If yes, `services.length` is greater than 0 so we distribute the message to all the linked 
channels. *(read `src/manageDistribution.`)*.

### Ready

Is called when the bot is ready.

We update the commands of the server the bot has joined in case of edit of the command list. 
*(read `src/updateCommands`)*.

The new status is then send to the bot owner where the id is set in the `env`.

### GuildCreate

Is called when the bot join a server.

We begin by applying the commands to the new server, then we log the event in owner DM and the admin channel of blueGenji define 
in the `env` under `INFO_SERV`.

### Data retention (ready, nightly cron, after a backup restore)

`privacy/dataRetention.ts` runs at startup, in the existing 00:05 cron job and after a successful `/restore-backup`. It catches up the 7-day purge of relayed messages (otherwise only triggered by a new relay), folds `/scrim` and `/recrute` rows older than 30 days into anonymous per-day counts (`ActivityDaily`: day, server, level or role — no author, time or order) — after first mapping the levels and roles typed as free text before the closed choices (in `Scrim`, `Recrute` and `ActivityDaily`) onto the choice they name exactly, case and accents aside, and anything else onto the "unspecified" bucket (`''`), merging the per-day counts that end up under the same key (`normalizeLegacyActivityDetails`, idempotent) — and forgets every server configured in the database that the bot is no longer in (`eraseGuild`: `forgetGuild`, then its relayed channels) — Discord sends no `guildDelete` for a server left while the bot was offline, and this also finishes a `forgetGuild` that failed halfway. The server catch-up (and only it) does nothing before the client is ready (an empty cache once ready means the bot is in no server any more, and everything is forgotten), and does nothing — with a log line — when the database belongs to another Discord application (`BotOwner`: the first application to start on a database claims it), e.g. a bot started with a development token on the production database. After a restore, the feed identifier purge is re-run too, so a restored backup cannot bring Discord IDs back to the public feed.

It also deletes activity feed events (`FeedEvent`) older than 30 days, the bot's own messages older than one year in the staff's private log channel (`INFO_SERV`) and in its private messages to `OWNER_ID` — except the notice and reason of a ban still in force, which `/unban` deletes when the ban is lifted (`privacy/staffLogRetention.ts`, at most 500 deletions per pass, the next night resumes) — and the `database.sqlite.avant-<date>` copies left by `/restore-backup` once older than 30 days (a successful restore also deletes every earlier copy).

### GuildDelete

Is called when the bot leave a server. If the database belongs to this Discord application (`BotOwner`, see above), we first remove the server's configuration (`Bdd.forgetGuild`: invite link, referee role, bot admin role, modules and membership reminders), then its relayed channels, their rank filters and their services (`Bdd.deleteGuildChannels`) — both through `eraseGuild`, the same path as the startup catch-up, and we log it in the owner DM and the admin channel of the BlueGenji

