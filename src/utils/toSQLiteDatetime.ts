/**
 * Conversion d'une `Date` JS vers le format datetime attendu par SQLite (`YYYY-MM-DD HH:MM:SS`).
 *
 * SQLite n'a pas de type date natif : ses fonctions `datetime()` comparent des
 * chaines dans ce format precis. Le `T` et le suffixe `Z` d'un ISO 8601
 * standard ne correspondent a rien pour ces comparaisons, d'ou la conversion
 * plutot qu'un simple `toISOString()`.
 */

/**
 * @param date Date a convertir.
 * @returns La date au format `YYYY-MM-DD HH:MM:SS`, en UTC.
 */
function toSQLiteDate(date: Date): string {
    return date.toISOString().replace('T', ' ').replace('Z', '').slice(0, 19);
}

export {toSQLiteDate};
