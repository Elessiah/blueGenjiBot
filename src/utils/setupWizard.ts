/**
 * Message de bienvenue envoye au proprietaire d'un serveur qui vient d'ajouter le bot.
 *
 * Un DM au proprietaire plutot qu'un message dans un salon : le bot n'a pas
 * encore de salon designe a l'arrivee sur un nouveau serveur, et le
 * proprietaire est la seule personne garantie de recevoir l'information sans
 * configuration prealable.
 */

import type { Client, Guild } from "discord.js";
import { sendLog } from "@/safe/sendLog.js";

/**
 * @param guild Serveur qui vient d'accueillir le bot.
 * @param client Client Discord, utilise pour journaliser un echec d'envoi.
 */
export async function runSetupWizard(guild: Guild, client: Client): Promise<void> {
  try {
    const owner = await guild.fetchOwner();
    const lines = [
      `**Bienvenue sur BlueGenji Bot, ${guild.name} !**`,
      "",
      "Modules disponibles : Annonces, Scrims, Recrutement, Notifications, Stats. Tous sont actifs par defaut.",
      "",
      "Commandes essentielles :",
      "- `/config <module>` : activer / desactiver un module",
      "- `/relay <channel>` : configurer un salon de relais inter-serveurs",
      "- `/assign-channel` : assigner un service partenaire a un salon",
      "- `/help fr` : voir toutes les commandes",
      "",
      "Le module OAuth (liaison Discord <-> site BlueGenji) est toujours actif."
    ];
    await owner.send(lines.join("\n"));
    await sendLog(client, `Wizard setup envoye au proprietaire de ${guild.name} (${guild.id}).`);
  } catch (err) {
    await sendLog(client, `Wizard setup ${guild.name}: echec DM proprietaire (${(err as Error).message}).`);
  }
}
