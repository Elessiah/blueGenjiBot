import type { Attachment, Client, Message } from "discord.js";
import { EmbedBuilder } from "discord.js";
declare function buildServiceMessage(client: Client, message: Message, channelId: string, attachement?: Attachment): Promise<EmbedBuilder>;
export { buildServiceMessage };
//# sourceMappingURL=buildServiceMessage.d.ts.map