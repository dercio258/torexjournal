const { Client } = require('pg');

const client = new Client({
    user: 'postgres',
    host: 'localhost',
    database: 'postgres',
    password: 'postgres',
    port: 5432,
});

async function createDb() {
    try {
        await client.connect();
        await client.query('CREATE DATABASE cossa_trading');
        console.log('Database cossa_trading created successfully');
    } catch (err) {
        if (err.code === '42P04') {
            console.log('Database cossa_trading already exists');
        } else {
            console.error('Error creating database:', err);
        }
    } finally {
        await client.end();
    }
}

createDb();
