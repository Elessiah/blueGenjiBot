import type { Client, Message, MessageReaction, PartialMessage } from "discord.js";
import { classifyError, describeError } from "./errorGuards.js";
import { sendLog } from "./sendLog.js";

/**
 * Ajoute une réaction à un message sans jamais lever.
 *
 * Un utilisateur qui supprime son message juste après l'avoir posté fait
 * échouer la réaction avec un `DiscordAPIError[10008] Unknown Message`. Le cas
 * est normal côté produit et ne doit ni interrompre la diffusion en cours ni
 * réveiller le canal de supervision.
 *
 * @param client Client Discord utilisé pour les appels API.
 * @param message Message à réagir (éventuellement partiel, comme sur `messageUpdate`).
 * @param emoji Émoji de la réaction.
 * @returns La réaction créée, ou `null` si le message n'est plus joignable.
 */
async function safeReact(
    client: Client,
    message: Message | PartialMessage,
    emoji: string,
): Promise<MessageReaction | null> {
    try {
        return await message.react(emoji);
    } catch (error) {
        if (classifyError(error) === "fatal") {
            await sendLog(client, `safeReact (${emoji}) : ${describeError(error)}`);
        } else {
            console.error(`safeReact (${emoji}) : ${describeError(error)}`);
        }
        return null;
    }
}

export { safeReact };
