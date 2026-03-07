import type {Client, TextChannel} from "discord.js";

/**
 * Récupère ou crée une invitation valide pour un salon donné.
 * @param client Client Discord utilisé pour les appels API.
 * @param channel Salon cible.
 * @returns URL d'invitation permanente du serveur, ou chaîne vide si la récupération/création échoue.
 */
async function getInviteFromChannel(client: Client, channel: TextChannel): Promise<string> {
    try {
        const invites = await channel.guild.invites.fetch();

        let existing = invites.find(inv =>
            inv.maxAge === 0 &&
            inv.maxUses === 0
        );

        if (!existing) {
            existing = await channel.createInvite({
                maxAge: 0,
                maxUses: 0,
                unique: false
            });
        }

        return existing.url;
    } catch (error) {
        console.log("Erreur getInviteFromChannel: ", (error as TypeError).message);
        return "";
    }
}

export {getInviteFromChannel};
