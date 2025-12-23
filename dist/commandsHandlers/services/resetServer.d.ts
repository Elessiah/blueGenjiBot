import { type ChatInputCommandInteraction, type Client } from "discord.js";
import { status } from "../../types.js";
declare function _resetServer(client: Client, guild_id: string): Promise<status>;
declare function resetServer(client: Client, interaction: ChatInputCommandInteraction): Promise<boolean>;
export { resetServer, _resetServer };
//# sourceMappingURL=resetServer.d.ts.map