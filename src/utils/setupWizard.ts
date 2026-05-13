import type { Client, Guild } from "discord.js";
import { sendLog } from "@/safe/sendLog.js";

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
