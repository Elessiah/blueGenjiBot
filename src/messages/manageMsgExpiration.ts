/**
 * Purge des messages de service relayés au-delà de leur durée de conservation.
 *
 * Le seuil se construisait en JavaScript puis se comparait, en chaîne, à la
 * colonne `date`. Deux défauts s'y logeaient, et ils ne s'annulaient pas.
 *
 * `getCurrentTimestamp()` rend le `CURRENT_TIMESTAMP` de SQLite — de l'UTC noté
 * `YYYY-MM-DD HH:MM:SS` — que `new Date()` relit dans le fuseau **de la
 * machine** : deux heures d'écart en été. Et la comparaison opposait ensuite ce
 * format-là à un `toISOString()`, c'est-à-dire un `T` et un `Z`. En position 10,
 * l'espace (`0x20`) précède le `T` (`0x54`) : **toute ligne datée du jour du
 * seuil passait donc pour antérieure, quelle que soit son heure**. La coupe
 * n'était pas une fenêtre glissante mais un minuit UTC, et la conservation
 * réelle oscillait entre deux et trois jours selon l'heure à laquelle un relais
 * déclenchait le ménage.
 *
 * Le remède n'est pas de corriger l'un des deux calculs : c'est de ne pas
 * quitter SQL. La base compare `date` à `DATETIME('now', …)` — même format des
 * deux côtés, même horloge, et plus aucun fuseau nulle part.
 *
 * **Ne pas « réparer » `getCurrentTimestamp` isolément** pour autant : son
 * autre appelant, `checkCooldown`, relit la colonne stockée exactement de la
 * même façon, si bien que les deux côtés sont décalés pareil et que leur
 * *différence* est juste. Corriger un seul des deux casserait le cooldown.
 */

import {Bdd, getBddInstance} from "../bdd/Bdd.js";
import type {Client} from "discord.js";

/** Durée de conservation d'un message de service et de ses copies relayées. */
const MESSAGE_RETENTION_DAYS = 7;

/** Le même seuil, dans la langue des modificateurs de date de SQLite. */
const RETENTION_MODIFIER = `-${MESSAGE_RETENTION_DAYS} days`;

/**
 * Clause « plus vieux que la durée de conservation ».
 *
 * Rendue par un appel plutôt que partagée : deux `bdd.rm` reçoivent alors
 * chacun son objet, et aucun ne peut voir l'autre modifier le sien.
 *
 * @returns La condition `WHERE` et sa valeur bindée.
 */
function olderThanRetention() {
    return {query: "date < DATETIME('now', ?)", values: [RETENTION_MODIFIER]};
}

/**
 * Supprime les messages de service expirés et tout ce qui pend à eux.
 * @param _client Client Discord. Inutilisé : le ménage est purement en base.
 *                Gardé dans la signature, que l'appelant renseigne déjà et qui
 *                servira dès qu'il faudra effacer les messages côté Discord.
 */
async function manageMsgExpiration(_client: Client): Promise<void> {
    const bdd: Bdd = await getBddInstance();

    await bdd.rm('DPMsg', {}, olderThanRetention());

    // `MessageService` ne porte pas de date : elle n'existe que par le message
    // d'origine qu'elle qualifie. On la vide donc **avant** `OGMsg`, tant que
    // les lignes qui la désignent sont encore là — et en une seule instruction,
    // là où une lecture suivie d'un `DELETE` par ligne en faisait autant que de
    // messages expirés.
    await bdd.rm('MessageService', {}, {
        query: "id_msg IN (SELECT id_msg FROM OGMsg WHERE date < DATETIME('now', ?))",
        values: [RETENTION_MODIFIER],
    });

    await bdd.rm('OGMsg', {}, olderThanRetention());
}

export {MESSAGE_RETENTION_DAYS, manageMsgExpiration};
