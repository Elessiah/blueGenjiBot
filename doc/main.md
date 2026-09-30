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

### Data retention (ready + nightly cron)

`privacy/dataRetention.ts` runs at startup and in the existing 00:05 cron job. It erases the author of `/scrim` and `/recrute` rows older than 30 days (rows stay for counters), and forgets every server configured in the database that the bot is no longer in (`forgetGuild`, then its relayed channels) — Discord sends no `guildDelete` for a server left while the bot was offline, and this also finishes a `forgetGuild` that failed halfway. It does nothing if the guild cache is empty.

### GuildDelete

Is called when the bot leave a server. We first remove the server's configuration (`Bdd.forgetGuild`: invite link, referee role, bot admin role, modules, membership reminders and the rank filters of its channels), then its relayed channels and their services (`_resetServer`), and we log it in the owner DM and the admin channel of the BlueGenji

