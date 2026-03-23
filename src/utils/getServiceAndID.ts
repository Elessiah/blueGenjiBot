import {Bdd, getBddInstance} from "../bdd/Bdd.js";
import {Service} from "../bdd/types.js";

let servicesAndID: Service[];

/**
 * Résout le service ciblé et son identifiant interne.
 * @returns Liste des services de la base, mise en cache pour les appels suivants.
 */
async function getServicesAndID(): Promise<Service[]> {
    if (servicesAndID === undefined) {
        let bdd: Bdd = await getBddInstance();
        servicesAndID = await bdd.get("Service", ["*"]) as Service[];
        return servicesAndID;
    }
    return servicesAndID;
}

export {getServicesAndID};
