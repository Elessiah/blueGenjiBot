import {AttachmentBuilder, Client, GuildMember, type Role, TextChannel, User} from "discord.js";
import {sendLog} from "@/safe/sendLog.js";
import {safeUser} from "@/safe/safeUser.js";
import {safeChannel} from "@/safe/safeChannel.js";

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
    try {
        status = new AttachmentBuilder(
            'res/bulletin_adhesion_bluegenji.docx',
            {name: 'bulletin_adhesion_bluegenji.docx'}
        );
        adhesion = new AttachmentBuilder(
            'res/status_association_bluegenji_esport.docx',
            {name: 'status_association_bluegenji_esport.docx'}
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