export type Ban = {
    id_user: string;
    id_moderator: string;
    id_reason: string;
    date: Date;
};
export type ChannelPartner = {
    id_channel: string;
    id_guild: string;
    region: number;
};
export type ChannelPartnerRank = {
    id_channel: string;
    id_rank: number;
};
export type ChannelPartnerService = {
    id_channel: string;
    id_service: number;
};
export type DPMsg = {
    id_msg: string;
    id_channel: string;
    id_og: string;
    date: Date;
};
export type MessageService = {
    id_msg: string;
    id_service: number;
};
export type OGMsg = {
    id_msg: string;
    id_author: string;
    date: Date;
};
export type Ranks = {
    id_rank: number;
    name: string;
};
export type Service = {
    id_service: number;
    name: string;
};
export type joinOptions = Record<string, string>;
export type whereConditions = {
    query: string;
    values: unknown[];
};
//# sourceMappingURL=types.d.ts.map