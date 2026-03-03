import {Client, User} from "discord.js";
import {Bdd} from "@/bdd/Bdd.js";
import {safeUser} from "@/safe/safeUser.js";
import {sendLog} from "@/safe/sendLog.js";

async function removeIntervalle(client: Client, bdd: Bdd, user: User | undefined, id: number, msg: string): Promise<void> {
    await sendLog(client, msg);
    if (user) {
        await safeUser(client, user, undefined, undefined, msg)
    }
    await bdd.rm("AdhesionInterval", undefined, {query: "id = ?", values: [id]});
}

export {removeIntervalle};