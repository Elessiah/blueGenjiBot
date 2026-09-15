import type {Attachment, Client, Message, TextChannel} from "discord.js";
import {EmbedBuilder} from "discord.js";

import {escapeLinkLabel} from "../utils/escapeLinkLabel.js";
import {getInviteFromMessage} from "../utils/getInviteFromMessage.js";

/**
 * Construit le contenu final (texte et embeds) à publier pour un service.
 * @param client Client Discord utilisé pour les appels API.
 * @param message Message Discord d'origine à transformer en embed.
 * @param channelId Identifiant du salon d'origine du message.
 * @param attachement Pièce jointe optionnelle à intégrer à l'embed.
 * @returns Embed final prêt à être diffusé, avec auteur, contenu, lien d'origine et image si pièce jointe.
 */
async function buildServiceMessage(client: Client,
                                   message: Message,
                                   channelId: string,
                                   attachement?: Attachment): Promise<EmbedBuilder> {
    const channelOG = await client.channels.fetch(channelId) as TextChannel;
    // Le nom du serveur source est choisi par son propriétaire et sert de
    // libellé au lien relayé à tous les partenaires : un crochet ou une
    // parenthèse y referme le lien et en ouvre un autre, vers l'adresse de
    // son choix, sous le nom du bot et sur chaque serveur destinataire.
    const originName: string = escapeLinkLabel(channelOG.guild.name);
    const origin: string = "*Sent from : [" + originName + "](" + await getInviteFromMessage(client, message) + ")*";
    let embed: EmbedBuilder;
    if (attachement) {
        embed = new EmbedBuilder().setAuthor({
            name: `${message.author.username}`,
            iconURL: message.author.displayAvatarURL(),
        }).setDescription(message.content + "\n\n" + origin + ` by ${message.author}`).setImage(attachement.url);
    } else {
        embed = new EmbedBuilder().setAuthor({
            name: `${message.author.username}`,
            iconURL: message.author.displayAvatarURL(),
        }).setDescription(message.content + `\n\n` + origin + ` by ${message.author}`);
    }
    return embed;
}

export {buildServiceMessage};
