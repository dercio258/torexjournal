/**
 * Cria os indices de performance e integridade no PostgreSQL em producao
 * sem depender do synchronize: true do TypeORM.
 *
 * Uso na VPS Linux:
 *   node backend-nest/scripts/apply_db_indexes.js
 */

const path = require('path');
const dotenv = require('dotenv');
const { Client } = require('pg');

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function applyIndexes() {
    const pgConfig = {
        host: process.env.DB_HOST || '127.0.0.1',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        user: process.env.DB_USER || process.env.DB_USERNAME || 'postgres',
        password: process.env.DB_PASS || process.env.DB_PASSWORD || 'postgres',
        database: process.env.DB_NAME || process.env.DB_DATABASE || 'trading_cossa',
    };

    const pg = new Client(pgConfig);
    await pg.connect();
    console.log(`[OK] Conectado ao PostgreSQL: ${pgConfig.host}:${pgConfig.port}/${pgConfig.database}`);

    const statements = [
        `CREATE INDEX IF NOT EXISTS idx_trades_account_close_time ON trades (account_id, close_time)`,
        `CREATE INDEX IF NOT EXISTS idx_trades_account_status ON trades (account_id, status)`,
        `CREATE INDEX IF NOT EXISTS idx_trades_import_log_id ON trades (import_log_id)`,
        `CREATE INDEX IF NOT EXISTS idx_positions_account_id ON positions (account_id)`,
        `CREATE INDEX IF NOT EXISTS idx_accounts_user_mt5_id ON accounts (user_id, mt5_id)`,
        `CREATE INDEX IF NOT EXISTS idx_import_logs_user_account ON import_logs (user_id, account_id)`,
    ];

    try {
        for (const sql of statements) {
            await pg.query(sql);
            console.log(`[OK] ${sql}`);
        }
        console.log('\n[SUCESSO] Todos os indices de performance foram verificados/criados no PostgreSQL!');
    } catch (err) {
        console.error('[ERRO ao criar indices]:', err.message);
    } finally {
        await pg.end();
    }
}

applyIndexes();
