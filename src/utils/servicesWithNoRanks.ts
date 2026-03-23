/**
 * Retourne les services qui n'imposent aucun filtrage par rang.
 * @param services Information de service à traiter.
 * @returns `true` si au moins un service n'utilise pas de filtre de rang (`ta`, `lfg`, `lfstaff`, `lfcast`), sinon `false`.
 */
async function servicesWithNoRanks(services: {name: string; id_service: number}[]): Promise<boolean> {
    for (const service of services) {
        if (service.name == "ta" || service.name == "lfg" || service.name == "lfstaff" || service.name == "lfcast")
            return true;
    }
    return false;
}


export {servicesWithNoRanks};
