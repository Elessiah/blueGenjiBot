import { Attachment, AttachmentBuilder, ChatInputCommandInteraction, Client, GuildMember, MessageFlags } from "discord.js";
import { safeReply } from "@/safe/safeReply.js";
import { safeUser } from "@/safe/safeUser.js";
import { setupIntervalAdhesion } from "@/adhesion/setupIntervalAdhesion.js";
import { checkPermissions } from "@/check/checkPermissions.js";

async function adhesionValide(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const user: GuildMember | null = interaction.options.getMember("user") as GuildMember | null;
    if (!checkPermissions(interaction))
        return;
    if (!user) {
        await safeReply(interaction, "Membre non trouvé");
        return;
    }
    const strDatePeremption: string = interaction.options.getString("date-peremption", true);
    const [day, month, year] = strDatePeremption.split("/");
    const datePeremption = new Date(`${year}-${month}-${day}T00:00:00Z`);
    const adhesion: Attachment | null = interaction.options.getAttachment("adhesion");
    let messageValide: string | null = interaction.options.getString("message-valide");
    if (!messageValide) {
        messageValide = "Votre adhésion BlueGenji a été validée. Merci d'avoir rejoint l'association !";
    }
    let messagePerimee: string | null = interaction.options.getString("message-perimee");
    if (!messagePerimee) {
        messagePerimee = "Votre adhésion BlueGenji a périmée. Merci de renouveler votre adhésion si vous souhaitez continuer à être membre de l'association!";
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (await safeUser(client, user.user, undefined, adhesion ? [new AttachmentBuilder(adhesion.url)] : undefined, messageValide)) {
        await interaction.followUp({ content: user.user.globalName + " a été prévenu avec succès !", flags: MessageFlags.Ephemeral });
    } else {
        await interaction.followUp({ content: "Erreur lors de l'envoi du message à " + user.user.globalName + " ! Essaie de nouveau s'il te plait.", ephemeral: true });
        return;
    }

    await setupIntervalAdhesion(client, interaction, messagePerimee, null, user, null, 0, datePeremption, 1);
}

export {adhesionValide};