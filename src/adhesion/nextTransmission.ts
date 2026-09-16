/**
 * Date du prochain envoi d'un rappel d'adhésion.
 *
 * Elle se calculait à deux endroits, en trois lignes chacun, et les deux
 * écrivaient l'heure avec `setHours(10, 0, 0, 0)` — donc 10:00 **sur l'horloge
 * de la machine**, pendant que le cron qui relève ces dates épingle
 * `Europe/Paris` et que la doc utilisateur promet « 10:00 (heure
 * Europe/Paris) ». Trois conventions pour une seule heure, d'accord entre elles
 * seulement tant que le serveur reste à Paris.
 *
 * L'heure est donc nommée ici, une fois, et résolue dans son fuseau.
 */

import { parisDaysLater } from "@/utils/parisTime.js";

/** L'heure parisienne à laquelle partent les rappels, telle que la doc l'annonce. */
const ADHESION_REMINDER_HOUR = 10;

/**
 * Date du prochain envoi, `intervalDays` jours après le jour parisien de `from`.
 * @param from Instant de référence — l'envoi qui vient de partir, ou la pose du rappel.
 * @param intervalDays Cadence du rappel, en jours.
 * @returns L'instant auquel il sera 10:00 à Paris, ce nombre de jours plus tard.
 */
function nextTransmissionAfter(from: Date, intervalDays: number): Date {
    return parisDaysLater(from, intervalDays, ADHESION_REMINDER_HOUR);
}

export {ADHESION_REMINDER_HOUR, nextTransmissionAfter};
