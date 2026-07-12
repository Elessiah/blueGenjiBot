import type {Client, Message, TextChannel} from "discord.js";
import {PermissionsBitField} from "discord.js";
import {getInviteFromChannel} from "./getInviteFromChannel.js";
import {getBddInstance} from "../bdd/Bdd.js";
import {sendLog} from "@/safe/sendLog.js";

/**
 * Extrait un lien d'invitation à partir d'un message.
 * Priorise le lien d'invitation personnalisé du serveur (autoritaire, configuré par un admin) :
 * il court-circuite la vérification de permission `CreateInstantInvite` de l'auteur du message.
 * @param client Client Discord utilisé pour les appels API.
 * @param message Message dont le salon sert de base pour récupérer/créer une invitation.
 * @returns URL d'invitation du salon source, ou chaîne vide si impossible (permissions/canal/erreur).
 */
async function getInviteFromMessage(client: Client,
                                    message: Message) {
    try {
        if (!message.channel.isTextBased()) {
            return ("");
        }
        const channel: TextChannel = message.channel as TextChannel;
        if (!channel) {
            return ("");
        }
        if (channel.guild) {
            const customInvite = await (await getBddInstance()).getServerInvite(channel.guild.id);
            if (customInvite) {
                return customInvite;
            }
        }
        const permissions = channel.permissionsFor(message.author);
        if (!permissions) {
            return ("");
        }
        if (!permissions.has(PermissionsBitField.Flags.CreateInstantInvite)) {
            return ("");
        }
        return await getInviteFromChannel(client, channel);
    } catch (e) {
        await sendLog(client, "(getInviteFromMessage)Erreur pour : " + message.content + "\nMessage d'erreur : \n" + (e as TypeError).message);
        return ("");
    }
}

export { getInviteFromMessage }

