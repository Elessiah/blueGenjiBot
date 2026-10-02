import {Bdd, getBddInstance} from "../bdd/Bdd.js";
import {safeChannel} from "../safe/safeChannel.js";
import {regions} from "./globals.js";
import type {Client, Collection, FetchMessagesOptions, Message, TextChannel} from "discord.js";
import {sendLog} from "../safe/sendLog.js";
import {_resetChannel} from "../commandsHandlers/services/resetChannel.js";
import {ChannelPartnerService} from "../bdd/types.js";

/**
 * Astuces postées à tour de rôle. Une astuce = un gabarit : ses retours à la
 * ligne sont ceux du texte posté (ramenés à `\n` quel que soit le fichier), un
 * accent grave s'y échappe d'une barre oblique inverse, et une espace en fin de ligne s'écrit `\n`
 * sur la même ligne, faute de quoi un éditeur l'effacerait. Le texte posté est
 * fixé à l'octet près par `tips.test.ts`.
 */
const messages = [
    `# Tips: Setting Rank Filter
Is your server focused on a specific rank range?
Set the rank filter with the command: \`/edit-channel-filter-rank\`.
You'll then only receive messages targeting that rank range. You can still send messages to other ranks.

**FR 🇫🇷 :** Votre serveur est centré sur une plage de rangs précise ?
Utilisez la commande : \`/edit-channel-filter-rank\` pour définir le filtre de rang.
Vous ne recevrez alors que les messages ciblant cette plage. Vous pouvez toujours envoyer des messages vers d'autres rangs.`,

    `# Tips: Displaying Rank Filter
Using a channel linked to the bot but not sure which rank filter is applied?
Check the current filter with the command: \`/display-channel-filter-rank\`.

**FR 🇫🇷 :** Vous utilisez un salon lié au bot mais vous ne savez pas quel filtre de rang y est appliqué ?
Affichez le filtre actuel avec la commande : \`/display-channel-filter-rank\`.`,

    `# Tips: Using the Rank Filter Properly
Is the rank you entered sometimes not recognized? Make sure you use one of the following valid terms (case-insensitive):
 - **Bronze**: \`bronze\`
 - **Silver**: \`silver\`
 - **Platinum**: \`platinum\`, \`plat\`, \`platine\`, \`platinium\`
 - **Diamond**: \`diamond\`, \`diamant\`, \`diams\`, \`diam\`, \`d\`
 - **Grand Master**: \`grandmaster\`, \`grand master\`, \`grandmaitre\`, \`grand maitre\`, \`gm\`
 - **Celestial**: \`celestial\`, \`cel\`, \`cels\`, \`c\`, \`celeste\`, \`celest\`, \`celestia\`
 - **Eternal**: \`eternal\`, \`eternity\`, \`eternels\`, \`et\`
 - **One Above All**: \`oaa\`, \`oneaboveall\`, \`one above all\`, \`ooa\`

**FR 🇫🇷 :** Le rang que vous avez écrit n’est parfois pas détecté ? Assurez-vous d’utiliser une des variantes valides (insensible à la casse) :
(liste identique en français ci-dessus)`,

    `# Tips: Using the different services properly
 - \`lfs\`: If you are looking for a scrim.
 - \`lfp\`: If you are looking for **players for your team to play tournaments and scrims**.
 - \`lfg\`: If you are looking for **players to play ranked, quickplay, or chill with**.
 - \`lft\`: If you are looking for **a team to play tournaments and scrims**.
 - \`lfsub\`: If you are looking for a last-minute player for tournaments or scrims.
 - \`ta\`: If you want to promote your tournament.
 - \`lfstaff\`: If you are looking for staff for a team or organization, like a coach or admin.
 - \`lfcast\`: If you are looking for casters to animate your tournament.

**FR 🇫🇷 : Utiliser correctement les différents services**
 - \`lfs\` : Si tu cherches un scrim.
 - \`lfp\` : Si tu cherches **des joueurs pour ta team (scrims ou tournois)**.
 - \`lfg\` : Si tu cherches **des joueurs pour classé, rapide ou jouer chill**.
 - \`lft\` : Si tu cherches **une team pour faire des tournois ou des scrims**.
 - \`lfsub\` : Si tu cherches un joueur de dernière minute (scrim/tournoi).
 - \`ta\` : Si tu veux faire la promo de ton tournoi.
 - \`lfstaff\` : Si tu cherches du staff (coach, admin, etc).
 - \`lfcast\` : Si tu cherches des casters pour ton tournoi.`,

    `# Tips: More information = more efficiency
## The right service
Be aware of the different services that exist on the bot network (you can use \`/help\`) and be sure to use the right one!
Otherwise, you'll flood unrelated channels, reach the wrong audience, and your message will be useless — even for you.
## Rank
Many different ranks are looking for something — not just yours. Be sure to specify the **rank range you're looking for**!
## When?
Save time: write the **date and hour** directly in your message. It avoids back-and-forth with your future partner.
## Timezone
The bot network is international — 9pm is not the same everywhere. Always **mention your timezone**!
## Other details
Map pool? Rules? Anything relevant — **write it down** to attract the right people.

**FR 🇫🇷 : Plus d'infos = plus d'efficacité**
## Le bon service
Connaissez les différents services du bot (\`/help\`) et utilisez **le bon**, sinon vous spammez les autres et le message devient inutile.
## Rang
Beaucoup de joueurs cherchent des choses, pas que dans votre rang. **Précisez la plage de rang recherchée** !
## Quand ?
Gagnez du temps : indiquez **directement la date et l'heure**, ça évite les allers-retours.
## Fuseau horaire
Le réseau est mondial — **21h n’est pas la même heure pour tout le monde**. Précisez votre timezone !
## Autres détails
Map pool ? Règles ? Tout ce qui peut être utile — **écrivez-le** pour attirer les bonnes personnes.`,

    `# Tips: Setting Region Filter
Not happy with the current region filter?
Change it using the command: \`/edit-channel-filter-region\`.
You'll then receive messages targeting that region. You can still send messages to other regions using keywords like: \`EU\`, \`NA\`, \`LATAM\`, \`ASIA\`.

**FR 🇫🇷 :** Le filtre de région actuel ne vous convient pas ?
Changez-le avec la commande : \`/edit-channel-filter-region\`.
Vous recevrez alors uniquement les messages ciblant cette région. Vous pouvez toujours envoyer vers d’autres régions avec les mots-clés : \`EU\`, \`NA\`, \`LATAM\`, \`ASIA\`.`,

    `# Tips: Displaying Region Filter
Not sure what the current region filter is?
Check it using the command: \`/display-channel-filter-region\`.

**FR 🇫🇷 :** Vous ne savez pas quel est le filtre de région actuel ?
Affichez-le avec la commande : \`/display-channel-filter-region\`.`,

    `# Tips: Adding the Bot to Your Server
Want to have the bot on your server and customize it as you wish?
Use the link in its bio to invite it.

**FR 🇫🇷 :** Vous souhaitez ajouter le bot à votre serveur et le personnaliser ?
Utilisez le lien dans sa bio pour l'inviter.`,

    `# Tips: Moderation
Are you an admin of a server with more than 50 members and noticed bad behavior in the bot network (spam, insults, scams...)?
If the user is on your server, use \`/ban-user-of-this-server\` and select the user.
If the user is from another partner server, use \`/ban-user-of-another-server\` and enter the username (found at the top of the bot's message).

**FR 🇫🇷 :** Vous êtes admin d’un serveur avec plus de 50 membres et vous remarquez un comportement abusif sur le réseau du bot (spam, insultes, arnaques…) ?
Si l’utilisateur est sur votre serveur, utilisez \`/ban-user-of-this-server\` et sélectionnez-le.
S’il vient d’un autre serveur partenaire, utilisez \`/ban-user-of-another-server\` et saisissez son pseudo (en haut du message du bot).`,

    `# Tips: Got an Idea or a Question?
Contact me on Discord: \`elessiah\`.

**FR 🇫🇷 :** Vous avez une idée ou une question ? Contactez-moi sur Discord : \`elessiah\`.`,

    `# Tips: Need to Talk?
Feeling lonely? Depressed? Or just want to chat?
Don't hesitate to reach out — my Discord: \`elessiah\`.

**FR 🇫🇷 :** Vous vous sentez seul ? Déprimé ? Ou vous voulez juste discuter ?
N’hésitez pas à venir me parler — mon Discord : \`elessiah\`.`,

    `# Tips: Have an issue or a question? \nFill in a ticket here: https://bluegenjiesport.on.spiceworks.com/portal \n**FR 🇫🇷 :** Un problème ? Une question ? Remplissez un ticket ici : https://bluegenjiesport.on.spiceworks.com/portal\n`,
];


