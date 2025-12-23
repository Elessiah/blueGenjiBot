import type { Client, Message, OmitPartialGroupDMChannel } from "discord.js";
declare function safeMsgReply(client: Client, msg: Message, content: string): Promise<OmitPartialGroupDMChannel<Message> | null>;
export { safeMsgReply };
//# sourceMappingURL=safeMsgReply.d.ts.map