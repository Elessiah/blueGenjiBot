import {Bdd, getBddInstance} from "../bdd/Bdd.js";
import {delay} from "./delay.js";
import {Service} from "../bdd/types.js";

let servicesAndID: Service[];

async function getServicesAndID(): Promise<Service[]> {
    if (servicesAndID === undefined) {
        let bdd: Bdd = await getBddInstance();
        servicesAndID = await bdd.get("Service", ["*"]) as Service[];
        return servicesAndID;
    }
    return servicesAndID;
}

export {getServicesAndID};