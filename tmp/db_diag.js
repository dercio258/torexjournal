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
  
  // 1. Find user derci
  const usersRes = await client.query("SELECT id, email, name FROM users WHERE email = 'derciomatsope9@gmail.com'");
  console.log('User:', usersRes.rows[0]);
  const userId = usersRes.rows[0]?.id;

  if (userId) {
    // 2. Find accounts for this user
    const accountsRes = await client.query("SELECT id, name, user_id, mt5_id FROM accounts WHERE user_id = $1", [userId]);
    console.log('Accounts:', accountsRes.rows);
    
    // 3. Find trades for this user or these accounts
    const tradesRes = await client.query("SELECT id, ticket, symbol, type, account_id, status, open_time, close_time, profit FROM trades WHERE account_id = $1 OR account_id IS NULL ORDER BY created_at DESC LIMIT 10", [accountsRes.rows[0]?.id]);
    console.log('Recent Trades (for account or null):', tradesRes.rows);
    
    // 4. Count trades by account_id
    const countRes = await client.query("SELECT account_id, status, count(*) FROM trades GROUP BY account_id, status");
    console.log('Trade Counts by Account & Status:', countRes.rows);
  } else {
    console.log('User not found by email');
    // List all users just in case
    const allUsers = await client.query("SELECT id, email FROM users LIMIT 10");
    console.log('All Users:', allUsers.rows);
  }

  await client.end();
}

check().catch(console.error);
