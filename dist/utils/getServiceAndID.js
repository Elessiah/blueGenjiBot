import { getBddInstance } from "../bdd/Bdd.js";
let servicesAndID;
async function getServicesAndID() {
    if (servicesAndID === undefined) {
        let bdd = await getBddInstance();
        servicesAndID = await bdd.get("Service", ["*"]);
        return servicesAndID;
    }
    return servicesAndID;
}
export { getServicesAndID };
//# sourceMappingURL=getServiceAndID.js.map