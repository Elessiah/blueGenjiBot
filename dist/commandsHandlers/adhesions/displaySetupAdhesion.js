import { getBddInstance } from "../../bdd/Bdd.js";
export async function displaySetupAdhesion(client, interaction) {
    const bdd = await getBddInstance();
    const rappels = await bdd.get("AdhesionsInterval");
}
//# sourceMappingURL=displaySetupAdhesion.js.map