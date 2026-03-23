function toSQLiteDate(date: Date): string {
    return date.toISOString().replace('T', ' ').replace('Z', '').slice(0, 19);
}

export {toSQLiteDate};