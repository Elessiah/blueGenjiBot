import type { Client } from "discord.js";
declare function getTips(): Tips;
declare function nextTips(client: Client, service: string, region: number): Promise<void>;
declare class Tips {
    private messageCounter;
    private tipsRoller;
    constructor();
    static create(): Tips;
    nextTips(client: Client, service: string, region: number): Promise<void>;
}
export { getTips, nextTips };
//# sourceMappingURL=Tips.d.ts.map