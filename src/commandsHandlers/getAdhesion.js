const {AttachmentBuilder} = require("discord.js");
const sendLog = require("../safe/sendLog");
const checkPermissions = require("../check/checkPermissions");
const safeFollowUp = require("../safe/safeFollowUp");
const safeReply = require("../safe/safeReply");
const safeChannel = require("../safe/safeChannel");
const safeUser = require("../safe/safeUser");

const getAdhesion = async(client, interaction) => {
    await safeReply(interaction, "Envoie des adhésions en cours...", true);
    let message = interaction.options.getString("message");
    const channel = interaction.options.getChannel("channel");
    const member = interaction.options.getMember("membre");
    const role = interaction.options.getRole("role");
    const status = new AttachmentBuilder('res/bulletin_adhesion_bluegenji.docx', {name: 'bulletin_adhesion_bluegenji.docx'});
    const adhesion = new AttachmentBuilder('res/status_association_bluegenji_esport.docx', {name: 'status_association_bluegenji_esport.docx'});
    let memberPermMissing = !(await checkPermissions(interaction));
    if (!message) {
        message = "Voici les papiers pour l'adhésion à l'association BlueGenji :"
    }
    if (!memberPermMissing) {
        if (channel !== null) {
            if (await safeChannel(client, channel, null, [status, adhesion], message) === false) {
                await safeFollowUp(interaction, "Echec de l'envoie des adhésions (" + e + ") Si ce n'est pas une erreur de permissions, merci de réessayer !", true)
            } else {
                await safeFollowUp(interaction, "Adhésion envoyé avec succès dans le channel cible !", true);
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
                await safeFollowUp(interaction, errMsg, true);
            } else {
                await safeFollowUp(interaction, "Adhésions envoyés avec succès !", true);
            }
        }
    }
    if (memberPermMissing || (channel === null && role === null && member === null)) {
        if (memberPermMissing && (channel || role || member))
            message += "\nVous n'avez pas les permissions pour envoyer un message ailleurs que sur ce channel !";
        if (await safeFollowUp(interaction, message, false, [status, adhesion]) === false) {
            await safeFollowUp(interaction, message, true, [status, adhesion]);
            await safeFollowUp(interaction, "Le bot n'a pas les permissions pour que ce message ne soit pas éphémère !", true);
        }
    }
}

module.exports = getAdhesion;