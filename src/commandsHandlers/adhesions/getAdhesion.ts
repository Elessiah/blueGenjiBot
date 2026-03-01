import {AttachmentBuilder, type ChatInputCommandInteraction, GuildMember} from "discord.js";
import type { Client, TextChannel, User, Role } from "discord.js";
import {sendLog} from "../../safe/sendLog.js";
import {checkPermissions} from "../../check/checkPermissions.js";
import {safeFollowUp} from "../../safe/safeFollowUp.js";
import {safeReply} from "../../safe/safeReply.js";
import {safeChannel} from "../../safe/safeChannel.js";
import {safeUser} from "../../safe/safeUser.js";
import {Bdd, getBddInstance} from "../../bdd/Bdd.js";
import {status} from "../../types.js";

async function _getAdhesion(client: Client,
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
        status = new AttachmentBuilder('res/bulletin_adhesion_bluegenji.docx', {name: 'bulletin_adhesion_bluegenji.docx'});
        adhesion = new AttachmentBuilder('res/status_association_bluegenji_esport.docx', {name: 'status_association_bluegenji_esport.docx'});
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
                await safeUser(client, author, undefined, [], "Echec de l'envoie des adhésions, vérifiez les permissions, avant de réessayer !");
                success = false;
            } else {
                await safeUser(client, author, undefined, [], "Adhésion envoyé avec succès dans le channel cible !");
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

async function getAdhesion(client: Client,
                           interaction: ChatInputCommandInteraction): Promise<void> {
    await safeReply(interaction, "Envoie des adhésions en cours...", true);
    let message: string | null = interaction.options.getString("message");
    const channel: TextChannel | null = interaction.options.getChannel("channel");
    const member: GuildMember | null = interaction.options.getMember("membre") as GuildMember | null;
    const role: Role | null = interaction.options.getRole("role") as Role | null;
    const interval: string | null = interaction.options.getString("interval");
    let intInterval: number = 0;
    if (interval != null) {
        intInterval = parseInt(interval, 10);
        if  (intInterval > 20) {
            await safeFollowUp(interaction, "L'intervalle ne doit pas dépasser les 20jours ! Echec !", true, []);
            return;
        }
    }
    let memberPermMissing = !checkPermissions(interaction);
    if (memberPermMissing && intInterval > 0) {
        await safeFollowUp(interaction, "Vous n'avez pas les permissions pour définir une intervalle", true, []);
        return;
    }
    if (await _getAdhesion(client, message, channel, member, role, memberPermMissing, interaction.user))
        await safeFollowUp(interaction, "Envoi réussi !", true, []);
    else
        await safeFollowUp(interaction, "Echec de l'envoi !", true, []);
    if (intInterval > 0) {
        const id = setInterval(() => _getAdhesion(client, message, channel, member, role, memberPermMissing, interaction.user), 86400000 * intInterval)
        const bdd: Bdd = await getBddInstance();
        const status: status = await bdd.set(
            "AdhesionInterval",
            ["id", "message", "channel_id", "member_id", "role_id", "author_id", "interval"],
            [id, message, channel ? channel.id : null, member ? member.id : null, role ? role.id : null, interaction.user.id, interval]
        );
        if (!status.success) {
            clearInterval(id);
            await sendLog(client, "Erreur lors de la programmation d'un rappel : " + status.message);
            await safeFollowUp(interaction, "Echec de la programmation ! Veuillez réessayer !", true, []);
            return;
        }
        await safeFollowUp(interaction, `Programmation réussi du rappel. Envoi des adhésions dans ${interval} jours`, false, []);
    }
}

export {getAdhesion};