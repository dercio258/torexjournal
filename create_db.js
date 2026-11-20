const path = require('path');
require('dotenv').config({ path: path.join(__dirname, 'backend-nest', '.env') });
require('dotenv').config();
const { Client } = require('pg');

const dbUser = process.env.DB_USER;
const dbPass = process.env.DB_PASS;
const targetDb = process.env.DB_NAME;

if (!dbUser || !dbPass || !targetDb) {
    console.error('❌ Variáveis DB_USER, DB_PASS e DB_NAME são obrigatórias.');
    process.exit(1);
}

const client = new Client({
    user: dbUser,
    host: process.env.DB_HOST || '127.0.0.1',
    database: process.env.PG_ADMIN_DB || 'postgres',
    password: dbPass,
    port: parseInt(process.env.DB_PORT || '5432', 10),
});

async function createDb() {
    try {
        await client.connect();
        const safeDbName = targetDb.replace(/[^a-zA-Z0-9_]/g, '');
        if (!safeDbName || safeDbName !== targetDb) {
            throw new Error(`Invalid database name: ${targetDb}`);
        }
        await client.query(`CREATE DATABASE "${safeDbName}"`);
        console.log(`Database ${safeDbName} created successfully`);
    } catch (err) {
        if (err.code === '42P04') {
            console.log(`Database ${targetDb} already exists`);
        } else {
            console.error('Error creating database:', err);
        }
    } finally {
        await client.end();
    }
}

createDb();
