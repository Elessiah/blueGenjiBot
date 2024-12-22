async function searchString(word, string) {
// Utilisation d'une expression régulière avec les délimiteurs de mot
    const regex = new RegExp(`\\b${word}\\b`, "g");
    const matches = string.match(regex);
    return (!!matches);
}

module.exports = {searchString};