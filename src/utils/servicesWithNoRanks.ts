async function servicesWithNoRanks(services: {name: string; id_service: number}[]): Promise<boolean> {
    for (const service of services) {
        if (service.name == "ta" || service.name == "lfg" || service.name == "lfstaff" || service.name == "lfcast")
            return true;
    }
    return false;
}


export {servicesWithNoRanks};