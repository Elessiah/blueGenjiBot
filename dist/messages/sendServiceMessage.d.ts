import type { Client, Embed, EmbedBuilder, Message } from "discord.js";
import type { Bdd } from "../bdd/Bdd.js";
declare function sendServiceMessage(client: Client, targets: {
    id_channel: string;
}[], message: Message, embed: EmbedBuilder | Embed | undefined, bdd: Bdd, ranks: string[]): Promise<number>;
export { sendServiceMessage };
//# sourceMappingURL=sendServiceMessage.d.ts.map