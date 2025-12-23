import type { Attachment, AttachmentBuilder, Client, Embed, EmbedBuilder, Message, TextChannel } from "discord.js";
declare function safeChannel(client: Client, channel: TextChannel, embed?: Embed | EmbedBuilder, attachements?: Array<Attachment | AttachmentBuilder>, content?: string): Promise<Message | null>;
export { safeChannel };
//# sourceMappingURL=safeChannel.d.ts.map