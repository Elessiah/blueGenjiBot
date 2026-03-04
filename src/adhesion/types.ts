import {Guild, GuildMember, Role, TextChannel, User} from "discord.js";

type adhesionIntervalIds = {
    id: number,
    message: string,
    guild_id: string,
    channel_id: string | null,
    member_id: string | null,
    role_id: string | null,
    author_id: string,
    interval_days: number,
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
    interval_days: number,
    nextTransmission: Date,
}

type PathsAdhesions = {
    adhesion: string,
    adhesionName: string,
    status: string,
    statusName: string,
}

export type {adhesionIntervalIds, adhesionIntervalObj, PathsAdhesions};