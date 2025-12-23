import type { Client, Message } from "discord.js";
import type { Bdd } from "../bdd/Bdd.js";
declare function manageDistribution(message: Message, client: Client, bdd: Bdd, channelId: string, channelServices: {
    name: string;
    id_service: number;
}[]): Promise<boolean>;
export { manageDistribution };
//# sourceMappingURL=manageDistribution.d.ts.map