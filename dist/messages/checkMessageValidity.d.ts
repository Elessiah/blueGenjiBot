import type { Client, Message } from "discord.js";
import type { Service } from "../bdd/types.js";
declare function checkMessageValidity(client: Client, service: Service, messageContentLower: string, message: Message, hasValidService: {
    value: boolean;
}): Promise<boolean>;
export { checkMessageValidity };
//# sourceMappingURL=checkMessageValidity.d.ts.map