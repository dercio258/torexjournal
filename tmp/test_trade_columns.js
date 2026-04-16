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
  
  const res = await client.query("SELECT ticket, type, volume, open_price, close_price, profit, commission, swap FROM trades ORDER BY created_at DESC LIMIT 10");
  console.log(JSON.stringify(res.rows, null, 2));

  await client.end();
}

check().catch(console.error);
