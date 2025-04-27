const {getBddInstance} = require("./../bdd/Bdd");
const delay = require("./delay");

let servicesAndID;

async function getServicesAndID() {
    if (servicesAndID === undefined) {
        let bdd;
        let i = 0;
        while (!bdd || i > 4) {
            bdd = await getBddInstance();
            i += 1;
            await delay(500);
        }
        if (!bdd)
            return false;
        servicesAndID = await bdd.get("Service", ["*"]);
        return servicesAndID;
    }
    return servicesAndID;
}

module.exports = getServicesAndID;