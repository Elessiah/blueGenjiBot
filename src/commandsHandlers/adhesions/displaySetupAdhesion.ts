import {getBddInstance} from "../../bdd/Bdd.js";
import type {ChatInputCommandInteraction, Client} from "discord.js";

export async function displaySetupAdhesion(client: Client,
                                           interaction: ChatInputCommandInteraction): Promise<void> {
    const bdd = await getBddInstance();
    const rappels = await bdd.get(
        "AdhesionsInterval"
    );
}