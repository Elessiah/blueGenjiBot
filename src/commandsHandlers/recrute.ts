/**
 * Handler de `/recrute` : publie une recherche d'equipe ou de staff, pour
 * Marvel Rivals uniquement (comme toutes les recherches du bot).
 *
 * Verifie le module "recrutement" avant d'ecrire, sinon un serveur qui l'a
 * desactive verrait quand meme des entrees s'accumuler en base et remonter
 * dans les stats — desactiver un module doit couper l'ecriture, pas juste
 * l'affichage.
 */

import type { Client, ChatInputCommandInteraction } from "discord.js";
import { safeReply } from "../safe/safeReply.js";
import { sendLog } from "../safe/sendLog.js";
import { getBddInstance } from "../bdd/Bdd.js";
import { recordEvent } from "../feed/feedBus.js";
import { isModuleEnabled } from "../modules/moduleGuard.js";
import { choiceLabel, RECRUIT_ROLE_CHOICES } from "../config/searchChoices.js";

/**
 * @param client Client Discord, utilise pour le feed d'evenements et les logs.
 * @param interaction Interaction `/recrute` (option `role` requise).
 * @param guildId Serveur d'origine ; `null` en DM, auquel cas le module n'est pas verifie.
 */
export async function recrute(client: Client, interaction: ChatInputCommandInteraction, guildId: string | null): Promise<void> {
  try {
    const role = interaction.options.getString("role", true);
    const label = choiceLabel(RECRUIT_ROLE_CHOICES, role);
    if (label === null) {
      // Client resté sur l'ancienne définition (texte libre) : rien n'est écrit.
      await safeReply(interaction, "Role inconnu : choisis-le dans la liste proposee par la commande.", true, false);
      return;
    }
    if (guildId && !(await isModuleEnabled(guildId, "recrutement"))) {
      await safeReply(interaction, "Le module Recrutement est desactive sur ce serveur.", true, false);
      return;
    }
    const bdd = await getBddInstance();
    const status = await bdd.set("Recrute", ["id_author", "role", "id_guild"], [interaction.user.id, role, guildId]);
    if (!status.success) {
      await safeReply(interaction, "Erreur lors de l'enregistrement de la recherche.", true, false);
      return;
    }
    await recordEvent(client, "recr", `Recherche ${label}`, interaction.guild?.name ?? null, null);
    await safeReply(interaction, `Recherche publiee : **${label}**.`, false, false);
  } catch (err) {
    await sendLog(client, `recrute handler error: ${(err as Error).message}`);
  }
}
