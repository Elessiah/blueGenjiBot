const { getBddInstance } = require("../bdd/Bdd");
const safeChannel = require("../safe/safeChannel");
const {regions} = require("./globals");

const messages = [
    "# Tips: Setting Rank Filter\n" +
    "Is your server focused on a specific rank range?\n" +
    "Set the rank filter with the command: `/edit-channel-filter-rank`.\n" +
    "You'll then only receive messages targeting that rank range. You can still send messages to other ranks.\n\n" +
    "**FR 🇫🇷 :** Votre serveur est centré sur une plage de rangs précise ?\n" +
    "Utilisez la commande : `/edit-channel-filter-rank` pour définir le filtre de rang.\n" +
    "Vous ne recevrez alors que les messages ciblant cette plage. Vous pouvez toujours envoyer des messages vers d'autres rangs.",

    "# Tips: Displaying Rank Filter\n" +
    "Using a channel linked to the bot but not sure which rank filter is applied?\n" +
    "Check the current filter with the command: `/display-channel-filter-rank`.\n\n" +
    "**FR 🇫🇷 :** Vous utilisez un salon lié au bot mais vous ne savez pas quel filtre de rang y est appliqué ?\n" +
    "Affichez le filtre actuel avec la commande : `/display-channel-filter-rank`.",

    "# Tips: Using the Rank Filter Properly\n" +
    "Is the rank you entered sometimes not recognized? Make sure you use one of the following valid terms (case-insensitive):\n" +
    " - **Bronze**: `bronze`\n" +
    " - **Silver**: `silver`\n" +
    " - **Platinum**: `platinum`, `plat`, `platine`, `platinium`\n" +
    " - **Diamond**: `diamond`, `diamant`, `diams`, `diam`, `d`\n" +
    " - **Grand Master**: `grandmaster`, `grand master`, `grandmaitre`, `grand maitre`, `gm`\n" +
    " - **Celestial**: `celestial`, `cel`, `cels`, `c`, `celeste`, `celest`, `celestia`\n" +
    " - **Eternal**: `eternal`, `eternity`, `eternels`, `et`\n" +
    " - **One Above All**: `oaa`, `oneaboveall`, `one above all`, `ooa`\n\n" +
    "**FR 🇫🇷 :** Le rang que vous avez écrit n’est parfois pas détecté ? Assurez-vous d’utiliser une des variantes valides (insensible à la casse) :\n" +
    "(liste identique en français ci-dessus)",

    "# Tips: Setting Region Filter\n" +
    "Not happy with the current region filter?\n" +
    "Change it using the command: `/edit-channel-filter-region`.\n" +
    "You'll then receive messages targeting that region. You can still send messages to other regions using keywords like: `EU`, `NA`, `LATAM`, `ASIA`.\n\n" +
    "**FR 🇫🇷 :** Le filtre de région actuel ne vous convient pas ?\n" +
    "Changez-le avec la commande : `/edit-channel-filter-region`.\n" +
    "Vous recevrez alors uniquement les messages ciblant cette région. Vous pouvez toujours envoyer vers d’autres régions avec les mots-clés : `EU`, `NA`, `LATAM`, `ASIA`.",

    "# Tips: Displaying Region Filter\n" +
    "Not sure what the current region filter is?\n" +
    "Check it using the command: `/display-channel-filter-region`.\n\n" +
    "**FR 🇫🇷 :** Vous ne savez pas quel est le filtre de région actuel ?\n" +
    "Affichez-le avec la commande : `/display-channel-filter-region`.",

    "# Tips: Adding the Bot to Your Server\n" +
    "Want to have the bot on your server and customize it as you wish?\n" +
    "Use the link in its bio to invite it.\n\n" +
    "**FR 🇫🇷 :** Vous souhaitez ajouter le bot à votre serveur et le personnaliser ?\n" +
    "Utilisez le lien dans sa bio pour l'inviter.",

    "# Tips: Moderation\n" +
    "Are you an admin of a server with more than 50 members and noticed bad behavior in the bot network (spam, insults, scams...)?\n" +
    "If the user is on your server, use `/ban-user-of-this-server` and select the user.\n" +
    "If the user is from another partner server, use `/ban-user-of-another-server` and enter the username (found at the top of the bot's message).\n\n" +
    "**FR 🇫🇷 :** Vous êtes admin d’un serveur avec plus de 50 membres et vous remarquez un comportement abusif sur le réseau du bot (spam, insultes, arnaques…) ?\n" +
    "Si l’utilisateur est sur votre serveur, utilisez `/ban-user-of-this-server` et sélectionnez-le.\n" +
    "S’il vient d’un autre serveur partenaire, utilisez `/ban-user-of-another-server` et saisissez son pseudo (en haut du message du bot).",

    "# Tips: Got an Idea or a Question?\n" +
    "Contact me on Discord: `elessiah`.\n\n" +
    "**FR 🇫🇷 :** Vous avez une idée ou une question ? Contactez-moi sur Discord : `elessiah`.",

    "# Tips: Need to Talk?\n" +
    "Feeling lonely? Depressed? Or just want to chat?\n" +
    "Don't hesitate to reach out — my Discord: `elessiah`.\n\n" +
    "**FR 🇫🇷 :** Vous vous sentez seul ? Déprimé ? Ou vous voulez juste discuter ?\n" +
    "N’hésitez pas à venir me parler — mon Discord : `elessiah`."
];


let tips;

async function getTips() {
    if (!tips) {
        tips = await Tips.create();
    }
    return tips;
}

async function nextTips(client, services, region) {
    const myTips = await getTips();
    await myTips.nextTips(client, services, region);
}

class Tips {
    constructor() {
        this.messageCounter = {};
        this.tipsRoller = 0;
    }

    static async create() {
        return (new Tips());
    }

    async nextTips(client, services, region) {
        if (!(regions[region] in this.messageCounter))
            this.messageCounter[regions[region]] = {};
        const bdd = await getBddInstance();
        for (const service of services) {
            if (!(service in this.messageCounter[regions[region]])) {
                this.messageCounter[regions[region]][service] = 0;
            }
            this.messageCounter[regions[region]][service] += 1;
            if (this.messageCounter[regions[region]][service] % 10 === 0) {
                    const targets = await bdd.get(
                        "ChannelPartnerService",
                        ["*"],
                        {
                            "Service": "ChannelPartnerService.id_service = Service.id_service",
                            "ChannelPartner": "ChannelPartnerService.id_channel = ChannelPartner.id_channel",
                        },
                        {"Service.name": service, "ChannelPartner.region": region}
                    );
                    for (const target of targets) {
                        const channel = await client.channels.fetch(target.id_channel);
                        const lastMessage = (await channel.messages.fetch({limit: 1})).first();
                        if (lastMessage == undefined || !(lastMessage.author.id === client.user.id && lastMessage.content.substring(0, 7) === "# Tips:")) {
                            await safeChannel(client, channel, null, [], messages[this.tipsRoller]);
                        }
                    }
                this.tipsRoller++;
                if (this.tipsRoller === messages.length) {
                    this.tipsRoller = 0;
                }
            }
        }
    }
}

module.exports = {getTips, nextTips};