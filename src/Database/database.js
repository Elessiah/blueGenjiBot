import Database from 'better-sqlite3';

const db = new Database('./database.db');

if (!db) {
  throw new Error('Database not found');
}





