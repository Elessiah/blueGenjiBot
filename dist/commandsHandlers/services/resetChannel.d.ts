import { type ChatInputCommandInteraction, type Client } from "discord.js";
import { status } from "../../types.js";
declare function _resetChannel(client: Client, channel_id: string): Promise<status>;
declare function resetChannel(client: Client, interaction: ChatInputCommandInteraction): Promise<boolean>;
export { resetChannel, _resetChannel };
//# sourceMappingURL=resetChannel.d.ts.map