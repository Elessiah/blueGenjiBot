import {Guild, GuildMember, Role, TextChannel, User} from "discord.js";

type adhesionIntervalIds = {
    id: number,
    message: string,
    guild_id: string,
    channel_id: string | null,
    member_id: string | null,
    role_id: string | null,
    author_id: string,
    intervalle: number,
    nextTransmission: Date,
}

type adhesionIntervalObj = {
    id: number,
    message: string,
    guild: Guild,
    channel: TextChannel | null,
    member: GuildMember | null,
    role: Role | null,
    author: User,
    intervalle: number,
    nextTransmission: Date,
}

export type {adhesionIntervalIds, adhesionIntervalObj};