/**
 * Crée une temporisation asynchrone en millisecondes.
 * @param ms Durée en millisecondes.
 */
function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export {delay};
