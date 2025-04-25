async function servicesWithNoRanks(services) {
    for (const service of services) {
        if (service.name == "ta" || service.name == "lfg" || service.name == "lfstaff" || service.name == "lfcast")
            return true;
    }
    return false;
}

module.exports = servicesWithNoRanks;