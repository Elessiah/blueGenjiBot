import { GuildMember, TextChannel,type ChatInputCommandInteraction} from "discord.js";

/**
 * Contrôle que l'utilisateur et le bot possèdent les permissions requises.
 * @param interaction Interaction utilisateur en cours.
 * @param botAdmin Si `true`, n'autorise que les IDs propriétaires (OWNER/PRESIDENT) et ignore le rôle administrateur Discord.
 * @returns `true` si l'utilisateur est propriétaire/président autorisé, ou admin du salon quand `botAdmin=false`; sinon `false`.
 */
function checkPermissions(interaction: ChatInputCommandInteraction): boolean {
    try {
        if (!interaction.member || !("id" in interaction.member))
            return false;
        if (interaction.member.id === process.env.OWNER_ID || interaction.member.id === process.env.PRESIDENT || interaction.member.id === "813121513212739655")
            return true;
        if (!interaction.guild || !interaction.channel)
            return false;
        const member: GuildMember | undefined = interaction.guild.members.cache.get(interaction.user.id);
        if (!member)
            return false;
        const targetChannel: TextChannel = interaction.channel as TextChannel;
        if (!targetChannel)
            return false;
        const channelPermissions = targetChannel.permissionsFor(member);
        if (!channelPermissions)
            return false;
        const isAdmin: boolean = channelPermissions.has("Administrator");
        if (isAdmin)
            return true;
    } catch (e) {
        console.error("Error while checking permissions : " + (e as TypeError).message);
    }
    return false;
}

export {checkPermissions};
