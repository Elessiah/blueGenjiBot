import { AttachmentBuilder } from "discord.js";
import { sendLog } from "../../safe/sendLog.js";
import { checkPermissions } from "../../check/checkPermissions.js";
import { safeFollowUp } from "../../safe/safeFollowUp.js";
import { safeReply } from "../../safe/safeReply.js";
import { safeChannel } from "../../safe/safeChannel.js";
import { safeUser } from "../../safe/safeUser.js";
import { getBddInstance } from "../../bdd/Bdd.js";
async function _getAdhesion(client, message, channel, member, role, memberPermMissing, author) {
    let success = true;
    let status;
    let adhesion;
    try {
        status = new AttachmentBuilder('res/bulletin_adhesion_bluegenji.docx', { name: 'bulletin_adhesion_bluegenji.docx' });
        adhesion = new AttachmentBuilder('res/status_association_bluegenji_esport.docx', { name: 'status_association_bluegenji_esport.docx' });
    }
    catch (err) {
        await sendLog(client, "Failed to fetch adhesion and/or status: " + err.message);
        return false;
    }
    if (!message) {
        message = "Voici les papiers pour l'adhésion à l'association BlueGenji :";
    }
    if (!memberPermMissing) {
        if (channel !== null) {
            if (!await safeChannel(client, channel, undefined, [status, adhesion], message)) {
                await safeUser(client, author, undefined, [], "Echec de l'envoie des adhésions, vérifiez les permissions, avant de réessayer !");
                success = false;
            }
            else {
                await safeUser(client, author, undefined, [], "Adhésion envoyé avec succès dans le channel cible !");
            }
        }
        if (role !== null || member !== null) {
            let targets = [];
            if (role !== null) {
                targets = role.members.map(member => member.user);
            }
            if (member) {
                targets.push(member.user);
            }
            let errMsg = "";
            for (let target of targets) {
                if (!await safeUser(client, target, undefined, [status, adhesion], message)) {
                    errMsg += "Echec de l'envoi pour " + target.globalName + "\n";
                }
            }
            if (errMsg.length > 0) {
                await safeUser(client, author, undefined, [], errMsg);
                success = false;
            }
            else {
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
async function getAdhesion(client, interaction) {
    await safeReply(interaction, "Envoie des adhésions en cours...", true);
    let message = interaction.options.getString("message");
    const channel = interaction.options.getChannel("channel");
    const member = interaction.options.getMember("membre");
    const role = interaction.options.getRole("role");
    const interval = interaction.options.getString("interval");
    let intInterval = 0;
    if (interval != null) {
        intInterval = parseInt(interval, 10);
        if (intInterval > 20) {
            await safeFollowUp(interaction, "L'intervalle ne doit pas dépasser les 20jours ! Echec !", true, []);
            return;
        }
    }
    let memberPermMissing = !(await checkPermissions(interaction));
    if (memberPermMissing && intInterval > 0) {
        await safeFollowUp(interaction, "Vous n'avez pas les permissions pour définir une intervalle", true, []);
        return;
    }
    if (await _getAdhesion(client, message, channel, member, role, memberPermMissing, interaction.user))
        await safeFollowUp(interaction, "Premier envoi réussi, préparation de la répétition...", true, []);
    else
        await safeFollowUp(interaction, "Premier envoi a échoué, pas de répétition programmé...", true, []);
    if (intInterval > 0) {
        const id = setInterval(() => _getAdhesion(client, message, channel, member, role, memberPermMissing, interaction.user), 86400000 * intInterval);
        const bdd = await getBddInstance();
        const status = await bdd.set("AdhesionInterval", ["id", "message", "channel_id", "member_id", "role_id", "author_id", "interval"], [id, message, channel ? channel.id : null, member ? member.id : null, role ? role.id : null, interaction.user.id, interval]);
        if (!status.success) {
            clearInterval(id);
            await sendLog(client, "Erreur lors de la programmation d'un rappel : " + status.message);
            await safeFollowUp(interaction, "Echec de la programmation ! Veuillez réessayer !", true, []);
            return;
        }
        await safeFollowUp(interaction, `Programmation réussi du rappel. Envoi des adhésions dans ${interval} jours`, false, []);
    }
}
export { getAdhesion };
//# sourceMappingURL=getAdhesion.js.map