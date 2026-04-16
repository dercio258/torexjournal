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
  
  const res = await client.query("SELECT ticket, symbol, status, open_time, close_time, account_id FROM trades WHERE symbol = 'XAUUSD.x' ORDER BY created_at DESC LIMIT 20");
  console.log(JSON.stringify(res.rows, null, 2));

  await client.end();
}

check().catch(console.error);