/** Une astuce toutes les `TIPS_EVERY` annonces d'un même service dans une même région. */
const TIPS_EVERY = 15;

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
    /** Annonces comptées par région puis par service. */
    private readonly messageCounter: Map<string, Map<string, number>>;
    private tipsRoller: number;

    /**
     * Initialise une nouvelle instance de la classe.
     */
    constructor() {
        this.messageCounter = new Map();
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
     * Compte une annonce et, toutes les `TIPS_EVERY` annonces d'un même service
     * dans une même région, poste l'astuce suivante dans les salons relayés
     * de cette région, puis avance la rotation.
     * @param client Client Discord utilisé pour les appels API.
     * @param service Information de service à traiter.
     * @param region Index numérique de région (table `regions`).
     */
    async nextTips(client: Client,
                   service: string,
                   region: number): Promise<void> {
        const count = this.countAnnouncement(service, region);
        const bdd: Bdd = await getBddInstance();
        if (count % TIPS_EVERY !== 0) {
            return;
        }
        const targets: ChannelPartnerService[] = await bdd.get(
            "ChannelPartnerService",
            ["*"],
            {
                "Service": "ChannelPartnerService.id_service = Service.id_service",
                "ChannelPartner": "ChannelPartnerService.id_channel = ChannelPartner.id_channel",
            },
            {query: "Service.name = ? AND ChannelPartner.region = ?", values: [service, region]}
        ) as ChannelPartnerService[];
        for (const target of targets) {
            await this.postTip(client, target.id_channel);
        }
        this.tipsRoller = (this.tipsRoller + 1) % messages.length;
    }

    /**
     * Compte une annonce de `service` dans `region`.
     * @returns Le nombre d'annonces comptées, celle-ci comprise.
     */
    private countAnnouncement(service: string, region: number): number {
        let counters = this.messageCounter.get(regions[region]);
        if (!counters) {
            counters = new Map();
            this.messageCounter.set(regions[region], counters);
        }
        const count: number = (counters.get(service) ?? 0) + 1;
        counters.set(service, count);
        return count;
    }

    /**
     * Poste l'astuce courante dans un salon, sauf si son dernier message est
     * déjà une astuce du bot. Un salon disparu est retiré de la base.
     * @param client Client Discord utilisé pour les appels API.
     * @param channelId Salon relayé.
     */
    private async postTip(client: Client, channelId: string): Promise<void> {
        const channel: TextChannel = await client.channels.fetch(channelId) as TextChannel;
        if (channel == null) {
            await sendLog(client, "Un channel a été perdu !");
            await _resetChannel(client, channelId);
            return;
        }
        if (!channel.messages)
            return;
        const options: FetchMessagesOptions = {limit: 1};
        // Force comme un gros bourin parce que TypeScript ne voit pas la deuxième surchargé de channel.messages.fetch();
        const fetchedMessages: Collection<unknown, Message<true>> = await channel.messages.fetch(options as FetchMessagesOptions) as unknown as Collection<unknown, Message<true>>;
        const lastMessage = fetchedMessages.first();
        if (lastMessage == undefined || !(lastMessage.author.id === client.user?.id && lastMessage.content.startsWith("# Tips:"))) {
            await safeChannel(client, channel, undefined, [], messages[this.tipsRoller]);
        }
    }
}

export {getTips, nextTips};
