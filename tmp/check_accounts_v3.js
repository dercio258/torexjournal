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
  
  const user = (await client.query("SELECT id FROM users WHERE email = 'derciomatsope9@gmail.com'")).rows[0];
  if (user) {
    // Check columns first
    const cols = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'accounts'");
    console.log('Account Columns:', cols.rows.map(r => r.column_name));

    const accounts = (await client.query("SELECT id, mt5_id, created_at FROM accounts WHERE user_id = $1 ORDER BY created_at ASC", [user.id])).rows;
    console.log('User Accounts (Sorted by CreatedAt):', JSON.stringify(accounts, null, 2));
  }

  await client.end();
}

check().catch(console.error);
