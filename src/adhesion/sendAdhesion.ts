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

    let paths: PathsAdhesions | null = null;
    try {
        paths = await loadAdhesionPaths(undefined, client);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        try {
            await sendLog(client, "sendAdhesion loadAdhesionPaths: " + msg);
        } catch { /* ignore */ }
        return false;
    }
    if (!paths) {
        try {
            await safeUser(
                client,
                author,
                undefined,
                [],
                "Echec de l'envoie des adhésions, impossible de récupérer les fichiers. Admin en cours de contact..."
            );
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            try {
                await sendLog(client, "sendAdhesion safeUser (no paths): " + msg);
            } catch { /* ignore */ }
        }
        try {
            await sendLog(client, "Echec de l'envoi d'adhésion car non récupération des chemins");
        } catch { /* ignore */ }
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
        const msg = err instanceof Error ? err.message : String(err);
        try {
            await sendLog(client, "Failed to fetch adhesion and/or status: " + msg);
        } catch { /* ignore */ }
        return false;
    }

    if (!message) {
        message = "Voici les papiers pour l'adhésion à l'association BlueGenji :"
    }

    if (!memberPermMissing) {
        if (channel !== null) {
            let channelOk: boolean;
            try {
                channelOk = (await safeChannel(client, channel, undefined, [status, adhesion], message)) !== null;
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                try {
                    await sendLog(client, "sendAdhesion safeChannel: " + msg);
                } catch { /* ignore */ }
                channelOk = false;
            }
            if (!channelOk) {
                try {
                    await safeUser(
                        client,
                        author,
                        undefined,
                        [],
                        "Echec de l'envoie des adhésions, vérifiez les permissions, avant de réessayer !"
                    );
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    try {
                        await sendLog(client, "sendAdhesion safeUser (channel fail): " + msg);
                    } catch { /* ignore */ }
                }
                success = false;
            } else {
                try {
                    await safeUser(
                        client,
                        author,
                        undefined,
                        [],
                        "Adhésion envoyé avec succès dans le channel " + channel.name + " !"
                    );
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    try {
                        await sendLog(client, "sendAdhesion safeUser (channel ok): " + msg);
                    } catch { /* ignore */ }
                }
            }
        }

        if (role !== null || member !== null) {
            let targets: User[] = [];
            try {
                if (role !== null) {
                    targets = role.members.map(m => m.user);
                }
                if (member) {
                    targets.push(member.user);
                }
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                try {
                    await sendLog(client, "sendAdhesion targets: " + msg);
                } catch { /* ignore */ }
            }
            let errMsg: string = "";
            for (const target of targets) {
                let ok: boolean;
                try {
                    ok = (await safeUser(client, target, undefined, [status, adhesion], message)) !== null;
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    try {
                        await sendLog(client, "sendAdhesion safeUser target: " + msg);
                    } catch { /* ignore */ }
                    ok = false;
                }
                if (!ok) {
                    errMsg += "Echec de l'envoi pour " + target.globalName + "\n";
                }
            }
            if (errMsg.length > 0) {
                try {
                    await safeUser(client, author, undefined, [], errMsg);
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    try {
                        await sendLog(client, "sendAdhesion safeUser author errMsg: " + msg);
                    } catch { /* ignore */ }
                }
                success = false;
            } else {
                try {
                    if (targets.length > 1) {
                        await safeUser(client, author, undefined, [], "Adhésions envoyés avec succès à plusieurs membres !");
                    } else {
                        await safeUser(client, author, undefined, [], "Adhésion envoyée avec succès à " + targets[0].globalName + " !");
                    }
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    try {
                        await sendLog(client, "sendAdhesion safeUser author success: " + msg);
                    } catch { /* ignore */ }
                }
            }
        }
    }

    if (memberPermMissing || (channel === null && role === null && member === null)) {
        if (memberPermMissing && (channel || role || member))
            message += "\nVous n'avez pas les permissions pour envoyer un message ailleurs que dans vos MP !";
        try {
            await safeUser(client, author, undefined, [status, adhesion], message);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            try {
                await sendLog(client, "sendAdhesion safeUser (memberPermMissing): " + msg);
            } catch { /* ignore */ }
        }
    }
    return success;
}

export {sendAdhesion};
