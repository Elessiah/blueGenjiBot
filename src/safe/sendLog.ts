import type {Client, TextChannel, User} from "discord.js";
import {idSendLogMsg} from "./types.js";

/**
 * Envoie un log technique vers le canal de supervision.
 * @param client Client Discord utilisé pour les appels API.
 * @param message Contenu du log à envoyer aux canaux owner/admin.
 * @param idMsg Objet optionnel recevant les IDs des messages de log envoyés (owner/admin).
 * @returns `true` dès qu'un envoi de log aboutit; `false` si les tentatives échouent ou si le canal admin est inaccessible.
 */
async function sendLog(client: Client,
                       message: string = "Error",
                       idMsg?: idSendLogMsg) : Promise<boolean> {
    let nTry: number = 0;
    let success: boolean = false;
    while (nTry < 3 && !success) {
        try {
            const owner: User = await client.users.fetch(process.env.OWNER_ID as string);
            if (idMsg) {
                idMsg.owner = (await owner.send(message)).id;
            }
            try {
                const admin_channel: TextChannel | null = await client.channels.fetch(process.env.INFO_SERV as string) as TextChannel;
                if (!admin_channel)
                    return false;
                if (idMsg) {
                    idMsg.admin = (await admin_channel.send(message)).id;
                } else {
                    await admin_channel.send(message);
                }
            } catch (error) {
                if ((error as TypeError).message == "Missing Access")
                    owner.send("Missing Access to admin channel");
            }
            success = true;
        } catch (error) {
            console.error("Erreur while sending to the owner : ", (error as TypeError).message);
        }
        nTry++;
    }
    return (success)
}

export { sendLog };
