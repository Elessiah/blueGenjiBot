import {Bdd, getBddInstance} from "../bdd/Bdd.js";
import {safeChannel} from "../safe/safeChannel.js";
import {regions} from "./globals.js";
import type {Client, Collection, FetchMessagesOptions, Message, TextChannel} from "discord.js";
import {sendLog} from "../safe/sendLog.js";
import {_resetChannel} from "../commandsHandlers/services/resetChannel.js";
import {ChannelPartnerService} from "../bdd/types.js";

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

    "# Tips: Using the different services properly\n" +
    " - `lfs`: If you are looking for a scrim.\n" +
    " - `lfp`: If you are looking for **players for your team to play tournaments and scrims**.\n" +
    " - `lfg`: If you are looking for **players to play ranked, quickplay, or chill with**.\n" +
    " - `lft`: If you are looking for **a team to play tournaments and scrims**.\n" +
    " - `lfsub`: If you are looking for a last-minute player for tournaments or scrims.\n" +
    " - `ta`: If you want to promote your tournament.\n" +
    " - `lfstaff`: If you are looking for staff for a team or organization, like a coach or admin.\n" +
    " - `lfcast`: If you are looking for casters to animate your tournament.\n\n" +
    "**FR 🇫🇷 : Utiliser correctement les différents services**\n" +
    " - `lfs` : Si tu cherches un scrim.\n" +
    " - `lfp` : Si tu cherches **des joueurs pour ta team (scrims ou tournois)**.\n" +
    " - `lfg` : Si tu cherches **des joueurs pour classé, rapide ou jouer chill**.\n" +
    " - `lft` : Si tu cherches **une team pour faire des tournois ou des scrims**.\n" +
    " - `lfsub` : Si tu cherches un joueur de dernière minute (scrim/tournoi).\n" +
    " - `ta` : Si tu veux faire la promo de ton tournoi.\n" +
    " - `lfstaff` : Si tu cherches du staff (coach, admin, etc).\n" +
    " - `lfcast` : Si tu cherches des casters pour ton tournoi.",

    "# Tips: More information = more efficiency\n" +
    "## The right service\n" +
    "Be aware of the different services that exist on the bot network (you can use `/help`) and be sure to use the right one!\n" +
    "Otherwise, you'll flood unrelated channels, reach the wrong audience, and your message will be useless — even for you.\n" +
    "## Rank\n" +
    "Many different ranks are looking for something — not just yours. Be sure to specify the **rank range you're looking for**!\n" +
    "## When?\n" +
    "Save time: write the **date and hour** directly in your message. It avoids back-and-forth with your future partner.\n" +
    "## Timezone\n" +
    "The bot network is international — 9pm is not the same everywhere. Always **mention your timezone**!\n" +
    "## Other details\n" +
    "Map pool? Rules? Anything relevant — **write it down** to attract the right people.\n\n" +
    "**FR 🇫🇷 : Plus d'infos = plus d'efficacité**\n" +
    "## Le bon service\n" +
    "Connaissez les différents services du bot (`/help`) et utilisez **le bon**, sinon vous spammez les autres et le message devient inutile.\n" +
    "## Rang\n" +
    "Beaucoup de joueurs cherchent des choses, pas que dans votre rang. **Précisez la plage de rang recherchée** !\n" +
    "## Quand ?\n" +
    "Gagnez du temps : indiquez **directement la date et l'heure**, ça évite les allers-retours.\n" +
    "## Fuseau horaire\n" +
    "Le réseau est mondial — **21h n’est pas la même heure pour tout le monde**. Précisez votre timezone !\n" +
    "## Autres détails\n" +
    "Map pool ? Règles ? Tout ce qui peut être utile — **écrivez-le** pour attirer les bonnes personnes.",

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
    "N’hésitez pas à venir me parler — mon Discord : `elessiah`.",

    "# Tips: Have an issue or a question? \n" +
    "Fill in a ticket here: https://bluegenjiesport.on.spiceworks.com/portal \n"+
    "**FR 🇫🇷 :** Un problème ? Une question ? Remplissez un ticket ici : https://bluegenjiesport.on.spiceworks.com/portal\n"
];


let tips: Tips;

/**
 * Retourne une astuce aléatoire adaptée au contexte d'utilisation.
 * @returns Instance singleton de `Tips` (créée au premier appel si nécessaire).
 */
function getTips(): Tips {
    if (!tips) {
        tips = Tips.create();
    }
    return tips;
}

/**
 * Prépare l'astuce suivante et met à jour l'index de rotation.
 * @param client Client Discord utilisé pour les appels API.
 * @param service Information de service à traiter.
 * @param region Index numérique de région (table `regions`).
 */
async function nextTips(client: Client,
                        service: string,
                        region: number): Promise<void> {
    const myTips = getTips();
    await myTips.nextTips(client, service, region);
}

class Tips {
    private messageCounter: number[][];
    private tipsRoller: number;

    /**
     * Initialise une nouvelle instance de la classe.
     */
    constructor() {
        this.messageCounter = new Array<number[]>();
        this.tipsRoller = 0;
    }

    /**
     * Instancie le gestionnaire de tips et initialise son état interne.
     * @returns Nouvelle instance de `Tips` prête à être utilisée.
     */
    static create(): Tips {
        return (new Tips());
    }

    /**
     * Prépare l'astuce suivante et met à jour l'index de rotation.
     * @param client Client Discord utilisé pour les appels API.
     * @param service Information de service à traiter.
     * @param region Index numérique de région (table `regions`).
     */
    async nextTips(client: Client,
                   service: string,
                   region: number): Promise<void> {
        if (!(regions[region] in this.messageCounter))
            this.messageCounter[regions[region]] = new Array<number>();
        const bdd: Bdd = await getBddInstance();
        if (!(service in this.messageCounter[regions[region]])) {
            this.messageCounter[regions[region]][service] = 0;
        }
        this.messageCounter[regions[region]][service] += 1;
        if (this.messageCounter[regions[region]][service] % 15 === 0) {
                const targets: ChannelPartnerService[] = await bdd.get(
                    "ChannelPartnerService",
                    ["*"],
                    {
                        "Service": "ChannelPartnerService.id_service = Service.id_service",
                        "ChannelPartner": "ChannelPartnerService.id_channel = ChannelPartner.id_channel",
                    },
                    {query: "Service.name = ?, ChannelPartner.region = ?", values: [service, region]}
                ) as ChannelPartnerService[];
                for (const target of targets) {
                    const channel: TextChannel = await client.channels.fetch(target.id_channel) as TextChannel;
                    if (channel == null) {
                        await sendLog(client, "Un channel a été perdu !");
                        await _resetChannel(client, target.id_channel);
                        continue;
                    }
                    if (!channel.messages)
                        continue;
                    const options: FetchMessagesOptions = {limit: 1};
                    // Force comme un gros bourin parce que TypeScript ne voit pas la deuxième surchargé de channel.messages.fetch();
                    const messages: Collection<unknown, Message<true>> = await channel.messages.fetch(options as FetchMessagesOptions) as unknown as Collection<unknown, Message<true>>;
                    const lastMessage = messages.first();
                    if (lastMessage == undefined || !(client.user && lastMessage.author.id === client.user.id && lastMessage.content.substring(0, 7) === "# Tips:")) {
                        await safeChannel(client, channel, undefined, [], messages[this.tipsRoller]);
                    }
                }
            this.tipsRoller++;
            if (this.tipsRoller === messages.length) {
                this.tipsRoller = 0;
            }
        }
    }
}

export {getTips, nextTips};


