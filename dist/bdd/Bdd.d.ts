import type { status, Query } from "../types.js";
import type { joinOptions, whereConditions } from "./types.js";
declare function getBddInstance(): Promise<Bdd>;
declare function closeBddInstance(): boolean;
declare class Bdd {
    private name;
    private Database;
    constructor(name?: string);
    static create(name?: string): Promise<Bdd>;
    delete(): void;
    init(): Promise<void>;
    initDatabase(): Promise<void>;
    set(tableName: string, elemName: unknown[], value: unknown[]): Promise<status>;
    update(tableName: string, update: Record<string, unknown>, where: Record<string, unknown>): Promise<void>;
    get(tableName: string, values?: string[], joinOptions?: joinOptions, whereConditions?: whereConditions, is_ascending?: boolean, index_elem?: string): Promise<unknown[]>;
    rm(tableName: string, joinOptions?: joinOptions, whereConditions?: whereConditions): Promise<void>;
    queryBuilder(baseQuery: string, joinOptions?: joinOptions, whereConditions?: whereConditions, is_ascending?: boolean, index_elem?: string): Promise<Query>;
    setNewPartnerChannel(id_channel: string, id_guild: string, service_name: string, region: number): Promise<status>;
    deleteChannelServices(channel_id: string): Promise<status>;
    dropTable(table_name: string): Promise<status>;
    getCurrentTimestamp(): Promise<Date>;
    partnerHasRanks(channel_id: string, ranks: Array<string>): Promise<boolean>;
}
export { Bdd, getBddInstance, closeBddInstance };
//# sourceMappingURL=Bdd.d.ts.map