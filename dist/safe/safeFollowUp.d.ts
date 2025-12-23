import type { Attachment, ChatInputCommandInteraction, Message } from "discord.js";
declare function safeFollowUp(interaction: ChatInputCommandInteraction, content: string | undefined, is_ephemeral: boolean | undefined, attachements: Array<Attachment>): Promise<Message | null>;
export { safeFollowUp };
//# sourceMappingURL=safeFollowUp.d.ts.map