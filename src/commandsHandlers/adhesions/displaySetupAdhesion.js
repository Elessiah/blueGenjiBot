const {getBddInstance} = require("../../bdd/Bdd");

async function displaySetupAdhesion(client, interaction) {
    const bdd = getBddInstance();
    const rappels = await bdd.get(
        "AdhesionsInterval"
    );
}