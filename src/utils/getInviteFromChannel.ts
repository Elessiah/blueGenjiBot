import type {Client, TextChannel} from "discord.js";

import {getBddInstance} from "../bdd/Bdd.js";

/**
 * Récupère l'invitation à utiliser pour un salon donné.
 * Priorise le lien d'invitation personnalisé configuré pour le serveur (via `/set-server-invite`);
 * à défaut, récupère ou crée une invitation permanente sur le salon.
 * @param client Client Discord utilisé pour les appels API.
 * @param channel Salon cible.
 * @returns URL d'invitation (custom en priorité, sinon permanente du salon), ou chaîne vide en cas d'échec.
 */
async function getInviteFromChannel(client: Client, channel: TextChannel): Promise<string> {
    try {
        const bdd = await getBddInstance();
        const customInvite = await bdd.getServerInvite(channel.guild.id);
        if (customInvite) {
            return customInvite;
        }

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
