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

### GuildDelete

Is called when the bot leave a server. We remove in our database all the data of this server, then we log it in the owner DM and the admin channel of the BlueGenji

