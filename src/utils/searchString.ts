async function searchString(word: string,
                            string: string): Promise<boolean> {
// Utilisation d'une expression régulière avec les délimiteurs de mot
    const regex = new RegExp(`\\b${word}\\b`, "g");
    const matches = string.match(regex);
    return (!!matches);
}

export {searchString};