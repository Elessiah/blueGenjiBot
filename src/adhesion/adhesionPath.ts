/**
 * Résolution des chemins de stockage des fichiers d'adhésion.
 *
 * Les trois endroits qui touchaient au disque concaténaient
 * `process.env.ADHESIONS_PATH` et un nom de fichier. Cette forme a trois
 * défauts, et le dépôt en porte la preuve : sans la variable, `undefined` est
 * recollé au nom et le bot écrit un `undefinedpaths.json` dans son dossier
 * courant — au lieu d'échouer, il range la configuration ailleurs, sans un
 * mot. Sans barre finale, `/opt/adhesionspaths.json` est un chemin frère du
 * dossier visé. Et le nom d'une pièce jointe est choisi par celui qui la
 * téléverse : un `../` y sort du dossier de stockage.
 *
 * `path.join` referme les deux premiers, `path.basename` le troisième — un
 * nom de fichier ne traverse plus rien, quoi qu'il contienne.
 */

import path from "node:path";

/**
 * Dossier de stockage des fichiers d'adhésion.
 *
 * Le repli est le dossier courant, c'est-à-dire là où le bot écrivait déjà
 * sans la variable : la correction rend le chemin propre, elle ne déplace
 * pas les fichiers d'une installation existante.
 *
 * @returns Le dossier configuré, ou le dossier courant à défaut.
 */
function adhesionDir(): string {
    return process.env.ADHESIONS_PATH || ".";
}

/**
 * Chemin d'un fichier d'adhésion, confiné au dossier de stockage.
 *
 * `path.basename` ne suffit pas seul : il rend `.` et `..` tels quels, et
 * `path.join` les relit ensuite comme des sauts de dossier — un fichier
 * nommé `..` remonterait donc d'un cran malgré la coupe. Ce ne sont pas des
 * noms de fichiers ; ils sont ramenés au dossier lui-même, dont l'ouverture
 * en écriture échoue franchement plutôt que d'aboutir ailleurs.
 *
 * @param name Nom de fichier, éventuellement choisi par un tiers.
 * @returns Le chemin du fichier dans le dossier de stockage, sans traversée possible.
 */
function adhesionFilePath(name: string): string {
    const base = path.basename(name);
    return path.join(adhesionDir(), base === "." || base === ".." ? "" : base);
}

export {adhesionDir, adhesionFilePath};
