const { Client } = require('pg');

const client = new Client({
  user: 'cossa_trading_user',
  host: 'localhost',
  database: 'cossa_trading',
  password: 'C0ssa@2026_db!',
  port: 5432,
});

async function check() {
  await client.connect();
  
  const res = await client.query("SELECT type, COUNT(*) as count FROM trades GROUP BY type");
  console.log("Groups by Type:", res.rows);

  const missing = await client.query("SELECT ticket, type, volume, open_price, close_price, profit FROM trades WHERE volume = 0 OR open_price = 0 OR profit IS NULL ORDER BY created_at DESC LIMIT 10");
  console.log("Missing/Zero Data Trades:", JSON.stringify(missing.rows, null, 2));

  await client.end();
}

check().catch(console.error);
