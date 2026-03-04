import {AttachmentBuilder, Client, GuildMember, type Role, TextChannel, User} from "discord.js";
import {sendLog} from "@/safe/sendLog.js";
import {safeUser} from "@/safe/safeUser.js";
import {safeChannel} from "@/safe/safeChannel.js";
import {PathsAdhesions} from "@/adhesion/types.js";
import {loadAdhesionPaths} from "@/adhesion/loadAdhesionPaths.js";
import * as path from "node:path";

async function sendAdhesion(client: Client,
                            message: string | null,
                            channel: TextChannel | null,
                            member: GuildMember | null,
                            role: Role | null,
                            memberPermMissing: boolean,
                            author: User): Promise<boolean> {
    let success: boolean = true;
    let status: AttachmentBuilder;
    let adhesion: AttachmentBuilder;
    const paths: PathsAdhesions | null = await loadAdhesionPaths(undefined, client);
    if (!paths) {
        await safeUser(
            client,
            author,
            undefined,
            [],
            "Echec de l'envoie des adhésions, impossible de récupérer les fichiers. Admin en cours de contact..."
        );
        await sendLog(client, "Echec de l'envoi d'adhésion car non récupération des chemins");
        return false;
    }
    try {
        status = new AttachmentBuilder(
            paths.adhesion,
            {name: paths.adhesionName},
        );
        adhesion = new AttachmentBuilder(
            paths.status,
            {name: paths.statusName}
        );
    } catch (err) {
        await sendLog(client, "Failed to fetch adhesion and/or status: " + (err as TypeError).message);
        return false;
    }
    if (!message) {
        message = "Voici les papiers pour l'adhésion à l'association BlueGenji :"
    }
    if (!memberPermMissing) {
        if (channel !== null) {
            if (!await safeChannel(client, channel, undefined, [status, adhesion], message)) {
                await safeUser(
                    client,
                    author,
                    undefined,
                    [],
                    "Echec de l'envoie des adhésions, vérifiez les permissions, avant de réessayer !"
                );
                success = false;
            } else {
                await safeUser(
                    client,
                    author,
                    undefined,
                    [],
                    "Adhésion envoyé avec succès dans le channel cible !"
                );
            }
        }
        if (role !== null || member !== null) {
            let targets: User[] = [];
            if (role !== null) {
                targets = role.members.map(member => member.user);
            }
            if (member) {
                targets.push(member.user);
            }
            let errMsg: string = "";
            for (let target of targets) {
                if (!await safeUser(client, target, undefined, [status, adhesion], message)) {
                    errMsg += "Echec de l'envoi pour " + target.globalName + "\n";
                }
            }
            if (errMsg.length > 0) {
                await safeUser(client, author, undefined, [], errMsg);
                success = false;
            } else {
                await safeUser(client, author, undefined, [], "Adhésions envoyés avec succès !");
            }
        }
    }
    if (memberPermMissing || (channel === null && role === null && member === null)) {
        if (memberPermMissing && (channel || role || member))
            message += "\nVous n'avez pas les permissions pour envoyer un message ailleurs que dans vos MP !";
        await safeUser(client, author, undefined, [status, adhesion], message);
    }
    return success;
}

export {sendAdhesion};