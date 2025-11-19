const {AttachmentBuilder} = require("discord.js");
const sendLog = require("../../safe/sendLog");
const checkPermissions = require("../../check/checkPermissions");
const safeFollowUp = require("../../safe/safeFollowUp");
const safeReply = require("../../safe/safeReply");
const safeChannel = require("../../safe/safeChannel");
const safeUser = require("../../safe/safeUser");
const {getBddInstance} = require("../../bdd/Bdd");

async function _getAdhesion(client, message, channel, member, role, memberPermMissing, author) {
    let success = true;
    const status = new AttachmentBuilder('res/bulletin_adhesion_bluegenji.docx', {name: 'bulletin_adhesion_bluegenji.docx'});
    const adhesion = new AttachmentBuilder('res/status_association_bluegenji_esport.docx', {name: 'status_association_bluegenji_esport.docx'});
    if (!message) {
        message = "Voici les papiers pour l'adhésion à l'association BlueGenji :"
    }
    if (!memberPermMissing) {
        if (channel !== null) {
            if (await safeChannel(client, channel, null, [status, adhesion], message) === false) {
                await safeUser(client, author, null, [], "Echec de l'envoie des adhésions (" + e + ") Si ce n'est pas une erreur de permissions, merci de réessayer !");
                success = false;
            } else {
                await safeUser(client, author, "Adhésion envoyé avec succès dans le channel cible !");
            }
        }
        if (role !== null || member !== null) {
            let targets = [];
            if (role !== null) {
                targets = role.members.map(member => member.user);
            }
            if (member) {
                targets.push(member);
            }
            let errMsg = "";
            for (let target of targets) {
                if (await safeUser(client, target, null, [status, adhesion], message) === false) {
                    errMsg += "Echec de l'envoi pour " + target.globalName + "\n";
                }
            }
            if (errMsg.length > 0) {
                await safeUser(client, author, null, [], errMsg);
                success = false;
            } else {
                await safeUser(client, author, null, [], "Adhésions envoyés avec succès !");
            }
        }
    }
    if (memberPermMissing || (channel === null && role === null && member === null)) {
        if (memberPermMissing && (channel || role || member))
            message += "\nVous n'avez pas les permissions pour envoyer un message ailleurs que dans vos MP !";
        await safeUser(client, author, false, [status, adhesion], message);
    }
    return success;
}

const getAdhesion = async(client, interaction) => {
    await safeReply(interaction, "Envoie des adhésions en cours...", true);
    let message = interaction.options.getString("message");
    const channel = interaction.options.getChannel("channel");
    const member = interaction.options.getMember("membre");
    const role = interaction.options.getRole("role");
    let interval = interaction.options.getString("interval");
    if (interval !== null) {
        interval = parseInt(interval, 10);
        if  (interval > 20) {
            return await safeFollowUp(interaction, "L'intervalle ne doit pas dépasser les 20jours ! Echec !", true);
        }
    }
    else
        interval = 0;
    let memberPermMissing = !(await checkPermissions(interaction));
    if (memberPermMissing && interval > 0)
        return await safeFollowUp(interaction, "Vous n'avez pas les permissions pour définir une intervalle", true);
    if (await _getAdhesion(client, message, channel, member, role, memberPermMissing))
        await safeFollowUp(interaction, "Premier envoi réussi, préparation de la répétition...", true);
    else
        await safeFollowUp(interaction, "Premier envoi a échoué, pas de répétition programmé...", true);
    if (interval > 0) {
        const id = setInterval(_getAdhesion(client, message, channel, member, role, memberPermMissing, interaction.author), 86400000 * interval)
        const bdd = getBddInstance();
        const status = await bdd.set(
            "AdhesionInterval",
            ["id", "message", "channel_id", "member_id", "role_id", "author_id", "interval"],
            [id, message, channel.id, member.id, role.id, interaction.author.id, interval]
        );
        if (!status.success) {
            clearInterval(id);
            await sendLog(client, "Erreur lors de la programmation d'un rappel : " + status.message);
            return await safeFollowUp(interaction, "Echec de la programmation ! Veuillez réessayer !", true);
        }
        await safeFollowUp(interaction, `Programmation réussi du rappel. Envoi des adhésions dans ${interval} jours`);
    }
}

module.exports = getAdhesion;