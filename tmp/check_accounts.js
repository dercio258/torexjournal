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
    const accounts = (await client.query("SELECT id, name, mt5_id, is_connected FROM accounts WHERE user_id = $1", [user.id])).rows;
    console.log('User Accounts:', JSON.stringify(accounts, null, 2));
    
    for (const acc of accounts) {
      const tradesCount = (await client.query("SELECT count(*) FROM trades WHERE account_id = $1", [acc.id])).rows[0].count;
      console.log(`Account ${acc.id} (${acc.name || 'No Name'}) has ${tradesCount} trades.`);
    }
  } else {
    console.log('User not found');
  }

  await client.end();
}

check().catch(console.error);
