import type { Client, TextChannel } from "discord.js";
/**
 *
 * @param client
 * @param channel
 * @return string Retourne un message d'erreur. Si rien, pas d'erreur.
 */
declare function checkChannelMinPermissions(client: Client, channel: TextChannel): Promise<string>;
export { checkChannelMinPermissions };
//# sourceMappingURL=checkChannelMinPermissions.d.ts.map