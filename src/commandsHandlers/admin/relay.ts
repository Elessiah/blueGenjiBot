import { PermissionFlagsBits, ChannelType } from "discord.js";
import type { Client, ChatInputCommandInteraction, GuildMember, TextChannel } from "discord.js";
import { safeReply } from "@/safe/safeReply.js";
import { sendLog } from "@/safe/sendLog.js";
import { getBddInstance } from "@/bdd/Bdd.js";

export async function relay(client: Client, interaction: ChatInputCommandInteraction, guildId: string | null): Promise<void> {
  try {
    if (!guildId) {
      await safeReply(interaction, "Commande utilisable uniquement sur un serveur.", true, false);
      return;
    }
    const member = interaction.member as GuildMember | null;
    if (!member || !member.permissions.has(PermissionFlagsBits.Administrator)) {
      await safeReply(interaction, "Cette commande necessite la permission Administrateur.", true, false);
      return;
    }
    const channel = interaction.options.getChannel("channel", true);
    if (channel.type !== ChannelType.GuildText) {
      await safeReply(interaction, "Selectionnez un salon texte.", true, false);
      return;
    }
    const bdd = await getBddInstance();
    const existing = await bdd.get("ChannelPartner", ["id_channel"], {}, { query: "id_channel = ?", values: [channel.id] }) as { id_channel: string }[];
    if (existing.length > 0) {
      await bdd.rm("ChannelPartner", {}, { query: "id_channel = ?", values: [channel.id] });
      await bdd.rm("ChannelPartnerService", {}, { query: "id_channel = ?", values: [channel.id] });
      await safeReply(interaction, `Salon <#${channel.id}> retire des relais.`, true, false);
      await sendLog(client, `/relay: retire ${channel.id} du serveur ${guildId}`);
    } else {
      const status = await bdd.set("ChannelPartner", ["id_channel", "id_guild", "region"], [channel.id, guildId, 0]);
      if (!status.success) {
        await safeReply(interaction, "Echec de la configuration du relais.", true, false);
        return;
      }
      await safeReply(interaction, `Salon <#${channel.id}> configure comme relais (region: toutes). Utilisez /assign-channel pour assigner un service specifique.`, true, false);
      await sendLog(client, `/relay: ajoute ${channel.id} au serveur ${guildId}`);
    }
  } catch (err) {
    await sendLog(client, `relay handler error: ${(err as Error).message}`);
  }
}
