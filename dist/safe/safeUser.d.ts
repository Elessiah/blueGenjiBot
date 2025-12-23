import type { Client, Embed, User, Message, AttachmentBuilder } from "discord.js";
declare function safeUser(client: Client, user: User, embed?: Embed, attachements?: Array<AttachmentBuilder>, content?: string): Promise<Message | null>;
export { safeUser };
//# sourceMappingURL=safeUser.d.ts.map