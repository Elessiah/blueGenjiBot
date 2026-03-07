import {AttachmentBuilder, Client, GuildMember, type Role, TextChannel, User} from "discord.js";
import {sendLog} from "@/safe/sendLog.js";
import {safeUser} from "@/safe/safeUser.js";
import {safeChannel} from "@/safe/safeChannel.js";
import {PathsAdhesions} from "@/adhesion/types.js";
import {loadAdhesionPaths} from "@/adhesion/loadAdhesionPaths.js";

/**
 * Envoie les fichiers d'adhésion (et message associé) vers les cibles fournies.
 * Peut envoyer dans un canal, en MP à un membre, ou à tous les membres d'un rôle.
 * @param client Client Discord utilisé pour les envois et logs.
 * @param message Message personnalisé à joindre; un message par défaut est utilisé si `null`.
 * @param channel Canal cible, ou `null` si aucun envoi en canal n'est prévu.
 * @param member Membre cible, ou `null` si aucun envoi individuel n'est prévu.
 * @param role Rôle cible, ou `null` si aucun envoi par rôle n'est prévu.
 * @param memberPermMissing Indique si l'auteur manque de permissions pour des envois hors MP.
 * @param author Auteur du rappel, notifie en cas de succès/échec.
 * @returns `true` si tous les envois demandés aux cibles sélectionnées réussissent; `false` dès qu'au moins un envoi échoue.
 */
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
